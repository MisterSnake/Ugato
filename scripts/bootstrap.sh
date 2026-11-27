#!/usr/bin/env bash
# One-time Azure setup, meant for Azure Cloud Shell. Safe to run again: every
# step looks for what it needs before creating it. See docs/DEPLOYMENT.md.
set -euo pipefail

APP_NAME="ugato-github-deploy"
CREDENTIAL_NAME="ugato-main"
BUDGET_NAME="ugato-monthly"
BUDGET_AMOUNT_USD=1
BUDGET_API_VERSION="2023-11-01"

repo=""
budget_email=""
location="eastus2"
resource_group="rg-ugato"

usage() {
  echo "Usage: bash scripts/bootstrap.sh --repo <owner/name> --budget-email <email>" \
    "[--location eastus2] [--resource-group rg-ugato]" >&2
}

fail() {
  echo "Error: $*" >&2
  exit 1
}

step() {
  printf '\n==> %s\n' "$*"
}

while (($# > 0)); do
  case "$1" in
    --repo | --budget-email | --location | --resource-group)
      (($# >= 2)) || fail "$1 needs a value"
      case "$1" in
        --repo) repo="$2" ;;
        --budget-email) budget_email="$2" ;;
        --location) location="$2" ;;
        --resource-group) resource_group="$2" ;;
      esac
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      usage
      fail "unknown argument: $1"
      ;;
  esac
done

if [[ -z $repo || -z $budget_email ]]; then
  usage
  fail "--repo and --budget-email are required"
fi
[[ $repo == */* ]] || fail "--repo must look like owner/name"

for tool in az jq curl; do
  command -v "$tool" > /dev/null || fail "$tool is not installed; run this in Azure Cloud Shell"
done

has_gh() {
  command -v gh > /dev/null && gh auth status > /dev/null 2>&1
}

# The subject has to match the one in GitHub's OIDC token exactly. Repositories
# created, renamed or transferred after 2026-07-15 add numeric IDs to it:
# repo:owner@1/name@2 instead of repo:owner/name.
subject_prefix() {
  local prefix="" metadata
  if has_gh; then
    prefix=$(gh api "repos/$repo/actions/oidc/customization/sub" \
      --jq '.sub_claim_prefix // empty' 2> /dev/null) || prefix=""
  fi
  # Without gh, the creation date decides. It cannot see a rename or an opt-in.
  if [[ $prefix != repo:* ]]; then
    metadata=$(curl -fsS "https://api.github.com/repos/$repo") ||
      fail "cannot read the repository $repo from GitHub"
    prefix=$(jq -er '
      if .created_at > "2026-07-15T23:59:59Z"
      then "repo:\(.owner.login)@\(.owner.id)/\(.name)@\(.id)"
      else "repo:\(.full_name)"
      end' <<< "$metadata")
  fi
  echo "$prefix"
}

step "Reading the Azure account"
subscription_id=$(az account show --query id --output tsv)
tenant_id=$(az account show --query tenantId --output tsv)
echo "Subscription: $subscription_id"

step "Registering resource providers (this can take a few minutes)"
for provider in Microsoft.App Microsoft.Web; do
  az provider register --namespace "$provider" --wait
  echo "$provider is registered"
done

step "Resource group $resource_group"
if [[ $(az group exists --name "$resource_group") == "true" ]]; then
  echo "Already exists"
else
  az group create --name "$resource_group" --location "$location" --output none
  echo "Created in $location"
fi
resource_group_id=$(az group show --name "$resource_group" --query id --output tsv)

step "App registration $APP_NAME"
client_id=$(az ad app list --filter "displayName eq '$APP_NAME'" \
  --query "[0].appId" --output tsv)
if [[ -n $client_id ]]; then
  echo "Already exists"
else
  client_id=$(az ad app create --display-name "$APP_NAME" --query appId --output tsv)
  echo "Created"
fi

step "Service principal"
principal_id=$(az ad sp list --filter "appId eq '$client_id'" \
  --query "[0].id" --output tsv)
if [[ -n $principal_id ]]; then
  echo "Already exists"
else
  principal_id=$(az ad sp create --id "$client_id" --query id --output tsv)
  echo "Created"
fi

step "Federated credential for pushes to main"
prefix=$(subject_prefix)
subject="$prefix:ref:refs/heads/main"
echo "Subject: $subject"
existing_subject=$(az ad app federated-credential list --id "$client_id" \
  --query "[?name=='$CREDENTIAL_NAME'].subject | [0]" --output tsv)
credential=$(jq -n --arg name "$CREDENTIAL_NAME" --arg subject "$subject" '{
  name: $name,
  issuer: "https://token.actions.githubusercontent.com",
  subject: $subject,
  audiences: ["api://AzureADTokenExchange"]
}')
if [[ $existing_subject == "$subject" ]]; then
  echo "Already exists"
elif [[ -n $existing_subject ]]; then
  az ad app federated-credential update --id "$client_id" \
    --federated-credential-id "$CREDENTIAL_NAME" \
    --parameters "$credential" --output none
  echo "Updated"
else
  az ad app federated-credential create --id "$client_id" \
    --parameters "$credential" --output none
  echo "Created"
fi

step "Contributor role on $resource_group"
assignments=$(az role assignment list --assignee "$client_id" --role Contributor \
  --scope "$resource_group_id" --query "length(@)" --output tsv)
if [[ $assignments != "0" ]]; then
  echo "Already assigned"
else
  # A new service principal takes a while to be visible to role assignments.
  for attempt in 1 2 3 4 5 6; do
    if az role assignment create --assignee-object-id "$principal_id" \
      --assignee-principal-type ServicePrincipal --role Contributor \
      --scope "$resource_group_id" --output none; then
      echo "Assigned"
      break
    fi
    ((attempt < 6)) || fail "could not assign the role"
    echo "Retrying in 10 seconds"
    sleep 10
  done
fi

step "Budget $BUDGET_NAME (USD $BUDGET_AMOUNT_USD per month)"
budgets_path="https://management.azure.com$resource_group_id/providers/Microsoft.Consumption/budgets"
# Listing tells "there is no budget" apart from a failed request.
existing_budgets=$(az rest --method get \
  --url "$budgets_path?api-version=$BUDGET_API_VERSION" \
  --query "length(value[?name=='$BUDGET_NAME'])" --output tsv)
if [[ $existing_budgets != "0" ]]; then
  echo "Already exists"
else
  # The start date must be the first day of a month and cannot be changed later.
  start_date=$(date -u +%Y-%m-01T00:00:00Z)
  # shellcheck disable=SC2016 # The dollar names belong to jq, not to the shell.
  budget=$(jq -n --arg email "$budget_email" --arg start "$start_date" \
    --argjson amount "$BUDGET_AMOUNT_USD" '
    def alert(percent): {
      enabled: true,
      operator: "GreaterThanOrEqualTo",
      threshold: percent,
      thresholdType: "Actual",
      contactEmails: [$email]
    };
    {properties: {
      category: "Cost",
      amount: $amount,
      timeGrain: "Monthly",
      timePeriod: {startDate: $start},
      notifications: {actual80: alert(80), actual100: alert(100)}
    }}')
  az rest --method put \
    --url "$budgets_path/$BUDGET_NAME?api-version=$BUDGET_API_VERSION" \
    --body "$budget" --output none
  echo "Created, with alerts to $budget_email at 80% and 100%"
fi

step "GitHub repository variables"
variables=(
  "AZURE_CLIENT_ID=$client_id"
  "AZURE_TENANT_ID=$tenant_id"
  "AZURE_SUBSCRIPTION_ID=$subscription_id"
  "AZURE_RESOURCE_GROUP=$resource_group"
)
if has_gh; then
  for variable in "${variables[@]}"; do
    gh variable set "${variable%%=*}" --repo "$repo" --body "${variable#*=}"
  done
  echo "Saved in $repo"
else
  echo "gh is not authenticated. Add these as repository variables (not secrets) at"
  echo "https://github.com/$repo/settings/variables/actions"
  echo
  printf '  %s\n' "${variables[@]}"
fi

step "Done"
