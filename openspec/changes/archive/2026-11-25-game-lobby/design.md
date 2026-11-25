# Design

## Context

- `WS /api/ws` (`backend/app/games/ws.py`) is request/reply only. `CreatorSession` answers its own socket and nothing is ever broadcast. Its `finally` block removes the connection's game on disconnect.
- `GameRegistry` is an in-memory dict, injected with the `get_registry` dependency, with `add`, `remove`, `list` and `exists_by_name`. `list()` is not used yet. Dicts keep insertion order, so `list()` returns games oldest first.
- On the frontend, `App.tsx` opens the socket **only on form submit**, to keep StrictMode's double effect away from `create_game`. `gameSocket.cancel()` sends `cancel_game` and then closes the socket. A `close` event carries `{ intentional }`, so `App` can tell a cancel from a lost connection.
- The server runs a single worker (see the archived `create-game` design, D3).
- See proposal.md for motivation, and specs/game-lobby and specs/game-creation for behavior.

## Goals / Non-Goals

**Goals:**
- One connection per tab carries both the lobby and game ownership. The session lifetime rules in `ws.py` stay in one place.
- Broadcasting is a separate, injectable unit, so it can be tested with fake sockets and without the registry.
- Every client update replaces the whole list. The client never applies diffs.

**Non-Goals:**
- Fan-out across processes, such as pub/sub. Single worker only.
- Backpressure handling or per-connection send queues.
- Changing `GameRegistry`'s responsibilities. It stays a plain store.

## Decisions

### D1. Protocol additions

```
client -> server              server -> client
{type:"subscribe_lobby"}  --> {type:"games_list", games:[GameSummary, ...]}   newest first
                              (sent again to every subscriber after each add/remove)
```

- `GameSummary` is the shape `game_created` already uses (`game_summary()` in `ws.py`), so the client reuses its `GameSummary` type.
- `subscribe_lobby` is explicit rather than implied by connecting. The protocol describes itself, and a later change could subscribe only some connections, such as players in a started game.
- **Full snapshot, not deltas.** Games never change after creation in this slice (no joining yet), lists are small, and snapshots are idempotent and safe against ordering mistakes. *Alternative:* `game_added` / `game_removed` events. Rejected for now, because they need ordering guarantees and client-side merging. Revisit if lists grow large or joining makes updates frequent.
- There is no `unsubscribe_lobby` message. A subscription ends when the connection closes (spec: "Subscription lasts for the connection").

### D2. Backend: `LobbyHub` and a general session

```
backend/app/games/
  lobby.py      # NEW: LobbyHub (subscribers set, subscribe, unsubscribe, broadcast)
                #      lobby_snapshot(registry) -> {"type":"games_list","games":[...newest first]}
  ws.py         # CreatorSession -> ClientSession: handles subscribe_lobby, create_game, cancel_game
  registry.py   # unchanged
```

- `LobbyHub` holds a `set` of subscribed sockets. A module-level instance is exposed through a `get_lobby_hub` dependency, like `get_registry`, so tests get a fresh hub.
- `broadcast(message)` sends to each subscriber in turn and wraps each send in `try/except`. A send that fails removes that subscriber and the loop moves on (spec: "One failed subscriber does not block others").
- `lobby_snapshot(registry)` builds the message as `reversed(registry.list())` mapped through `game_summary`. Newest-first ordering lives in this one function, so the registry knows nothing about presentation.
- `ClientSession` triggers a broadcast after every registry change:
  - **create**: `registry.add` → send `game_created` to the creator → `broadcast(snapshot)`. The creator gets its confirmation first. As a subscriber, it then also gets the new list.
  - **cancel**: remove → send `game_cancelled` → broadcast.
  - **disconnect** (`finally`): `hub.unsubscribe(websocket)` *first*, so the hub never tries to send to the closing socket, then remove the game. Broadcast only if a game was actually removed.
- Failed validation, `name_taken` and `already_in_game` change nothing, so they trigger no broadcast.
- `subscribe_lobby` adds the socket to the set (a set, so a second subscribe is harmless) and sends a snapshot to that socket only.
- `end_game()` returns whether it removed a game, so the `finally` block and cancel both know whether to broadcast.

*Alternative:* the registry emits change events and the hub listens. Rejected. It hides when broadcasts happen, and sending is async while the registry is sync.

### D3. Frontend: one socket for the session

```
App state
  lobby: { status: 'connecting' | 'ready' | 'disconnected', games: GameSummary[] }
  view:  home{notice?} | form{serverError?} | waiting{game}
  socketRef: the tab's single GameSocket
```

- **Opening:** a mount effect calls `connect()`, which creates the socket, registers its handlers and calls `subscribeLobby()`. The effect cleanup closes it intentionally. StrictMode's open → close → open sequence is harmless because subscribing has no server-side side effect. This replaces the old "open on submit" rule, which was there to protect `create_game`, and `create_game` is still sent only from the submit handler.
- **gameSocket.ts:**
  - gains `subscribeLobby()` and a `games_list` event.
  - `cancel()` now only sends `cancel_game`. `close()` remains for unmount.
  - The `pending` queue already covers sending `subscribe_lobby` before `open`.
  - A failed connection attempt fires `close` in browsers, so "cannot connect" and "connection lost" take the same path.
- **Handlers in App:**
  - `games_list` → `lobby = { status: 'ready', games }`. This also runs while the waiting screen is shown, so the list is already current after a cancel.
  - `close` with `intentional: false` → `lobby.status = 'disconnected'` and `socketRef = null`. If the view was `waiting`, clear the `waitingGameFlag` and go to `home` with the "Connection lost, the game was removed" notice. From `form`, go to `home` with no notice. On `home`, stay there.
  - `game_created` and `error` work as today.
- **Retry:** `onRetry` sets `status: 'connecting'` and calls `connect()` again. There is no timer and no automatic retry.
- **Create game:** the button is enabled only when `lobby.status === 'ready'`. Since the socket exists whenever that's true, `createGame` uses `socketRef.current` and never opens a new connection.
- **Cancel:** send `cancel_game`, clear the flag, go to `home`. The socket stays open, and the lobby already holds the latest list.
- **HomeScreen** receives `lobby`, `notice`, `onCreateGame` and `onRetry`. It renders, in order: the title, the notice, the "Create game" button, the "Open games" heading, and then exactly one of "Loading games...", "No games yet. Create one!", "Can't reach the server." with Retry, or the list. Rows are plain list items with no handlers. The host color uses the existing `colorLabel`.
- `waitingGameFlag` is unchanged.

*Alternative:* a separate lobby socket. Rejected during exploration. It would mean two failure paths and two lifecycles per tab.

### D4. Documentation
`backend/README.md` adds `subscribe_lobby` and `games_list` to the protocol tables, and notes that `cancel_game` leaves the connection open.

## Risks / Trade-offs

- [Two broadcasts interleave at `await` points, and an older snapshot reaches a socket after a newer one] → Each snapshot is built synchronously right after its registry change, and websocket frames are written in call order, so the risk is low. If stale lists ever show up, add a per-connection outgoing queue or a `version` field. Accepted for now.
- [A slow subscriber delays the broadcast for the rest, because sends are sequential] → Fine at this scale. Uvicorn's ping closes dead peers. `asyncio.gather` per broadcast is the next step if needed.
- [Every connection, including creators on the waiting screen, receives every update] → A few small frames. This trades a little traffic for a simpler state model (no re-subscribe after cancel).
- [Same-person games from another tab show up in the list] → Accepted. There is no persistent identity to filter by.
- [Changing `cancel()` breaks existing tests that expect the socket to close] → Updating those tests is part of the TDD tasks. The behavior change is intended (specs/game-creation MODIFIED).

## Migration Plan

There is no persisted data. The frontend and backend deploy together, because an old client would never subscribe and so would see no list. Roll back by reverting the change.
