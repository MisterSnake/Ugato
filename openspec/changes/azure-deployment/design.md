# Design

## Context

See `proposal.md` (Why). These are the constraints that shape the design:

- **State lives in process memory** (`GameRegistry`, timers with `asyncio.create_task` in `ws.py`). That is why the backend has to be a single instance, and any restart erases the games.
- **The frontend opens the WebSocket to the same origin** (`App.tsx`, `gameSocketUrl()`), and `App` passes that URL to the injectable `GameSocketFactory`. Tests can already see which URL is used.
- **CORS is hardcoded** (`http://localhost:5173`) and `ws.py` calls `websocket.accept()` without looking at the `Origin`.
- **The repo is public** (`github.com/MisterSnake/Ugato`) and the Azure subscription is Pay-As-You-Go.
- **The local machine has no `az`, `gh` or `docker`.** The manual steps have to be doable without installing anything.
- **Cost 0.** Pay-As-You-Go has no hard spending cap, so cost is controlled by the choice of plans and the scale limits.

## Goals / Non-Goals

**Goals:**
- A merge to `main` results in verified production, with no intervention.
- The manual steps are done only once, from the browser (Azure Cloud Shell and github.com).
- There are no long-lived secrets in GitHub.

**Non-Goals:**
- Persisting games or deploying without cutting off the games in progress.
- Scaling the backend horizontally.
- Having staging environments or per-PR previews (SWA previews stay disabled).
- Using a custom domain. The `*.azurestaticapps.net` and `*.azurecontainerapps.io` domains are used.

## Decisions

### 1. Topology: SWA for the frontend and ACA for the backend, with a direct WS

```
             browser
           /         \
   https  /           \  wss (direct, Origin = SWA)
         v             v
 +------------------+   +-----------------------------------+
 | Static Web App   |   | Container App  (env Consumption)  |
 | Free, dist/ +    |   | FastAPI :8000, 0..1 replica       |
 | version.json     |   | ALLOWED_ORIGINS=https://<swa>     |
 +------------------+   | APP_VERSION=<sha>                 |
                        +-----------------------------------+
            rg-ugato  (eastus2)
```

SWA does not proxy WebSockets, and its "linked backend" only exists on the Standard plan, which is paid. That is why the browser connects directly to the ACA FQDN.

*Alternative considered:* a single container in which FastAPI serves `dist/`. It has fewer pieces and keeps the same origin, but the user preferred SWA, which also serves the frontend from a CDN even when the backend is asleep.

### 2. IaC: Bicep

Bicep keeps no state (the state is ARM), is native to Azure and has supported Container Apps from day one. Terraform would require creating and paying for a state backend, or depending on HCP Terraform, and would add a manual step. The template is applied with `az deployment group create` in incremental mode.

`infra/main.bicep`, with `targetScope = resourceGroup`, takes these parameters: `location` (default `eastus2`), `namePrefix` (default `ugato`), `image` (the full reference `ghcr.io/...:<sha>`) and `appVersion` (the SHA). It defines these resources:

- `Microsoft.Web/staticSites` with sku `Free`, without `repositoryUrl`. The deploy is done from the pipeline, not through SWA's automatic GitHub integration, because that integration creates its own workflow and its own secret.
- `Microsoft.App/managedEnvironments` with the Consumption plan and **without** `appLogsConfiguration`: there is no Log Analytics, and the console log stream is still available.
- `Microsoft.App/containerApps`:
  - `activeRevisionsMode: Single`;
  - ingress `external`, `targetPort: 8000`, `transport: auto` (which supports WebSocket);
  - scale `minReplicas: 0`, `maxReplicas: 1`, with 0.25 vCPU and 0.5 GiB;
  - liveness and readiness probes on `/api/health`;
  - env `APP_VERSION=appVersion` and `ALLOWED_ORIGINS=https://${staticSite.properties.defaultHostname}`.
- Outputs: `backendFqdn`, `frontendHostname` and `staticSiteName`.

The SWA hostname is known within the same template, so `ALLOWED_ORIGINS` is built without a second step.

### 3. Image registry: public GHCR

The image is `ghcr.io/mistersnake/ugato-backend:<sha>`, in lowercase as the registry requires. ACR Basic costs around USD 5/month. GHCR is free for public packages, and since the pull is anonymous, ACA needs no credentials. A `GITHUB_TOKEN` would not work as a pull credential either, because it expires and ACA pulls the image again every time it scales from zero.

GitHub has no API for changing a package's visibility, and a new package may be created private. That is why, before the Bicep deployment, `deploy.yml` verifies that the manifest can be pulled anonymously (it requests an anonymous token from `ghcr.io/token` and does a `HEAD` of the manifest). If that fails, it stops with a message pointing to the section of `docs/DEPLOYMENT.md` that explains how to make the image public. This happens only on the first deploy.

### 4. GitHub → Azure authentication: OIDC

- `azure/login` uses `client-id`, `tenant-id` and `subscription-id` stored as repo **variables** (they are not secrets).
- The federated credential has the subject `<repo prefix>:ref:refs/heads/main`, so only pushes to `main` can deploy. The prefix is `repo:MisterSnake/Ugato` in the classic format, but repos created, renamed or transferred after 2026-07-15 use `repo:OWNER@ID/REPO@ID` by default ([GitHub changelog](https://github.blog/changelog/2026-04-23-immutable-subject-claims-for-github-actions-oidc-tokens/)). That is why the bootstrap does not hardcode it: it uses `sub_claim_prefix` from the repo's OIDC API when `gh` is authenticated and, if it is not, it builds it from the repo's public data according to its creation date. The guide explains how to fix it if the login fails with `AADSTS700213`.
- `deploy.yml` does not use a GitHub `environment`, because that would change the subject of the OIDC token.
- The role is `Contributor` scoped to the resource group. The template creates no role assignments, so neither `Owner` nor `User Access Administrator` is needed.

*Alternative considered:* a client secret in `AZURE_CREDENTIALS`. It is a long-lived secret that expires and has to be rotated.

### 5. Bootstrap in Cloud Shell, idempotent

`scripts/bootstrap.sh` (bash, because Cloud Shell already includes `az` and `gh`) takes `--repo MisterSnake/Ugato` and `--budget-email <email>`, with `--location eastus2` and `--resource-group rg-ugato` as optional default values. It does this:

1. `az provider register` for `Microsoft.App` and `Microsoft.Web`, and waits for them to be registered.
2. Creates the resource group.
3. Creates the `ugato-github-deploy` App Registration and its service principal, if they do not exist.
4. Creates the federated credential for `main`, if it does not exist.
5. Assigns `Contributor` on the RG, if it is not assigned.
6. Creates the USD 1 `ugato-monthly` budget on the RG, with email alerts at 80% and 100% of actual spend.
7. Saves the repo variables. If `gh auth status` is ok, it uses `gh variable set AZURE_CLIENT_ID|AZURE_TENANT_ID|AZURE_SUBSCRIPTION_ID|AZURE_RESOURCE_GROUP`. If not, it prints the values and the link to *Settings → Secrets and variables → Actions → Variables* for pasting them by hand.

Each step checks before creating, so running it twice breaks nothing.

The **budget goes in the bootstrap and not in Bicep** for two reasons. `startDate` has to be the first day of a month and cannot be changed after the budget is created, so a `utcNow()` in the template would make the following month's redeploys fail. Also, the budget is account configuration, not deployment configuration.

### 6. Pipelines

`ci.yml` (on `pull_request` to `main`), with jobs in parallel:
- `backend`: `astral-sh/setup-uv`, `uv sync --frozen` and `uv run pytest -q`. On Linux, `uv run` works; the trampoline problem is only on the local Windows machine.
- `frontend`: Node 22, `npm ci`, `npm run lint`, `npm test -- --run` and `npm run build`.
- `image`: `docker build` of `backend/` without push.

`deploy.yml` (on `push` to `main`, with `concurrency: production` and `cancel-in-progress: false`):

```
 test-backend --+
                +--> image --> infra --> frontend --> smoke
 test-frontend -+     |          |          |            |
                      |          |          |            +- GET https://<fqdn>/api/health
                      |          |          |               .version == sha
                      |          |          |            +- GET https://<swa>/version.json
                      |          |          |               .version == sha
                      |          |          |            (retries for up to ~3 min)
                      |          |          +- npm ci && npm run build
                      |          |             with VITE_WS_URL=wss://<fqdn>/api/ws
                      |          |          +- writes dist/version.json
                      |          |          +- token: az staticwebapp secrets list
                      |          |          +- Azure/static-web-apps-deploy
                      |          |             (app_location dist, skip_app_build)
                      |          +- azure/login (OIDC)
                      |          +- anonymous image pull check (decision 3)
                      |          +- az deployment group create -> outputs
                      +- docker build --build-arg APP_VERSION=sha
                         push :sha (with GITHUB_TOKEN, packages: write)
```

- Permissions: `contents: read`, `packages: write` (only the `image` job) and `id-token: write` (the jobs that use Azure).
- The jobs pass the FQDN, the hostname and the SWA name to each other as outputs.
- The SWA deploy token is obtained on the spot and masked with `::add-mask::`. No secret needs to be stored.
- The frontend is built **after** Bicep because `VITE_WS_URL` needs the ACA FQDN. That FQDN is stable as long as the environment is not recreated.

### 7. Backend Dockerfile

- A build stage with `uv`: it copies the binary from `ghcr.io/astral-sh/uv` and runs `uv sync --frozen --no-dev` on `python:3.14-slim`.
- A final `python:3.14-slim` stage with the `.venv` and `app/`, an unprivileged user and `ARG/ENV APP_VERSION=dev`.
- `CMD uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips=*`, with a single worker and never `--workers`. `--proxy-headers` is needed because ACA's Envoy terminates TLS.
- `.dockerignore` excludes `.venv`, `tests`, `.pytest_cache` and `__pycache__`.

### 8. Code changes (TDD)

- **Backend configuration**: a small module (for example `app/settings.py`) reads `APP_VERSION` (default `"dev"`) and `ALLOWED_ORIGINS` (a comma-separated list, trimmed and without empty entries; default `["http://localhost:5173"]`). It exposes this as a FastAPI dependency that tests can override, just like `get_registry`. CORS reads the list when the app is created; the CORS tests build the app with the environment variable set (with `monkeypatch`) or use an app factory.
- **Health**: adds `version` to the response.
- **Origin on the WS**: in `ws.py`, before `websocket.accept()`, if `websocket.headers.get("origin")` exists and is not in the allowed list, `await websocket.close(code=1008)`. Before the accept, Starlette responds to the handshake with HTTP 403. Without `Origin` it is accepted (see the `connection-origin` spec). This way the existing `TestClient` tests, which do not send `Origin`, keep passing.
- **Frontend**: `gameSocketUrl` moves out of `App.tsx` into `src/game/socketUrl.ts` as a pure function `gameSocketUrl(configuredUrl: string | undefined, location: Pick<Location, 'protocol' | 'host'>)`. `App` calls it with `import.meta.env.VITE_WS_URL` and `window.location`. `VITE_WS_URL` is typed in `src/vite-env.d.ts` (augmenting `ImportMetaEnv`). An empty string counts as "not configured".
- `version.json` is written by the pipeline; it is not app code.

## Risks / Trade-offs

- **[Each deploy cuts off the games in progress]**: the `Single` revision mode replaces the container and the memory is lost. → Accepted and documented. Clients see "Can't reach the server." and can retry.
- **[Cold start of 5 to 15 s]**: the WS waits for the backend to wake up. `gameSocket.ts` has no timeout of its own, so it is only slow. → Accepted. Warming up with `GET /api/health` on page load remains a future improvement.
- **[Idle WS connection timeouts at the ACA ingress]**: Envoy may close connections with no traffic. uvicorn sends WebSocket pings every 20 s by default, and that should keep them alive. → Verified in the manual validation task with a game left open for more than 5 minutes without moves. If they get cut, `--ws-ping-interval` is lowered.
- **[Pay-As-You-Go has no hard cap]**: a configuration mistake, such as `minReplicas: 1` or more CPU, could cost money. → `maxReplicas: 1`, minimal resources and scale-to-zero, all in Bicep (and reviewed in PRs), plus the USD 1 budget with alerts.
- **[Public abuse]**: anyone can open connections from a non-browser client, and that consumes the free grant. → Out of scope. The `Origin` check stops use from other websites, and the budget gives a warning.
- **[First deploy with a private image]**: the run fails at the anonymous pull check. → A clear message, a documented manual step and *Re-run failed jobs*.
- **[The ACA FQDN changes if the environment is recreated]**: → It does not happen on normal redeploys. If it does, the same pipeline rebuilds the frontend with the new FQDN.
- **[SWA Free has no SLA]**: → Accepted for a game with no SLA.

## Migration Plan

1. Merge this implemented change into `main` **after** running the bootstrap. Without the repo variables, `deploy.yml` fails at the Azure login.
2. First deploy: if the visibility check fails, make the image public and re-run the failed jobs.
3. **Rollback**: revert the commit on `main`. The pipeline deploys the previous SHA, because the `:<sha>` images remain in GHCR. In an emergency, `az containerapp update --image ghcr.io/mistersnake/ugato-backend:<previous-sha>` from Cloud Shell.
4. **Tear everything down**: `az group delete -n rg-ugato`, and delete the App Registration and the package in GHCR.

## Open Questions

- Does `--ws-ping-interval` need to be lowered? This is resolved by validating an idle game in production.
