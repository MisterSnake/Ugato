# Design

## Context

See proposal.md for the motivation and specs/ for the required behavior.

Current state:
- `ClientSession` (`backend/app/games/ws.py`) is created once per connection. It handles `subscribe_lobby`, `create_game` and `cancel_game`. It knows a single role, host, held in `self._game`.
- `GameRegistry` keeps games in an insertion-ordered dict keyed by casefolded name. Insertion order is creation order.
- `LobbyHub` broadcasts `games_list` to subscribers. A failure on one send never blocks the others.
- Pure rules live in `validation.py`, which `frontend/src/game/validation.ts` mirrors.
- On the frontend:
  - `App.tsx` is the view state machine (`home`, `form`, `waiting`). It owns the single socket.
  - Socket `error` events always route to the create form.
  - `waitingGameFlag` is a boolean in sessionStorage. It produces the "Connection lost" notice after a refresh.

Constraints:
- A single worker. All state is in process memory.
- Strict TDD.
- English code.
- The server is the source of truth for every rule.

## Goals / Non-Goals

**Goals:**
- Join, leave and close operations are atomic with respect to the in-memory state. No `await` may sit between a check and its mutation.
- A joined player's session always learns when its game is gone, so it never holds a stale reference.
- Reuse the existing validation, broadcast and screen code instead of building parallel versions.

**Non-Goals:**
- A generic room or pub-sub framework. Rooms exist only to fan out messages to one game's connections.
- Client-side checks for username uniqueness. The server reports it, and the form only disables taken colors.
- Persisting a player's identity across refreshes.

## Decisions

### 1. A `GameRooms` store that maps each game to its joined sessions
New module `app/games/rooms.py`. A `Room` holds the `Game`, the host `ClientSession`, and the list of joined `ClientSession`s with their `Player`. `GameRooms` maps each live game to its room. It is injected through a `get_game_rooms` dependency, the same way as `get_registry` and `get_lobby_hub`, and tests override it with a fresh instance.

Rooms hold **sessions**, not raw websockets. When the host leaves, the host's session can then tell each joined session to drop its game state *and* send `game_closed`, so no session is left pointing at a removed game.

Alternatives considered:
- (a) Store the members on `Game`. This mixes connection objects into a pure data model that `validation.py` and the tests build directly.
- (b) Topic support in `LobbyHub`. Fan-out alone does not solve the stale-session problem.
- (c) A joined session looks up its game in the registry on each action. That still requires pushing `game_closed`, so it adds a second source of truth.

A room is created with the game and removed in the same synchronous step as `registry.remove`, guarded by object identity the same way the registry guards a reused name.

### 2. Session roles as explicit state
`ClientSession` replaces `self._game` with one of three states: no game, host of a room, or player in a room (with its `Player`). Each handler checks the state first:
- `create_game` and `join_game` reject with `already_in_game` unless the connection has no game.
- `cancel_game` acts only for a host.
- `leave_game` acts only for a player.

A mismatched `cancel_game` or `leave_game` is a no-op that still sends its confirmation. This matches how `cancel_game` already behaves without a game, and lets the client navigate optimistically without waiting for a reply.

### 3. Join validation in two pure steps
Both steps live in `validation.py` and raise `ValidationError`:
1. `validate_join_request(payload)` checks the username and color with the existing `normalize_name` and `parse_color`, and returns the requested game name and the `Player`. A missing or non-text `gameName` is not rejected here. It falls through to `game_not_found`.
2. `check_can_join(game, player)` checks `game_full`, then `username_taken` (casefold comparison), then `color_taken`.

The session runs, in one synchronous block:
1. `already_in_game`.
2. Step 1.
3. Registry lookup (`game_not_found`).
4. Step 2.
5. Append the player and add the session to the room.

Only then does it start sending. This gives the spec's error order and makes the last-seat race safe: the event loop cannot interleave two joins between the check and the append. The registry gains `find_by_name(name) -> Game | None`, which uses the same casefold key.

Alternative: a single `validate_join_request(payload, game)`. This was rejected because the lookup has to happen between the input checks and the game checks to keep the agreed error order.

### 4. Message order and fan-out
- **Join:** `game_joined` to the joiner, then `game_updated` to the host and the other players, then `games_list` to the lobby.
- **Leave or player disconnect:** `game_left` to the leaver (not sent on a disconnect), then `game_updated` to those remaining, then `games_list`.
- **Host cancel or host disconnect:** `game_cancelled` to the host (not sent on a disconnect), then `game_closed` to each joined player, then `games_list`.

Each fan-out sends to a copy of the member list, with a per-send `try/except`, like `LobbyHub.broadcast`. A shared helper `send_to_each(sockets, message)` is extracted so the hub and the rooms use the same tolerant loop. A failed send never undoes state, because that connection's own `close()` cleans it up.

### 5. Lobby order
`lobby_snapshot` takes the registry's creation-ordered list, reverses it (newest first), and then stable-sorts it by `len(players) >= max_players`. Rooms with space come first and full rooms last, each group still newest first. A game that drops below full goes back to its place by creation order automatically. `game_summary` is unchanged, and the client derives "Full" from `players.length >= maxPlayers`.

### 6. Frontend view state
`App.tsx` views become:
- `home`
- `form` (create)
- `join { gameName, serverError? }`
- `waiting { game, role: 'host' | 'player' }`

- **Live join form:** the `join` view stores only the game *name*. Each render looks the game up in `lobby.games`. The `games_list` handler also updates the view with a functional `setView`: if the user is on `join` and the game is missing or full, the view becomes `home` with the right notice. Navigation stays in event handlers, never in effects.
- **Error routing:** the socket `error` handler routes by the current view. On `join`, `game_full` and `game_not_found` go home with a notice, and other codes stay on the form as `serverError`. On `form`, the behavior is unchanged.
- **`JoinGameForm`:** a new screen. Its props are the looked-up `GameSummary`, `onSubmit`, `onBack` and `serverError`. Taken colors come from `game.players`. The selected color is *derived* (`taken.has(color) ? '' : color`), so a color taken meanwhile is unselected without an effect. Its client rules come from a new `validateJoinDraft` in `validation.ts`, which mirrors `validate_join_request`.
- **`WaitingScreen`:**
  - It takes a `role` prop and renders the player list, with "(host)" on `players[0]`, and the live count.
  - The button reads "Cancel game" for the host and "Leave game" for a player.
  - `game_updated` replaces `view.game` while on `waiting`.
- **`gameSocket.ts`:** adds `joinGame(request)`, `leave()`, and the events `game_joined`, `game_updated` and `game_closed`. `game_left`, like `game_cancelled`, needs no handler, because the client has already navigated.
- **`waitingGameFlag`:** stores the role (`'host' | 'player'`) instead of `'true'`. `initialView` chooses "Connection lost, the game was removed" or "Connection lost, you left the game". A legacy `'true'` value is read as host. The connection-loss handler uses `view.role` the same way.

### 7. Documentation
The `backend/README.md` protocol tables gain:
- the new client and server messages
- the new error codes
- the join error order
- the host-leaves-closes-the-game lifecycle

## Risks / Trade-offs

- [Stale lobby data on the join form] → The live updates narrow the window, and the server checks again on every join. `color_taken` and `username_taken` keep the user on the form, and the color gets disabled by the next `games_list`.
- [A room left behind after its game is removed (memory leak, or a reused name reaching old members)] → Room removal happens in the same synchronous step as `registry.remove`, with the same identity guard, and a test asserts it.
- [Interleaving while sends are awaited, for example a player leaving while the host's cancel fan-out is in progress] → All mutations finish before the first `await`, and fan-outs iterate copies. A session already cleared by `game_closed` is in the "no game" state, so its later `leave_game` is the harmless no-op.
- [Message volume: each join or leave sends `games_list` to every subscriber] → Acceptable at this scale. It reuses the full-snapshot model already used by the lobby.
- [A refreshed player cannot get back into the game] → Accepted for this change, which leaves reconnection out of scope. The player gets a clear notice.

## Migration Plan

No data migration, because all state is in memory. Deploy the backend and frontend together, since the new client relies on the new messages. A restart clears every game, as it does today. To roll back, redeploy the previous pair.
