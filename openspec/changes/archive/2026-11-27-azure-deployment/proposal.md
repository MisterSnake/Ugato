# Proposal

## Why

Today U Cat only runs locally (`uvicorn` + `npm run dev`). We need to have it in production on Azure, at no cost, and have every merge to `main` publish the new version automatically, with no manual steps. Exposing the backend on the internet also means we have to prevent other sites from opening WebSockets against it.

## What Changes

- **Infrastructure as code (Bicep)** in `infra/`: Azure Static Web Apps (Free plan) for the frontend and Azure Container Apps (Consumption, 0 to 1 replica, without Log Analytics) for the backend, in `eastus2`, inside a dedicated resource group.
- **Backend Dockerfile** (`backend/Dockerfile`): a `python:3.14-slim` image with `uv`, a single `uvicorn` worker. The image is published to GitHub Container Registry (public, free), so there is no ACR.
- **CI/CD on GitHub Actions**:
  - `ci.yml` on every pull request: backend tests, frontend lint, tests and build, and an image build without publishing it.
  - `deploy.yml` on every push to `main`: tests, publishing the `:<sha>` image, Bicep deployment, a frontend build pointing at the backend, deployment to SWA and a smoke test that fails if production does not serve the newly merged commit.
  - Authentication with Azure through OIDC (federated credential), with no long-lived secrets.
- **Bootstrap script** (`scripts/bootstrap.sh`), to be run only once in Azure Cloud Shell: it registers the providers, creates the resource group, the deployment identity with its federated credential and the role scoped to the RG, creates a USD 1 alert budget and saves the repo variables.
- **Manual steps guide** (`docs/DEPLOYMENT.md`), reduced to the minimum: run the bootstrap and, after the first push, mark the image as public on ghcr.
- **Backend**:
  - `GET /api/health` also returns the deployed version: `{"status": "ok", "version": "<sha>"}`, or `"dev"` locally.
  - The allowed origins are configured with `ALLOWED_ORIGINS`, which applies to CORS and to the WebSocket.
  - **BREAKING (only for clients from other origins)**: the `/api/ws` handshake is rejected when the `Origin` header is present and is not an allowed origin.
- **Frontend**: the WebSocket URL comes from `VITE_WS_URL` when it is defined at build time. If it is not, it is still the same-origin one, so local development with the Vite proxy does not change.

Out of scope: a custom domain, game persistence (every deploy, restart or scale-to-zero erases the games in progress), staging environments or per-PR previews, and observability beyond the Container Apps log stream.

## Capabilities

### New Capabilities

- `deployment`: how the game reaches production and what that production guarantees. It covers automatic deployment on merge to `main`, the version in `/api/health` and its verification, the configurable WebSocket endpoint in the frontend, and the scale and cost limits (a single backend replica, everything on free plans).
- `connection-origin`: which origins can use the backend. It covers the list of allowed origins set by configuration, its application to CORS and the rejection of the WebSocket handshake from a disallowed origin.

### Modified Capabilities

None. The requirements of `game-creation`, `game-joining`, `game-lobby`, `game-play` and `turn-timer` remain in force as they are. A rejection by origin appears on the client as a failed connection, which "Disconnected lobby with manual retry" already covers.

## Impact

- **New files**: `backend/Dockerfile`, `backend/.dockerignore`, `infra/main.bicep` (and its parameters), `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `scripts/bootstrap.sh`, `docs/DEPLOYMENT.md`.
- **Backend**: `app/main.py` (version in health and CORS from the configuration), `app/games/ws.py` (`Origin` check before `accept`) and a small configuration module. Tests are added in `backend/tests/`.
- **Frontend**: the function that builds the WebSocket URL moves out of `App.tsx` into a testable module that reads `VITE_WS_URL`, along with the type declaration for the Vite env.
- **Documentation**: `backend/README.md` (health response and `ALLOWED_ORIGINS`) and `CLAUDE.md` (deployment and variables).
- **External services**: an Azure Pay-As-You-Go subscription (Static Web Apps Free and Container Apps within the monthly free grant), GitHub Actions and GitHub Container Registry (free because the repo is public).
- **Operations**: each deploy replaces the backend revision and ends the games in progress. The first visit after a period without use takes a few seconds because of the cold start.
