# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Two independent apps plus OpenSpec planning artifacts, all in one git repo at the root (no root-level build or task runner):

- `backend/` — FastAPI app, Python 3.14, managed with `uv` (`pyproject.toml` + `uv.lock`).
- `frontend/` — React 19 + TypeScript + Vite 8 app, npm (`package-lock.json`).
- `openspec/` — OpenSpec config (`config.yaml`, schema `spec-driven`), `specs/` and `changes/` folders for spec-driven changes.

Run commands from inside the relevant subdirectory.

## Commands

### Backend (`cd backend`)

- Run tests: `./.venv/Scripts/python.exe -m pytest -q` (Windows venv; `uv run pytest` currently fails on this machine with "uv trampoline failed to canonicalize script path", so prefer the venv binary).
- Single test: `./.venv/Scripts/python.exe -m pytest tests/test_health.py::test_health -q`
- Dev server: `./.venv/Scripts/python.exe -m uvicorn app.main:app --reload` (serves on port 8000; API routes live under `/api`). Run a single worker and never pass `--workers`: the game registry lives in process memory.

### Frontend (`cd frontend`)

- Install: `npm install`
- Dev server: `npm run dev` (Vite, port 5173)
- Build: `npm run build` (runs `tsc -b` then `vite build`, output to `dist/`; `dist/` is generated, don't hand-edit it)
- Lint: `npm run lint` (oxlint, config in `.oxlintrc.json`)
- Type-check only: `npx tsc -b`
- Run tests: `npm test` (Vitest + React Testing Library on jsdom; setup in `src/test/setup.ts`)
- Single test file: `npm test -- src/App.test.tsx`

## Architecture: how the pieces connect

- `backend/app/main.py` holds the `FastAPI` instance, `GET /api/health`, and mounts the game router. New routes should go under the `/api` prefix so the Vite proxy forwards them.
- Games use one WebSocket, `WS /api/ws` (`backend/app/games/ws.py`). The message types and error codes are documented in `backend/README.md`. Before the start, a game lives only as long as its creator's connection. After the start, the host is an ordinary player, so their leaving or disconnecting does not close the game.
- `backend/app/games/` also has the models, the pure validation rules and the in-memory `GameRegistry`. Tests override the `get_registry` dependency to get a fresh registry.
- Because the registry is process memory, the server must run as a single worker. With more, name uniqueness breaks.
- `frontend/vite.config.ts` proxies `/api` (with `ws: true`) to `http://localhost:8000`, so the frontend uses same-origin URLs. CORS in `app/main.py` still allows only `http://localhost:5173` for direct HTTP calls to port 8000; it does not apply to WebSockets.
- `frontend/src/App.tsx` is the screen state machine (home → form or join → waiting → playing → finished). Screens are in `src/screens/`. Components never use `WebSocket` directly: they go through `src/game/gameSocket.ts`, and tests inject `src/test/FakeWebSocket.ts`.
- `frontend/src/game/validation.ts` mirrors `backend/app/games/validation.py`. The server is the source of truth, so change both together.
- Tests in `backend/tests/` use `fastapi.testclient.TestClient` against `app.main.app` directly; no server needs to be running.

## Conventions

- Frontend TypeScript is strict: `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`, and `verbatimModuleSyntax` are on, so type-only imports need `import type`. Run `npm run build` (not just `vite`) to catch type errors, since `vite` alone doesn't type-check.
- Lint rules enforced by oxlint: `react/rules-of-hooks` (error) and `react/only-export-components` (warn).
- OpenSpec: spec-driven changes are proposed and applied through the `openspec-*` skills; `openspec/config.yaml` holds the project-specific constraints for those artifacts. Keep general project documentation out of it.
