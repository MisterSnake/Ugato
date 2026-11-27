# Tasks

Every task that changes production code is a Red-Green-Refactor cycle:
1. **Red**: write the failing test and run the suite to see it fail.
2. **Green**: write the minimal code, with English names, that makes it pass.
3. **Refactor**: clean up with the suite green.

The infrastructure and CI files (Dockerfile, Bicep, workflows, bootstrap) are not app code and are not tested with unit tests. Those tasks say so and end with a concrete verification: a CI job that compiles or analyzes them, or a check in production.

Backend commands, from `backend/`: `./.venv/Scripts/python.exe -m pytest -q`. Frontend commands, from `frontend/`: after each task, `npm test`, `npm run build` and `npm run lint` have to pass.

## 1. Backend: configuration, version and origins

- [x] 1.1 The configuration reads `APP_VERSION` and `ALLOWED_ORIGINS`.
  - Red: in `backend/tests/test_settings.py`, tests that without variables the version is `"dev"` and the origins are `["http://localhost:5173"]`; that `ALLOWED_ORIGINS=" https://a.example, https://b.example ,"` gives `["https://a.example", "https://b.example"]`; and that `APP_VERSION=abc` gives `"abc"` (with `monkeypatch.setenv`).
  - Green: an `app/settings.py` module with the reading logic and a `get_settings` dependency that tests can override.
  - Refactor.
  - Verify: pytest green.
- [x] 1.2 Health returns the version (spec `deployment`: "Health reports the deployed version").
  - Red: in `backend/tests/test_health.py`, `GET /api/health` responds `{"status": "ok", "version": "dev"}` by default, and `{"status": "ok", "version": "abc123"}` with the configuration overridden.
  - Green: `health()` in `app/main.py` uses `get_settings`.
  - Refactor.
  - Verify: pytest green.
- [x] 1.3 CORS follows the list of origins (spec `connection-origin`: "CORS follows the allowed origins").
  - Red: tests that, with `ALLOWED_ORIGINS=https://game.example`, `GET /api/health` with `Origin: https://game.example` carries `Access-Control-Allow-Origin: https://game.example`, and with `Origin: https://evil.example` it does not carry that header. The app is built with the variable set, through an app factory or by reloading the module; choose the simplest option that does not break the existing tests.
  - Green: `CORSMiddleware` takes `allow_origins` from the configuration.
  - Refactor.
  - Verify: pytest green.
- [x] 1.4 The WS handshake rejects foreign origins (spec `connection-origin`: "WebSocket handshake rejects foreign origins" and "Clients without an Origin header").
  - Red: in `backend/tests/games/test_ws.py` (or a new file `test_ws_origin.py`), with allowed origins `https://game.example`:
    - opening `/api/ws` with `Origin: https://evil.example` raises `WebSocketDisconnect`, or the handshake fails, without receiving messages;
    - with `Origin: https://game.example` it is possible to send `subscribe_lobby` and receive `games_list`;
    - without `Origin`, too.
  - Green: in `ws.py`, before `websocket.accept()`, close with code 1008 when there is an `Origin` and it is not allowed.
  - Refactor.
  - Verify: the whole backend suite green, including the existing WS tests.
- [x] 1.5 Document in `backend/README.md` the new health response, `APP_VERSION`, `ALLOWED_ORIGINS` and the rejection by `Origin`. Verify: the README describes both variables with their default values, and the health example matches what the 1.2 test returns.

## 2. Frontend: configurable WebSocket endpoint

- [x] 2.1 A pure function builds the WS URL (spec `deployment`: "Configurable WebSocket endpoint").
  - Red: in `src/game/socketUrl.test.ts`, that:
    - a configured URL `wss://backend.example/api/ws` is returned as is;
    - if it is not configured (`undefined` or `''`), with `https:` and host `game.example` it gives `wss://game.example/api/ws`;
    - with `http:` and host `localhost:5173` it gives `ws://localhost:5173/api/ws`.
  - Green: `src/game/socketUrl.ts` exports `gameSocketUrl(configuredUrl, location)`.
  - Refactor.
  - Verify: `npm test` green.
- [x] 2.2 `App` uses `VITE_WS_URL`.
  - Red: in `App.test.tsx`, a test that sets `VITE_WS_URL` (with `vi.stubEnv`) and checks that the injected `createSocket` receives that URL, and another that without the variable it receives jsdom's same-origin URL.
  - Green: `App.tsx` replaces its local `gameSocketUrl()` with `gameSocketUrl(import.meta.env.VITE_WS_URL, window.location)`, and `src/vite-env.d.ts` declares `VITE_WS_URL?: string` in `ImportMetaEnv`.
  - Refactor: delete the local function and its comment.
  - Verify: `npm test`, `npm run build` and `npm run lint` green; `npm run dev` with the local backend still connects through the proxy.

## 3. Backend image

- [x] 3.1 Create `backend/Dockerfile` and `backend/.dockerignore` as the design says (decision 7): multi-stage with `uv`, `python:3.14-slim`, unprivileged user, `ARG/ENV APP_VERSION`, a single uvicorn worker with `--proxy-headers`. It is infrastructure, with no unit test. Verify: the `image` job of `ci.yml` (task 4.1) builds the image. If Docker is available in some environment, `docker run -e APP_VERSION=x -p 8000:8000` responds `{"status":"ok","version":"x"}` at `/api/health`.

## 4. Continuous integration on pull requests

- [x] 4.1 Create `.github/workflows/ci.yml` (decision 6) with the jobs `backend` (uv + pytest), `frontend` (Node 22: `npm ci`, lint, `npm test -- --run`, build), `image` (`docker build backend/` without push) and `infra` (`az bicep build --file infra/main.bicep` and `shellcheck scripts/bootstrap.sh`, once they exist). Without Azure access. Verify: when this change's PR is opened, all jobs pass on GitHub, and a test broken on purpose in a test branch makes the corresponding job fail.

## 5. Infrastructure (Bicep)

- [x] 5.1 Create `infra/main.bicep` (decision 2):
  - Static Web App with sku Free;
  - Consumption Container Apps environment without Log Analytics;
  - container app with min 0 / max 1 replica, 0.25 vCPU / 0.5 GiB, external ingress on port 8000, probes on `/api/health`, and env `APP_VERSION` and `ALLOWED_ORIGINS` built from the SWA hostname;
  - parameters `location`, `namePrefix`, `image` and `appVersion`;
  - outputs `backendFqdn`, `frontendHostname` and `staticSiteName`.

  It is infrastructure, with no unit test. Verify: `az bicep build` passes in the CI `infra` job, and the template declares no Log Analytics, ACR or dedicated workload profile resource.

## 6. Bootstrap and manual steps guide

- [x] 6.1 Create `scripts/bootstrap.sh` (decision 5): idempotent, with `set -euo pipefail` and the parameters `--repo`, `--budget-email`, `--location` and `--resource-group`. It registers providers, creates the RG, the App Registration, the service principal, the `main` federated credential, the `Contributor` role on the RG and the USD 1 budget, and saves the variables with `gh` or prints them. It is infrastructure, with no unit test. Verify: `shellcheck` passes in the CI `infra` job, and running it twice in a row in Cloud Shell finishes without errors and without duplicating resources (see 8.1).
- [x] 6.2 Write `docs/DEPLOYMENT.md`, in Spanish, with:
  - requirements (Pay-As-You-Go subscription, admin permissions on the repo);
  - step 1, the bootstrap in Cloud Shell, with the exact command and how to authenticate `gh` there or paste the variables by hand;
  - step 2, the merge into `main`;
  - step 3, making the image public in GHCR if the first deploy asks for it, with the exact path on github.com and how to re-run the failed jobs;
  - where to see the game URL (the workflow summary and the `frontendHostname` output);
  - how to view the logs (`az containerapp logs show --follow`);
  - rollback and how to tear everything down;
  - what costs money and what does not, and what to do if the budget alert arrives;
  - known limitations (games are cut off on each deploy, cold start).

  Each manual step has its exact command or its exact path in the portal or on github.com, and each section has a stable anchor that the pipeline's error messages can cite (for example `#hacer-publica-la-imagen`). Verify, according to the `deployment` spec ("Deployment guide documents every manual step"):
  - go through the bootstrap, `deploy.yml` and the design's *Migration Plan*, list every action that requires human intervention and confirm that each one has its section in the guide;
  - each command matches the script's real names and parameters;
  - a person who did not take part in the change, or a cold re-read, can follow the guide from start to finish without consulting any other file.

  The real validation is 8.1.
- [x] 6.3 Update `CLAUDE.md`: add `infra/`, `.github/workflows/`, `scripts/` and `docs/` to the layout, `VITE_WS_URL`, `APP_VERSION` and `ALLOWED_ORIGINS`, and that production runs as a single replica. Verify: the architecture section mentions that the WS goes directly to ACA in production and through the Vite proxy in dev.

## 7. Continuous deployment

- [x] 7.1 Create `.github/workflows/deploy.yml` (decision 6) for `push` to `main`, with `concurrency: production`. The jobs are:
  - `test-backend` and `test-frontend`;
  - `image`: build with `APP_VERSION=${{ github.sha }}` and push to `ghcr.io/mistersnake/ugato-backend:<sha>`;
  - `infra`: OIDC login with the repo variables, anonymous image pull check with a message pointing to `docs/DEPLOYMENT.md`, `az deployment group create` and export of the outputs;
  - `frontend`: build with `VITE_WS_URL=wss://<fqdn>/api/ws`, write `dist/version.json`, obtain and mask the SWA token, and `Azure/static-web-apps-deploy` with `skip_app_build`;
  - `smoke`: retries for up to about 3 minutes comparing `/api/health.version` and `/version.json.version` with the SHA, and writes the URLs to the job summary.

  Minimum permissions per job. It is infrastructure, with no unit test. Verify with the first merge (see 8.1).
- [x] 7.2 Align `docs/DEPLOYMENT.md` with `deploy.yml` (spec `deployment`: "Guide matches the automation" and "Pipeline points to the guide"): update in the guide the final names of the jobs that have to be re-run, where the URLs appear in the job summary and the names of the outputs. Confirm that the visibility check's error message cites the exact anchor of the corresponding section. Verify: every job name, output or anchor that the guide mentions exists in `deploy.yml`, and every anchor cited in `deploy.yml` exists in the guide.

## 8. End-to-end verification

- [x] 8.1 First real deployment:
  1. run the bootstrap in Cloud Shell following only `docs/DEPLOYMENT.md`, and once more to confirm it is idempotent;
  2. merge into `main`;
  3. resolve the image visibility if asked;
  4. check that `deploy.yml` finishes green with the smoke test.

  Verify: the job summary shows both URLs, and both report the merged SHA. Also, no action outside the guide was needed; if one was, it is added to `docs/DEPLOYMENT.md` before closing the task.
- [x] 8.2 Functional validation in production:
  - open the SWA URL in two browsers, create a game, join and play several moves;
  - leave the game idle for more than 5 minutes and check that it stays connected (resolves the design's open question about `--ws-ping-interval`);
  - from the browser console on another site, `new WebSocket('wss://<fqdn>/api/ws')` fails.

  Verify: everything behaves as described. If the idle connection gets cut, adjust the ping in the Dockerfile and deploy again.
- [x] 8.3 Verify the cost: in the portal, that the resource group has only the Static Web App (Free), the environment and the container app; that the container app scales to 0 replicas after a while without traffic; and that the `ugato-monthly` budget exists. Verify: with screenshots or the output of `az resource list -g rg-ugato -o table` and `az containerapp replica list`.
- [x] 8.4 Confirm the requested flow: a small visible change, merged into `main` through a PR, appears in production without manual intervention. Verify: `/version.json` and `/api/health` show the new SHA and the change is visible on the site.

## Workflow follow-up

- Archive the change once the deployment is verified.
- Confirm that the archive creates the main `deployment` and `connection-origin` specs with their Purpose.
