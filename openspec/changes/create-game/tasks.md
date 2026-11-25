# Tasks

Every feature task is a Red-Green-Refactor cycle:
1. **Red**: write the failing test and run the suite to see it fail.
2. **Green**: write the minimal English-named code that makes it pass.
3. **Refactor**: clean up with the suite still green.

Backend tests run with `./.venv/Scripts/python.exe -m pytest -q` (from `backend/`). Frontend tests run with `npm test` (from `frontend/`).

## 1. Tooling setup (no production behavior, so no TDD cycle)

- [x] 1.1 In `backend/pyproject.toml`, replace `uvicorn` with `uvicorn[standard]` and sync the venv. Verify: `python -c "import websockets"` succeeds in the venv, and the existing `test_health` still passes.
- [x] 1.2 Add the frontend dev dependencies (`vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`), a `"test": "vitest run"` script, the `test` block in `vite.config.ts`, and `src/test/setup.ts`. Verify: a throwaway `sanity.test.ts` (`expect(1).toBe(1)`) passes with `npm test` and is then deleted. `npm run build` and `npm run lint` still pass.
- [x] 1.3 Add `server.proxy['/api'] = { target: 'http://localhost:8000', ws: true }` to `vite.config.ts`. Verify: with both dev servers running, `http://localhost:5173/api/health` returns `{"status":"ok"}`.

## 2. Backend: create-game validation (pure functions)

- [x] 2.1 Username rules (trim, 3–20 chars, printable, accents allowed).
  - Red: `tests/games/test_validation.py` covers `"  Esteban  "` → `"Esteban"`, `"Al"`, `"   "`, a 21-char name and a name containing `"\n"` → `invalid_username`, and `"Ñandú"` accepted.
  - Green: `validate_create_request` in `app/games/validation.py`, plus `ValidationError(field, code)`.
  - Refactor: extract a shared `normalize_name` helper.
  - Verify: tests green.
- [x] 2.2 Color rule.
  - Red: each of the 6 colors is accepted; `"pink"`, `""` and `None` → `invalid_color`.
  - Green: `Color` enum in `app/games/models.py`.
  - Refactor.
  - Verify: tests green.
- [x] 2.3 Game name format rules (trim, 3–20 chars, printable).
  - Red: `" Partida 1 "` → `"Partida 1"`; 2-char and 21-char names → `invalid_game_name`.
  - Green, then Refactor reusing `normalize_name`.
  - Verify: tests green.
- [x] 2.4 Max players rule.
  - Red: missing → 2; 2, 3 and 4 accepted; 1, 5 and `"2"` (string) → `invalid_max_players`.
  - Green, then Refactor.
  - Verify: tests green.
- [x] 2.5 Board rule.
  - Red: 8x8 and 30x8 accepted; 8x30, 7x7, 31x10, 10x7 and non-integers → `invalid_board`.
  - Green, then Refactor.
  - Verify: tests green.
- [x] 2.6 A valid request returns a `Game` with one `Player`, and the first failing field (in form order) wins when several are invalid.
  - Red: a full valid payload produces the expected `Game` dataclass; a payload with a bad username and a bad color reports `username`.
  - Green, then Refactor.
  - Verify: tests green.

## 3. Backend: game registry

- [x] 3.1 `GameRegistry.add` / `list` / `exists_by_name`, with case-insensitive uniqueness.
  - Red: `tests/games/test_registry.py`: after adding "Partida 1", `exists_by_name("  partida 1")` is true, and `list()` returns the game with all its data.
  - Green: dict keyed by `strip().casefold()` in `app/games/registry.py`.
  - Refactor.
  - Verify: tests green.
- [x] 3.2 `GameRegistry.remove` frees the name.
  - Red: after `remove`, `exists_by_name` is false and a new "Partida 1" can be added; removing a missing game doesn't raise.
  - Green, then Refactor.
  - Verify: tests green.

## 4. Backend: WebSocket endpoint

- [x] 4.1 `create_game` over `WS /api/ws` replies `game_created`.
  - Red: `tests/games/test_ws.py` uses `TestClient.websocket_connect("/api/ws")` with the `get_registry` dependency overridden by a fresh registry, sends a valid payload, and asserts the `game_created` body and that the registry contains the game.
  - Green: `app/games/ws.py`, mounted in `main.py`.
  - Refactor.
  - Verify: tests green.
- [x] 4.2 Validation errors are sent as `{type:"error", field, code}` and no game is created.
  - Red: a bad board → `invalid_board`, the registry is empty, and the socket stays open (a following valid `create_game` succeeds).
  - Green, then Refactor.
  - Verify: tests green.
- [x] 4.3 `name_taken` across connections.
  - Red: two concurrent `websocket_connect` sessions; the second sends `" partida 1"` after the first created "Partida 1" → `name_taken`.
  - Green, then Refactor.
  - Verify: tests green.
- [x] 4.4 `already_in_game` on the same connection.
  - Red: a second `create_game` on the same socket → `already_in_game`, and the registry still holds one game.
  - Green, then Refactor.
  - Verify: tests green.
- [x] 4.5 `cancel_game` replies `game_cancelled` and frees the name.
  - Red: after cancelling, the registry is empty and another connection can create "Partida 1".
  - Green, then Refactor.
  - Verify: tests green.
- [x] 4.6 Disconnecting removes the game.
  - Red: exit the `websocket_connect` context after creating; the registry is empty and the name is reusable.
  - Green: `try/finally` cleanup.
  - Refactor.
  - Verify: tests green.
- [x] 4.7 Malformed JSON or an unknown `type` → `invalid_message`, and the socket stays open.
  - Red, then Green, then Refactor.
  - Verify: tests green.
- [x] 4.8 Document in `backend/README.md` the WS protocol (message types and error codes) and the single-worker constraint. Verify: the documented dev command runs and `/api/health` responds.

## 5. Frontend: client-side validation and socket client

- [x] 5.1 `src/game/validation.ts` mirrors the server rules.
  - Red: `validation.test.ts` uses the same boundary values as tasks 2.1–2.5 (2/3/20/21 characters, 7/8/30/31 dimensions, height > width, players 1/2/4/5).
  - Green, then Refactor.
  - Verify: `npm test` green.
- [x] 5.2 `src/game/gameSocket.ts` with an injectable `WebSocket` constructor.
  - Red: `gameSocket.test.ts` with a `FakeWebSocket`. It asserts that `createGame` sends the `create_game` JSON once the socket opens, that `game_created` and `error` messages reach their handlers, that `cancel()` sends `cancel_game` and the close is reported as `intentional: true`, and that a server-side close is reported as `intentional: false`.
  - Green, then Refactor.
  - Verify: `npm test` green.

## 6. Frontend: screens and flow

- [x] 6.1 `HomeScreen` shows "Create game" and an optional notice.
  - Red: RTL test renders the button and the notice text when it is passed in.
  - Green, then Refactor.
  - Verify: `npm test` green.
- [x] 6.2 `CreateGameForm` fields and defaults.
  - Red: the test sees the name, game name, six color options (Red…Purple), max players defaulting to 2, and width/height defaulting to 8/8.
  - Green, then Refactor.
  - Verify: `npm test` green.
- [x] 6.3 `CreateGameForm` client-side validation blocks submission.
  - Red: entering width 8 / height 12 shows a board error and `onSubmit` is not called; valid input calls `onSubmit` with a typed `CreateGameRequest`.
  - Green, then Refactor.
  - Verify: `npm test` green.
- [x] 6.4 `CreateGameForm` shows server errors on the matching field.
  - Red: passing a `{field:"gameName", code:"name_taken"}` error renders a message next to the game name field.
  - Green, then Refactor.
  - Verify: `npm test` green.
- [x] 6.5 `WaitingScreen` shows the summary and the cancel action.
  - Red: the test sees "Waiting for players...", the game name, the creator's name and color, "1 / 2", "12 x 10" and a "Cancel game" button that calls `onCancel`.
  - Green, then Refactor.
  - Verify: `npm test` green.
- [x] 6.6 `App` state machine: home → form → waiting, with the menus locked.
  - Red: `App.test.tsx` injects a fake socket factory. Clicking "Create game", filling the form and receiving `game_created` shows the waiting screen with no "Create game" button visible.
  - Green: replace the Vite starter `App.tsx` and delete the unused starter assets/CSS.
  - Refactor.
  - Verify: `npm test`, `npm run build` and `npm run lint` pass.
- [x] 6.7 `App` handles cancel and a lost connection.
  - Red: "Cancel game" returns to home with no notice; an unintentional close returns to home showing "Connection lost, the game was removed"; a `name_taken` error keeps the form open with the error shown.
  - Green, then Refactor.
  - Verify: `npm test` green.
- [x] 6.8 `App` shows the notice after the page is refreshed while waiting.
  - Red: `App.test.tsx` remounts the app after `game_created` and expects the notice. Remounting again, or after a cancel or a handled lost connection, shows no notice.
  - Green: a `sessionStorage` flag in `src/game/waitingGameFlag.ts`.
  - Refactor.
  - Verify: `npm test`, `npm run build` and `npm run lint` pass.

## 7. End-to-end verification

- [x] 7.1 Manual check with `uvicorn app.main:app --reload` (single worker) and `npm run dev`:
  - Create "Partida 1" in tab A and see the waiting screen.
  - In tab B, creating "partida 1" shows "name taken".
  - Cancel in tab A, then tab B can create "Partida 1".
  - Refresh tab B: it returns to home with the notice, and the name is free again.
  - Verify: all of the above behave as described.
- [x] 7.2 Update the `CLAUDE.md` Commands/Architecture sections: frontend `npm test`, the WS endpoint, the Vite proxy, and the single-worker note. Verify: the documented commands run as written.
