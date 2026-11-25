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
- Dev server: `./.venv/Scripts/python.exe -m uvicorn app.main:app --reload` (serves on port 8000; API routes live under `/api`).

### Frontend (`cd frontend`)

- Install: `npm install`
- Dev server: `npm run dev` (Vite, port 5173)
- Build: `npm run build` (runs `tsc -b` then `vite build`, output to `dist/`; `dist/` is generated, don't hand-edit it)
- Lint: `npm run lint` (oxlint, config in `.oxlintrc.json`)
- Type-check only: `npx tsc -b`
- There is no frontend test runner configured.

## Architecture: how the pieces connect

- The backend's only API surface is `app/main.py`: a single `FastAPI` instance with `GET /api/health`. New routes should go under the `/api` prefix so they match what the frontend calls.
- CORS is restricted to `http://localhost:5173` (the Vite dev server origin) in `app/main.py`. If the frontend runs on a different origin, or is served from the backend, update `allow_origins` there. Otherwise browser requests from the frontend fail even though curl works.
- The frontend currently has no API client and no proxy: `frontend/vite.config.ts` only registers the React plugin. Calls to `/api/...` from the frontend therefore need either an absolute URL to `http://localhost:8000` (which CORS allows only from 5173) or a Vite `server.proxy` entry for `/api` added to `vite.config.ts`.
- `frontend/src/App.tsx` is still the unmodified Vite starter page (counter, logos, links). Treat it as placeholder, not as a design to preserve.
- Tests in `backend/tests/` use `fastapi.testclient.TestClient` against `app.main.app` directly; no server needs to be running.

## Conventions

- Frontend TypeScript is strict: `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`, and `verbatimModuleSyntax` are on, so type-only imports need `import type`. Run `npm run build` (not just `vite`) to catch type errors, since `vite` alone doesn't type-check.
- Lint rules enforced by oxlint: `react/rules-of-hooks` (error) and `react/only-export-components` (warn).
- OpenSpec: spec-driven changes are proposed and applied through the `openspec-*` skills; `openspec/config.yaml` holds the project-specific constraints for those artifacts. Keep general project documentation out of it.
