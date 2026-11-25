# Design

## Context

- The backend is one FastAPI app (`backend/app/main.py`) with only `GET /api/health`. CORS allows `http://localhost:5173`. Tests use `fastapi.testclient.TestClient`.
- `backend/pyproject.toml` depends on plain `uvicorn`, which has **no WebSocket implementation**. The real server would reject WS upgrades, but `TestClient` would still pass.
- The frontend is the Vite starter (`App.tsx`) rendered inside `<StrictMode>`. It has no API client, no proxy and no test runner.
- Project rules: strict TDD for all production code; code, identifiers and tests in English. See proposal.md for the motivation and specs/game-creation/spec.md for the behavior.

## Goals / Non-Goals

**Goals:**
- A game's lifetime is the same as its creator's WebSocket connection, by construction.
- Rules live in pure functions and a registry class that can be tested without a socket.
- The frontend never touches `WebSocket` directly in components, so they can be tested with a fake.

**Non-Goals:**
- Running on multiple workers or servers. There is no shared store.
- Reconnecting or resuming after a refresh.
- Broadcasting to other players, which belongs to a later "join game" story.

## Decisions

### D1. A single WebSocket channel carries the whole game lifecycle
The client opens `WS /api/ws` only when the form is submitted, then exchanges JSON messages:

```
client -> server                                   server -> client
{type:"create_game", username, color, gameName,    {type:"game_created", game:{name, maxPlayers,
 maxPlayers?, boardWidth, boardHeight}              boardWidth, boardHeight, players:[{name,color}]}}
{type:"cancel_game"}                               {type:"error", field?, code}
                                                   {type:"game_cancelled"}
```

Error codes:

| Code | Meaning |
|---|---|
| `invalid_username` | Username fails the name rules |
| `invalid_color` | Color is not one of the six allowed values |
| `invalid_game_name` | Game name fails the name rules |
| `name_taken` | Another game already uses this name |
| `invalid_max_players` | Max players is outside 2–4 |
| `invalid_board` | Board dimensions are out of range or height > width |
| `already_in_game` | This connection already has a game |
| `invalid_message` | Malformed JSON or unknown `type` (the socket stays open) |

Validation reports the **first** failing field, checked in form order. That keeps the protocol simple, while the client checks every field before submitting anyway.

*Alternative:* REST `POST /api/games` followed by a WS attach. Rejected, because a game could exist with no socket between the two steps and would need a timeout to clean it up.

### D2. Backend modules
```
backend/app/
  main.py              # mounts the WS route, keeps /api/health
  games/
    models.py          # Color enum (red..purple), Player, Game dataclasses
    validation.py      # pure: normalize + validate a create request -> Game | ValidationError(field, code)
    registry.py        # GameRegistry: add, remove, exists_by_name (case-insensitive), list
    ws.py              # WebSocket endpoint: parse messages, call validation/registry, cleanup in finally
```
- `GameRegistry` is an in-memory dict keyed by `name.strip().casefold()`. A single instance is created at module level and exposed through a FastAPI dependency (`get_registry`), so each test can override it with a fresh registry.
- The endpoint tracks `current_game` per connection. A `try/finally` around the receive loop calls `registry.remove(...)` on `WebSocketDisconnect` or any other exit. This one place enforces both "disconnect removes the game" and "the name is freed".
- `exists_by_name` + `add` run without an `await` between them on the single event loop, so the uniqueness check is atomic without locks.
- The "printable" rule is `str.isprintable()` after `strip()`, with length counted in code points (3–20).

*Alternative considered:* a shared store such as Redis so multiple workers can be used. Deferred. The `GameRegistry` interface is the seam where a Redis-backed implementation would go later. A WebSocket can't move between processes, so cross-worker play would also need pub/sub.

### D3. Single worker
The server runs with one uvicorn worker. That's documented in the backend README, and `--workers` must not be used. An asyncio process handles thousands of mostly idle lobby sockets, which is plenty for this stage.

### D4. Frontend structure
```
frontend/src/
  game/
    types.ts            # Color, CreateGameRequest, GameSummary, server message union
    validation.ts       # pure client-side rules (mirror of the server's)
    gameSocket.ts       # createGameSocket(url, WebSocketImpl?) -> { createGame, cancel, close, on(event) }
  screens/
    HomeScreen.tsx
    CreateGameForm.tsx
    WaitingScreen.tsx
  App.tsx               # screen state machine: home -> form -> waiting -> home
```
- `App` holds a `screen` state (`home | form | waiting`), plus an optional notice and the current `GameSummary`. Rendering only the current screen is what "locks" the user in the waiting screen.
- `gameSocket.ts` takes an injectable `WebSocket` constructor. Tests pass a `FakeWebSocket` that records sent messages and can simulate `open`, `message` and `close`.
- **StrictMode:** the socket is created in the form's submit handler, never in a mount effect. A cleanup effect in `App` closes it on unmount. So the double effect run in development can't create and then delete a game.
- Telling a cancel from a lost connection: on cancel, `gameSocket` sets an `intentionalClose` flag before closing. Its `close` event then reports `{ intentional: boolean }`, and `App` shows "Connection lost, the game was removed" only when the close was not intentional.
- **Notice after a refresh:** a reload discards React state, so `game/waitingGameFlag.ts` keeps a flag in `sessionStorage` (per tab, and it survives a reload). It holds no username or game data. `App` sets it on `game_created` and clears it on cancel or when it handles a lost connection. On load, a set flag means the home screen starts with the notice. The state initializer only reads the flag and an effect clears it, because StrictMode runs initializers twice.
- UI text is in English. The form shows colors as Red, Blue, Yellow, Green, Orange, Purple.

### D5. Dev wiring
- `vite.config.ts`:
  - `server.proxy['/api'] = { target: 'http://localhost:8000', ws: true }`, so the browser uses a same-origin `ws://localhost:5173/api/ws` (built from `location`).
  - `test: { environment: 'jsdom', setupFiles: './src/test/setup.ts' }`, where the setup file imports `@testing-library/jest-dom/vitest`.
- `package.json`: `"test": "vitest run"`, plus dev dependencies `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`.
- `pyproject.toml`: `uvicorn[standard]`.
- CORS stays as it is. WebSocket connections aren't covered by CORS, and the proxy makes them same-origin anyway.

## Risks / Trade-offs

- [A refresh deletes the game] → Accepted on purpose (identity lives only as long as the match). The UI shows the "connection lost" notice so the user understands.
- [Duplicating a tab copies `sessionStorage`, so the copy of a waiting tab also shows the notice] → Accepted. The original game is not affected.
- [Someone starts the server with `--workers N`, breaking uniqueness] → Document it in the README and in the dev command in CLAUDE.md. No runtime guard in this slice.
- [Plain `uvicorn` passes the tests but fails in a real browser] → Switch to `uvicorn[standard]` in the first task. The manual end-to-end check in the final task catches any regression.
- [Client and server validation rules drift apart] → The server is the source of truth, and the client displays server errors on the matching field. Both rule sets are tested against the same boundary values (2/3 and 20/21 characters, 7/8 and 30/31 for dimensions, 1/2 and 4/5 for players).
- [Half-open TCP connections, e.g. a laptop sleeps, keep a game alive for a while] → Uvicorn's WebSocket ping (enabled by default with `websockets`) eventually closes them. Accepted for this slice.

## Migration Plan

Nothing to migrate: this is new functionality with no persisted data. To roll back, revert the change. A server restart clears every game.
