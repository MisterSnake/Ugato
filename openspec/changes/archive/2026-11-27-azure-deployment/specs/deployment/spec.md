# Spec Delta

## Purpose

Defines how the game reaches production and what production guarantees: automatic deployment from `main`, a verifiable deployed version, a configurable WebSocket endpoint, and limits on scale and cost.

## ADDED Requirements

### Requirement: Merge to main deploys to production
Every push to the `main` branch SHALL run the test suites of the backend and the frontend and, only if they pass, SHALL deploy that commit's backend and frontend to production without any manual step. A failing test SHALL stop the deployment and leave production on the previous version.

#### Scenario: Successful merge
- **GIVEN** the setup steps in the deployment guide have been completed once
- **WHEN** a pull request is merged into `main` and all tests pass
- **THEN** production serves the backend and the frontend built from that merge commit

#### Scenario: Failing tests block the deployment
- **WHEN** a commit is pushed to `main` and a backend or frontend test fails
- **THEN** nothing is deployed and production keeps serving the previous version

### Requirement: Pull requests are verified without deploying
Every pull request targeting `main` SHALL run the backend tests, the frontend lint, tests and build, and the backend container image build, and SHALL NOT deploy anything or require access to Azure.

#### Scenario: Pull request checks
- **WHEN** a pull request targeting `main` is opened or updated
- **THEN** the checks run and report their result on the pull request, and production does not change

### Requirement: Health reports the deployed version
`GET /api/health` SHALL respond with status 200 and a JSON body `{"status": "ok", "version": <version>}`, where `<version>` is the full git commit SHA the running backend was built from, or `"dev"` when the backend was not built with a version.

#### Scenario: Deployed backend
- **GIVEN** the backend was built from commit `abc123...`
- **WHEN** a client calls `GET /api/health`
- **THEN** the response is `{"status": "ok", "version": "abc123..."}`

#### Scenario: Local backend
- **GIVEN** the backend runs without a configured version
- **WHEN** a client calls `GET /api/health`
- **THEN** the response is `{"status": "ok", "version": "dev"}`

### Requirement: Frontend publishes its version
The deployed frontend SHALL serve `/version.json` with the body `{"version": <sha>}`, where `<sha>` is the full git commit SHA it was built from.

#### Scenario: Version file
- **GIVEN** the frontend was deployed from commit `abc123...`
- **WHEN** a client requests `/version.json` from the frontend's site
- **THEN** the response is `{"version": "abc123..."}`

### Requirement: Deployment verifies production
After deploying, the pipeline SHALL check that the backend's health version and the frontend's `/version.json` both equal the deployed commit SHA, retrying for a bounded time, and SHALL fail the run when either does not match in time.

#### Scenario: Production matches the commit
- **WHEN** both versions equal the deployed commit SHA
- **THEN** the deployment run succeeds

#### Scenario: Production does not match
- **WHEN** either version still differs from the deployed commit SHA after the retry period
- **THEN** the deployment run fails and reports which part did not match

### Requirement: Configurable WebSocket endpoint
When the frontend is built with a WebSocket URL configured, the client SHALL open its game connection to that URL. When none is configured, it SHALL use `/api/ws` on the page's own host, with `wss` on an `https` page and `ws` otherwise.

#### Scenario: Configured URL
- **GIVEN** the frontend was built with the WebSocket URL `wss://backend.example/api/ws`
- **WHEN** the app opens its connection
- **THEN** it connects to `wss://backend.example/api/ws`

#### Scenario: No configured URL over https
- **GIVEN** no WebSocket URL was configured and the page is `https://game.example/`
- **WHEN** the app opens its connection
- **THEN** it connects to `wss://game.example/api/ws`

#### Scenario: No configured URL over http
- **GIVEN** no WebSocket URL was configured and the page is `http://localhost:5173/`
- **WHEN** the app opens its connection
- **THEN** it connects to `ws://localhost:5173/api/ws`

### Requirement: Single backend instance
Production SHALL run at most one backend instance at any time, because games live in that instance's memory. It MAY scale to zero instances when there is no traffic.

#### Scenario: Load does not add instances
- **WHEN** many clients are connected at once
- **THEN** all of them are served by the same backend instance, and game names stay unique

#### Scenario: Idle backend
- **GIVEN** no client has made a request for a while
- **WHEN** a client opens the site and connects
- **THEN** the backend starts and the connection succeeds after a startup delay

### Requirement: Free-tier only infrastructure
The production infrastructure SHALL use only Azure and GitHub offerings that have no charge at the project's usage level: Static Web Apps on the Free plan, Container Apps on the Consumption plan within its monthly free grant, a public GitHub Container Registry image, and no paid registry or paid log workspace. A spending alert SHALL notify the subscription owner by email if costs reach USD 1 in a month.

#### Scenario: Provisioned resources
- **WHEN** the infrastructure is deployed
- **THEN** the resource group contains only a Free-plan Static Web App, a Consumption Container Apps environment without a Log Analytics workspace, and its container app

#### Scenario: Unexpected cost
- **WHEN** the month's cost for the resource group reaches USD 1
- **THEN** the subscription owner receives an email alert

### Requirement: Minimal manual setup
Provisioning and deployment SHALL be automated except for these manual steps: having an Azure Pay-As-You-Go subscription, running the provided one-time setup script in Azure Cloud Shell (including authenticating the GitHub CLI there or pasting the repository variables it prints), and making the container image public and re-running the failed jobs if the first deployment asks for it.

#### Scenario: First deployment from scratch
- **GIVEN** an Azure Pay-As-You-Go subscription and the GitHub repository
- **WHEN** the owner follows the deployment guide and merges into `main`
- **THEN** the game is reachable at the Static Web App URL without any manual step outside the guide

### Requirement: Deployment guide documents every manual step
The repository SHALL include a deployment guide that documents every manual step of setup, first deployment, rollback and teardown, each with its exact commands or exact screen paths, so that the owner can deploy from scratch using only that guide. The guide SHALL also say where to find the production URLs, how to view backend logs, what the deployment costs and what to do when the spending alert arrives.

#### Scenario: Every manual step is in the guide
- **WHEN** any manual action is required to set up, deploy for the first time, roll back or tear down production
- **THEN** that action appears in the deployment guide with its exact commands or screen paths

#### Scenario: Pipeline points to the guide
- **WHEN** a deployment run stops because it needs a manual action, such as making the container image public
- **THEN** its error message names the section of the deployment guide that explains the action

#### Scenario: Guide matches the automation
- **WHEN** the setup script's parameters, the workflow job names or the deployment outputs change
- **THEN** the deployment guide is updated in the same change to match them
