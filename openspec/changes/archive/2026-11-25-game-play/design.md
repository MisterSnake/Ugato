# Design

## Context

See proposal.md for the motivation and the specs for the behavior. The relevant current state:

- All state is in process memory: `GameRegistry` (games by name), `GameRooms` (the connections of each game: a `host` plus `joined` players) and `LobbyHub`. The server runs as a single worker, and the asyncio event loop is the only source of concurrency: code with no `await` in it runs atomically.
- `ClientSession` (`backend/app/games/ws.py`) holds one connection's role, `HostRole` or `PlayerRole`. Today the host's role decides the game's lifetime: closing or cancelling it removes the game.
- `game_summary` serializes a `Game`. `lobby_snapshot` sorts full games last.
- Every update sends full state (`games_list`, `game_updated`), never diffs. Sending to one dead socket must not block the others (`send_to_each`).
- The frontend's `App.tsx` is a screen state machine. Components talk to the server only through `gameSocket.ts`, and tests use `FakeWebSocket`. `validation.ts` mirrors `validation.py`.
- Strict TDD is required, so every rule must be reachable from a fast, deterministic test.

## Goals / Non-Goals

**Goals:**
- Keep the game rules (U detection, scoring, turn order, end of game) in pure functions that need no sockets, so they can be built test-first in isolation.
- Make the server the only authority: the client never decides whether a move is valid or whether a U was formed.
- Keep "one message in, full state out" so a client can always redraw from the last message it got.

**Non-Goals:**
- Turn timeouts, reconnecting to a game, spectators (see proposal: Out of scope).
- Highlighting possible Us on the client before a move. The client only draws what the server sends.
- Animations beyond the static cell styles the spec lists.

## Decisions

### 1. A `Match` object holds the play state, separate from `Game`

`Game` keeps what the lobby needs (name, settings, players, status). A new `Match`, created when the game starts and attached to it, holds the board, the turn order, the current turn index, the phase, the pending candidates, the scores and the set of players who left. The rules are methods or functions on `Match` that take a move and either raise a validation error or return the new state. They never touch a socket.

- *Why*: tests for the rules build a `Match` directly from an ASCII board. They don't need a registry, rooms or a `TestClient`.
- *Alternative*: adding the fields straight to `Game`. Rejected: waiting games would carry a board they don't use, and every rule test would need lobby fields.

### 2. Board as a dense grid of cells; players referred to by name

The board is `height` rows of `width` cells. Each cell is `None` or `(owner_name, disabled)`. Names are unique within a game, which already makes them the player key in the protocol, so the board uses them too.

On the wire, `board` is a list of rows; each cell is `null` or `{"owner": "<name>", "disabled": bool}`. A full 30 x 30 board is about 900 small entries, sent once per move, which is fine at the pace of a turn-based game.

- *Alternative*: a sparse map of taken cells. Smaller early in the game, but redrawing and testing are simpler with a dense grid, and the size is bounded and small.

### 3. U detection: try 20 placements through the marked cell

The U pentomino in its 4 orientations is written as 4 lists of 5 offsets, given in a fixed order. For the marked cell, each orientation is tried with each of its 5 cells placed on the marked cell. A placement is a U when all 5 cells are on the board, owned by the player and not disabled. Placements that give the same set of cells are de-duplicated. The candidate order follows the order of the orientations and offsets, which keeps `choose_u` indexes stable and tests deterministic.

- *Why it's enough*: as long as every U is scored the turn it forms, the only new U a move can create goes through the marked cell. Moves that complete no U and choices that disable a U keep that true. A test checks the property on random boards.
- The notch is never read (decision B1 in the exploration).

### 4. A turn has two phases on the server

`phase` is `mark` or `choose`. `mark_cell` is only accepted in `mark`. It finds the candidates: with 0 the turn ends; with 1 the U is scored and the turn ends; with 2 or more, `phase` becomes `choose` and the candidates are stored. `choose_u` is only accepted in `choose`. Ending a turn means checking for the end of the game, then moving to the next player who has not left.

The error order in the spec matches the order of these checks, which is how `create_game` and `join_game` already report their first error.

### 5. Per-recipient `game_state`

`game_state` is built once per recipient: everyone gets the same board, order, scores and phase, and only the current player gets `candidates`. One function, `match_state(match, viewer)`, builds both cases, so tests can check that other players never see the candidates.

### 6. Leaving a started game: the room keeps the seat, the match marks the player as left

Once a game starts, its room stops treating the host specially. `ClientSession` gets a third role, a playing role, for every player including the host, set when `game_started` is sent. Leaving or disconnecting with that role:

1. marks the player as left in the `Match` (their cells and score stay),
2. removes the connection from the room,
3. if one player is left → `game_over` (`last_player`); if it was their turn → move on (dropping a pending choice); otherwise just a new `game_state`,
4. broadcasts the lobby.

`cancel_game` with the playing role changes nothing and still answers `game_cancelled`, as the spec says. The game screen always sends `leave_game`, at once and without a confirmation step.

- *Why a new role instead of reusing `HostRole`/`PlayerRole`*: those roles carry the waiting-room lifetime rules ("host leaves → close for everyone"). Switching to one playing role makes the change of rules explicit in a single place.
- No `await` between deciding the next turn and updating the state, so a leave and a move can't interleave halfway.

### 7. Start, end and removal

- **Start**: inside `_join`, right after adding the player and still with no `await`, if the game is full the server creates the `Match`, using a random source passed in through a dependency (like `get_registry`). Tests pass a seeded or fixed source to control the turn order. The messages then go out in this order: `game_joined` to the joiner, `game_updated` to the others, `game_started` to all, and the lobby broadcast.
- **End**: `game_over` carries `winners`, `scores`, `reason` and the final `board`. The game is removed from the registry and its room is closed in the same synchronous step, so its name is freed, and every remaining session forgets the game. The lobby is broadcast after that.

### 8. Lobby status and order

`game_summary` gains `status` (`waiting`/`playing`). For a playing game, `players` lists only those who have not left, in join order, so the lobby row shows the first remaining player as host and counts only those still playing. `lobby_snapshot` sorts by "is playing" instead of "is full". With the auto-start these are the same set; sorting on status says what we mean.

### 9. Frontend views and modules

- `App.tsx` gains two views: `playing` (holds the latest state and the user's own name) and `finished` (holds the `game_over` payload). `game_started` and `game_state` replace the stored state. `game_over` switches to `finished`. "Close" goes to `home` locally. The `waitingGameFlag` is kept while playing so a refresh shows "Connection lost, you left the game".
- `GameScreen` renders the turn bar, the board, the players and the choice controls. `WinnerScreen` is a separate screen.
- Pure, separately tested modules:
  - `turnStatus(state, me)` → the turn bar text and whether it's the user's turn.
  - `cellLook(cell, leftPlayers, lastMove)` → which style a cell gets.
  - `viewport.ts`: fit scale, zoom in/out with limits, pan limits, the zoom anchor for a pinch, and the quarter-turn mapping between screen and board coordinates.
  - `tapDetector.ts`: from a sequence of pointer events, decides between tap and pan (one pointer, moved less than 8 CSS px).
- **Mark input**: the `pointerType` of the `pointerup` that counts as a tap decides it: `mouse` sends `mark_cell` at once; `touch` or `pen` selects the cell. React Testing Library tests fire pointer events with each `pointerType`.
- **Zoom**: a CSS `transform` on the board's inner element, driven by pointer events. The board area has `touch-action: none` so the browser doesn't zoom the page. The turn bar sits outside the transformed element, so it never zooms. No zoom or gesture library is added.
- **Rotation**: decided by the board area's own aspect ratio (a `ResizeObserver`), not by the device orientation, so a narrow desktop window gets the same treatment. Coordinates go through `viewport.ts`, so a tap always maps to the right `(row, col)`.
- **Cell styles**: CSS classes per look. The disabled look uses a `repeating-linear-gradient` hatch over the player color. Cells of a player who left use reduced opacity. Every colored cell has a 1px dark border (needed for yellow).

### 10. Protocol documentation

`backend/README.md` gets the new messages, the `status` field, the new error codes with their order, and the changed lifetime rule. `types.ts` mirrors it.

## Risks / Trade-offs

- [A player who stops playing blocks the game forever] → Accepted for now (proposal: Out of scope). The others can leave. A turn timer can be added later on top of the two-phase turn.
- [Custom pinch and pan code is hard to test in jsdom] → All the math lives in the pure `viewport.ts` and `tapDetector.ts`, which are fully unit-tested. Only the wiring to real pointer events is checked by hand on a phone and a desktop browser, noted in the tasks.
- [The U invariant (decision 3) silently breaks if a future rule disables cells another way] → A property test on random boards checks that no complete U is ever left after a turn.
- [A full board resent on every move] → Bounded at 900 cells and a few KB. Diffs can come later if it matters.
- [Turn order depends on randomness] → The random source is a dependency, so tests fix it.
- [The game name stays taken while a game is played] → Intended. The lobby shows the game as "In progress", so `name_taken` makes sense to the user.
- [Requirement text length] → "Cancel a game" is over the 500-character guideline because the existing text already was. It stays as is: under MODIFIED, existing text is not trimmed.

## Open Questions

- The exact zoom limits (minimum = fit, maximum about 48px per cell?) and the colors and opacity of each cell look will be tuned on real devices during implementation.
