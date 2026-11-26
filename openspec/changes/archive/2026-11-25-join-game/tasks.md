# Tasks

Every feature task is a Red-Green-Refactor cycle:
1. **Red**: write the failing test and run the suite to see it fail.
2. **Green**: write the minimal English-named code that makes it pass.
3. **Refactor**: clean up with the suite still green.

Backend tests run with `./.venv/Scripts/python.exe -m pytest -q` (from `backend/`). Frontend tests run with `npm test` (from `frontend/`).

## 1. Backend: pure join rules

- [x] 1.1 `validate_join_request`.
  - Red: `tests/games/test_validation.py` checks four cases:
    - "  Ana  " with "blue" and gameName "Partida 1" returns the game name and `Player("Ana", Color.BLUE)`.
    - "Al" raises `username`/`invalid_username`.
    - "pink" raises `color`/`invalid_color`.
    - When both are invalid, the username error wins.
    A missing or non-text `gameName` does not raise.
  - Green: `validate_join_request` in `app/games/validation.py`, reusing `normalize_name` and `parse_color`.
  - Refactor.
  - Verify: tests green.
- [x] 1.2 `check_can_join`.
  - Red: given a `Game`, it checks these cases:
    - Full game (players == max): `gameName`/`game_full`.
    - Name equal ignoring case ("esteban" vs "Esteban"): `username`/`username_taken`.
    - Color in use: `color`/`color_taken`.
    - Name and color both taken: `username_taken`.
    - Full game with a taken name: `game_full`.
    - Free name and color with room: no error.
  - Green: a pure function in `validation.py`.
  - Refactor.
  - Verify: tests green.
- [x] 1.3 `GameRegistry.find_by_name`.
  - Red: `tests/games/test_registry.py` checks that " partida 1 " finds "Partida 1", an unknown name returns `None`, and a removed game is no longer found.
  - Green: a lookup using the same casefold key.
  - Refactor.
  - Verify: tests green.

## 2. Backend: lobby order and shared fan-out

- [x] 2.1 Full games last in `lobby_snapshot`.
  - Red: `tests/games/test_lobby.py` checks three cases:
    - "Partida 1" was created before "Duel" and "Duel" is full: "Partida 1" comes first.
    - Both are full: "Duel" comes first.
    - "Duel" goes back below max: "Duel" comes first again.
    The existing newest-first test still passes.
  - Green: a stable sort by fullness after the reverse.
  - Refactor.
  - Verify: tests green.
- [x] 2.2 Extract `send_to_each`.
  - Red: a unit test with fake sockets checks that a message reaches every healthy socket even when one in the middle raises, and that the function returns the sockets that failed.
  - Green: a helper in a small shared module. `LobbyHub.broadcast` uses it and unsubscribes the failed sockets.
  - Refactor.
  - Verify: the new test and the existing `LobbyHub` tests are green.

## 3. Backend: rooms store

- [x] 3.1 `GameRooms` open, add and remove a player.
  - Red: `tests/games/test_rooms.py` uses stand-in session objects. Opening a room for a game records its host. Adding a player lists it in join order. Removing it drops it. `members(game)` returns the host plus the players.
  - Green: `Room` and `GameRooms` in `app/games/rooms.py`, plus a `get_game_rooms` dependency.
  - Refactor.
  - Verify: tests green.
- [x] 3.2 Closing a room returns its joined players and forgets it.
  - Red: `close(game)` returns the joined sessions and afterwards the room is gone. Closing an older game object that shares a reused name leaves the newer room untouched (identity guard).
  - Green: implement `close` with the identity check.
  - Refactor.
  - Verify: tests green.

## 4. Backend: join, leave and close over `WS /api/ws`

- [x] 4.1 Wire `get_game_rooms` and the session roles.
  - Red: `tests/games/test_ws.py` overrides `get_game_rooms` in the fixture. The existing create, cancel and lobby tests stay green. A new test checks that a joined player's `create_game` gets `already_in_game` and that a host's `join_game` gets `already_in_game`.
  - Green:
    - Inject the rooms into `ClientSession`.
    - Replace `self._game` with an explicit no-game, host or player state.
    - Open a room on create and close it on cancel or disconnect.
  - Refactor.
  - Verify: tests green.
- [x] 4.2 `join_game` success.
  - Red: A hosts "Partida 1" with maxPlayers 3, and C is subscribed. B sends `join_game` with gameName " partida 1 ", username "Ana" and color "blue".
    - B receives `game_joined` with both players in join order.
    - A receives `game_updated` with the same players.
    - C receives `games_list` where "Partida 1" has 2 players.
    - If B is subscribed, `game_joined` arrives before its `games_list`.
  - Green: `_join` in `ClientSession`. It runs the checks, the append and the room add in one synchronous block, then sends.
  - Refactor.
  - Verify: tests green.
- [x] 4.3 `join_game` errors and order.
  - Red: one test per code, with its `field`:
    - `invalid_username`
    - `invalid_color`
    - `game_not_found`, for an unknown name and for a missing `gameName`
    - `game_full`
    - `username_taken`
    - `color_taken`
    Then the order cases: name and color both taken gives `username_taken`, and "Al" with an unknown game gives `invalid_username`. A rejected join sends no `game_updated` to the host and no `games_list` to subscribers. The socket stays open after each error.
  - Green: map the `ValidationError`s to `send_error`.
  - Refactor.
  - Verify: tests green.
- [x] 4.4 Last-seat race.
  - Red: a game has maxPlayers 2 and 1 player. Two sessions call `handle(join_game)` concurrently through `asyncio.gather` with fake websockets, using the existing `ClientSession` test style. Exactly one gets `game_joined` and the other gets `game_full`, and the game has 2 players.
  - Green: should already pass. If not, remove the `await` between check and append.
  - Refactor.
  - Verify: tests green.
- [x] 4.5 `leave_game` and player disconnect.
  - Red:
    - B leaves: B gets `game_left`, A gets `game_updated` without B, and a subscriber gets `games_list`.
    - B's name and color can be reused by a new joiner.
    - B can join again on the same socket.
    - B closes its socket instead: A gets `game_updated` and the subscriber gets `games_list`.
    - The host sends `leave_game`: it gets `game_left` and the game is unchanged.
    - `leave_game` with no game: `game_left` and nothing else.
  - Green: `_leave`, plus the player branch in `close()`.
  - Refactor.
  - Verify: tests green.
- [x] 4.6 Host cancel or disconnect closes the game for players.
  - Red:
    - A hosts and B joins. A cancels: A gets `game_cancelled`, B gets `game_closed`, and the subscribers get `games_list` without the game.
    - After `game_closed`, B can `create_game` or `join_game`, and B's `leave_game` is a no-op `game_left`.
    - The same happens when A's socket closes instead of cancelling.
    - B's `cancel_game` gets `game_cancelled` and leaves the game intact.
    - A send to B that fails does not stop the lobby broadcast.
  - Green: on host end, `rooms.close(game)` and `registry.remove` run in the same synchronous step. Each joined session is told to clear its state and is sent `game_closed` through `send_to_each`.
  - Refactor.
  - Verify: tests green.
- [x] 4.7 Document the protocol in `backend/README.md`:
  - `join_game` and `leave_game`
  - `game_joined`, `game_left`, `game_updated` and `game_closed`
  - the new error codes and the join error order
  - the lobby order (full games last)
  - the rule that a host leaving closes the game for its players
  - one game per connection, in either role
  Verify: every message name, field and code in the README matches the ones used by the tests in 4.1-4.6.

## 5. Frontend: types, validation and socket client

- [x] 5.1 Join draft validation.
  - Red: `validation.test.ts` checks that `validateJoinDraft` reports `invalid_username` for "Al", `invalid_color` for an empty color, and nothing for "Ana"/"blue", in the same order as the server.
  - Green: `validateJoinDraft` in `validation.ts`, mirroring `validate_join_request`.
  - Refactor.
  - Verify: tests green.
- [x] 5.2 New messages in `gameSocket.ts`.
  - Red: `gameSocket.test.ts` uses `FakeWebSocket`:
    - `joinGame({gameName, username, color})` sends `join_game`, queued until open.
    - `leave()` sends `leave_game` without closing.
    - Incoming `game_joined`, `game_updated` and `game_closed` reach their handlers.
    - An `error` with `game_full` reaches the error handler.
  - Green: add the types to `types.ts` (messages, `JoinGameRequest`, the error codes), the events, and the methods.
  - Refactor.
  - Verify: `npm test` green and `npx tsc -b` clean.
- [x] 5.3 Error messages for the new codes.
  - Red: a test checks that `ERROR_MESSAGES` has English text for `game_not_found`, `game_full`, `username_taken` and `color_taken`. This is enforced by the `Record<ErrorCode, string>` type plus one assertion on `username_taken`.
  - Green: add the entries.
  - Refactor.
  - Verify: tests green and `npx tsc -b` clean.

## 6. Frontend: lobby rows and screens

- [x] 6.1 Join button and Full state in `HomeScreen`.
  - Red: `HomeScreen.test.tsx` checks the rows:
    - A game with room shows a "Join" button that calls `onJoin("Partida 1")`.
    - A full game shows "Full" and no "Join" button.
    - Clicking a row outside the button calls nothing.
    The existing layout tests stay green.
  - Green: an `onJoin` prop, plus a full check (`players.length >= maxPlayers`).
  - Refactor.
  - Verify: tests green.
- [x] 6.2 `JoinGameForm`.
  - Red: `JoinGameForm.test.tsx`, given "Partida 1" with a red player:
    - It shows "Partida 1", red is disabled, and the other colors are enabled.
    - "Al" shows a name error and blocks submit.
    - With no color chosen, submit is blocked.
    - A valid submit calls `onSubmit({gameName, username, color})`.
    - "Back" calls `onBack`.
    - `serverError` `username_taken` shows on the name field, and `color_taken` shows on the color field.
    - Rerendering with blue now taken while blue is selected disables blue and leaves no color selected.
  - Green: a new screen, with the selected color derived from the taken colors.
  - Refactor.
  - Verify: tests green.
- [x] 6.3 `WaitingScreen` player list and role.
  - Red: `WaitingScreen.test.tsx` checks the following:
    - For the host role, it lists "Esteban (host)" and "Ana", shows the count "2 / 3", and has a "Cancel game" button that calls `onLeave`.
    - For the player role, it shows "Leave game" instead.
    - A rerender with a new game updates the list and count.
    The existing host assertions are updated to the list format.
  - Green: a `role` prop and the player list rendering.
  - Refactor.
  - Verify: tests green.

## 7. Frontend: App flow

- [x] 7.1 Role-aware waiting flag.
  - Red: a `waitingGameFlag` test checks that `set('player')` then `get()` returns `'player'`, that a legacy `'true'` value reads as `'host'`, and that `clear()` removes it.
  - Green: store the role.
  - Refactor.
  - Verify: tests green.
- [x] 7.2 Join flow.
  - Red: `App.test.tsx`, after a `games_list` with "Partida 1":
    - Clicking "Join" shows the join form with no message sent.
    - Submitting sends `join_game` on the same socket.
    - A `game_joined` shows the player waiting room with "Leave game", and the flag is `'player'`.
    - "Back" returns to the lobby.
  - Green: the `join` view and `joinGame`, plus `waiting` with a `role`.
  - Refactor.
  - Verify: tests green.
- [x] 7.3 The join form follows the lobby, and errors are routed.
  - Red: on the join form for "Duel":
    - A `games_list` where "Duel" is full goes to the lobby with "That game is full".
    - A `games_list` without "Duel" goes to the lobby with "That game is no longer available".
    - A server `game_full` or `game_not_found` gives the same results.
    - `username_taken` stays on the form with the field error.
    - An unintentional close goes to the disconnected lobby with no notice.
    The create-form error routing still works.
  - Green: a functional `setView` in the `games_list` and `error` handlers.
  - Refactor.
  - Verify: tests green.
- [x] 7.4 Live roster and leaving.
  - Red:
    - In the waiting room (both roles), `game_updated` updates the list.
    - As a player, "Leave game" sends `leave_game`, returns to the lobby with no notice, does not close or create a socket, and clears the flag.
    - `game_closed` returns to the lobby with "The host closed the game", "Create game" enabled, and the flag cleared.
  - Green: the handlers in `App.tsx`.
  - Refactor.
  - Verify: tests green.
- [x] 7.5 Connection loss and refresh as a player.
  - Red:
    - As a player, an unintentional close shows "Connection lost, you left the game" with the disconnected lobby.
    - Loading with the flag set to `'player'` shows the same notice once.
    - The host versions still show "Connection lost, the game was removed".
  - Green: notices chosen by role in `viewAfterConnectionLoss` and `initialView`.
  - Refactor.
  - Verify: tests green.

## 8. Integration check

- [x] 8.1 Full suites and build. In the backend, `pytest -q` is green. In the frontend, `npm test`, `npm run lint` and `npm run build` are all green.
- [x] 8.2 Manual end-to-end check with both dev servers and three browser tabs:
  - A creates "Partida 1" with maxPlayers 3.
  - In B, the red color is disabled on the join form. B joins as "Ana" (blue), and A's waiting screen shows Ana live.
  - In C, the join form for "Partida 1" disables red and blue. C tries "ana" and gets a name error. C joins as "Luis" (green), and the lobby row shows Full and moves to the bottom.
  - C leaves, and the row returns with "Join".
  - A cancels, and B sees "The host closed the game".
  - B creates a game and C joins it. B closes its tab, and C sees "The host closed the game".
  - A player who refreshes sees "Connection lost, you left the game".
  - All UI text is in English.

## Workflow follow-up

- Archive the change after review. Archiving moves `game-joining` into `openspec/specs/` and applies the `game-lobby` and `game-creation` deltas.
