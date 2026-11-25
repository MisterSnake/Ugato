# Tasks

Every feature task is a Red-Green-Refactor cycle:
1. **Red**: write the failing test and run the suite to see it fail.
2. **Green**: write the minimal English-named code that makes it pass.
3. **Refactor**: clean up with the suite still green.

Backend tests run with `./.venv/Scripts/python.exe -m pytest -q` (from `backend/`). Frontend tests run with `npm test` (from `frontend/`).

## 1. Backend: lobby snapshot and hub (no socket endpoint yet)

- [x] 1.1 Snapshot ordering and shape.
  - Red: `tests/games/test_lobby.py` checks that `lobby_snapshot(registry)` returns `{"type": "games_list", "games": []}` for an empty registry, and lists "Duel" before "Partida 1" when "Partida 1" was added first, with each entry matching `game_summary`.
  - Green: `lobby_snapshot` in `app/games/lobby.py`, reusing `game_summary` (move it out of `ws.py` if needed to avoid a circular import).
  - Refactor.
  - Verify: tests green.
- [x] 1.2 `LobbyHub` subscribe and broadcast.
  - Red: with fake sockets recording `send_json` calls: two subscribers each receive a broadcast message once; subscribing the same socket twice still delivers once; an unsubscribed socket receives nothing.
  - Green: `LobbyHub` with a `set` of subscribers, plus `get_lobby_hub` returning a module-level instance.
  - Refactor.
  - Verify: tests green.
- [x] 1.3 A failed subscriber does not block the others.
  - Red: a fake socket whose `send_json` raises sits between two healthy ones. A broadcast reaches both healthy sockets, and the failing one is no longer subscribed afterwards.
  - Green: per-send `try/except` in `broadcast`.
  - Refactor.
  - Verify: tests green.

## 2. Backend: lobby over `WS /api/ws`

- [x] 2.1 `subscribe_lobby` replies with a snapshot.
  - Red: in `tests/games/test_ws.py`, override `get_lobby_hub` with a fresh hub next to the existing `get_registry` override. Subscribing to an empty registry gets `games_list` with `[]`. With "Partida 1" created on another connection, subscribing gets a list containing it. Subscribing twice gets two snapshots, and a later creation is received once.
  - Green: rename `CreatorSession` to `ClientSession`, inject the hub, and handle `subscribe_lobby`.
  - Refactor.
  - Verify: tests green, and the existing creation tests still pass.
- [x] 2.2 Broadcast on create.
  - Red: client A subscribes, client B creates "Partida 1". B receives `game_created` before any `games_list`, and A receives `games_list` containing "Partida 1". An invalid `create_game`, `name_taken` or `already_in_game` from B sends A nothing new.
  - Green: broadcast after `registry.add` and after `game_created` is sent.
  - Refactor.
  - Verify: tests green.
- [x] 2.3 Broadcast on cancel and disconnect. The connection stays open after cancel.
  - Red:
    - A subscribed, B cancels "Partida 1" → A gets a list without it.
    - B closes its socket → A gets a list without it.
    - A cancel with no game sends A nothing.
    - After cancel, B can send `create_game` again on the same socket and succeed.
    - A subscribed creator keeps receiving updates about other games.
  - Green: `end_game()` returns whether it removed a game. The `finally` block unsubscribes first, then removes, then broadcasts only if something was removed.
  - Refactor.
  - Verify: tests green.
- [x] 2.4 Document `subscribe_lobby` and `games_list` in the `backend/README.md` protocol tables, and note that `cancel_game` leaves the connection open. Verify: the message names and fields in the README match the ones the tests in 2.1-2.3 use.

## 3. Frontend: socket client

- [x] 3.1 Types for the new messages.
  - Red: a `gameSocket.test.ts` case uses `FakeWebSocket` to deliver `{type: "games_list", games: [...]}` and expects a `games_list` handler to receive the array. It fails because the event doesn't exist yet.
  - Green: add `games_list` to `ServerMessage` in `types.ts` and to `GameSocketEvents`, and emit it in `gameSocket.ts`.
  - Refactor.
  - Verify: `npm test` green, `npx tsc -b` clean.
- [x] 3.2 `subscribeLobby()`.
  - Red: calling it before `open` queues `{type: "subscribe_lobby"}` and sends it once the fake opens. Calling it after `open` sends immediately.
  - Green: `subscribeLobby()` reuses `send`.
  - Refactor.
  - Verify: tests green.
- [x] 3.3 `cancel()` no longer closes the socket.
  - Red: update the existing cancel test to expect that `cancel()` sends `cancel_game` and the fake is **not** closed, and that no `close` event fires. Keep the test that `close()` reports `intentional: true`.
  - Green: remove `close()` from `cancel()`.
  - Refactor.
  - Verify: tests green.

## 4. Frontend: lobby screen

- [x] 4.1 `HomeScreen` lobby states.
  - Red: `HomeScreen.test.tsx` renders the component with a `lobby` prop and checks that:
    - `connecting` shows "Loading games..." and a disabled "Create game".
    - `ready` with `[]` shows "No games yet. Create one!" and an enabled "Create game".
    - `disconnected` shows "Can't reach the server.", a "Retry" button that calls `onRetry`, and a disabled "Create game".
    - The notice still renders when given.
  - Green: new props, plus a `LobbyState` type in `game/types.ts`.
  - Refactor.
  - Verify: tests green.
- [x] 4.2 Game rows and layout.
  - Red: `ready` with "Partida 1" (host "Esteban", red, 1 of 2 players, 12 x 10) and "Duel" shows the "Create game" button before the "Open games" heading. It also shows a row containing "Partida 1", "Esteban", the "Red" color label, "1 / 2" and "12 x 10", with rows in the given order. Clicking a row calls no handler and changes nothing.
  - Green: a list rendering using `colorLabel`.
  - Refactor.
  - Verify: tests green.

## 5. Frontend: App lifecycle with one socket per tab

- [x] 5.1 Connect and subscribe on load.
  - Red: `App.test.tsx` uses the injected fake factory. Rendering `App` creates exactly one socket and sends `subscribe_lobby`. "Loading games..." shows until the fake delivers `games_list`, then the games show and "Create game" becomes enabled. Unmounting closes the socket intentionally.
  - Green: a `connect()` called from a mount effect, with lobby state in `App`.
  - Refactor.
  - Verify: tests green.
- [x] 5.2 Creating uses the existing socket.
  - Red: after `games_list`, opening the form and submitting sends `create_game` on the **same** fake socket, and the factory is not called again. Update the old tests that expected the socket to be created on submit.
  - Green: `createGame` uses `socketRef.current` and no longer opens a socket.
  - Refactor.
  - Verify: tests green.
- [x] 5.3 Cancel returns to a current lobby over the same connection.
  - Red: on the waiting screen, the fake delivers a `games_list` containing "Duel". Clicking "Cancel game" sends `cancel_game`, shows the lobby with "Duel" and an enabled "Create game", does not close the fake, and creates no new socket. The waiting flag is cleared.
  - Green: update `cancelGame`. Keep handling `games_list` while the waiting screen is shown.
  - Refactor.
  - Verify: tests green.
- [x] 5.4 Connection lost on each screen.
  - Red:
    - On the lobby, an unintentional close shows the disconnected state.
    - On the form, it returns to the lobby in the disconnected state with no notice.
    - On the waiting screen, it shows the lobby with "Connection lost, the game was removed", the disconnected state and "Retry", and clears the flag.
    - The page-refresh notice tests still pass.
  - Green: update the `close` handler.
  - Refactor.
  - Verify: tests green.
- [x] 5.5 Manual retry with no automatic reconnect.
  - Red:
    - When disconnected, no new socket is created, even after advancing fake timers.
    - Clicking "Retry" creates one new socket, sends `subscribe_lobby`, shows "Loading games...", and shows the list after `games_list`.
  - Green: `onRetry` calls `connect()`.
  - Refactor.
  - Verify: tests green.

## 6. Integration check

- [x] 6.1 Full suites and build: the backend runs `pytest -q` green. The frontend runs `npm test`, `npm run lint` and `npm run build`, all green.
- [x] 6.2 Manual end-to-end check with both dev servers and two browser tabs:
  - Tab A sees the empty lobby.
  - Tab B creates "Partida 1", and it appears in A without a refresh.
  - B cancels, and it disappears from A while B is back on the lobby.
  - B creates again and closes its tab, and the game disappears from A.
  - Stopping the backend shows "Can't reach the server." with "Create game" disabled. After restarting the backend, "Retry" restores the list.
  - All UI text is in English.

## Workflow follow-up

- Archive the change after review, which moves `game-lobby` into `openspec/specs/` and applies the `game-creation` MODIFIED requirements.
