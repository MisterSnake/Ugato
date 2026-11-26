# Ugato backend

FastAPI app, Python 3.14, managed with `uv`.

## Run

```bash
./.venv/Scripts/python.exe -m uvicorn app.main:app --reload
```

The server listens on port 8000.

**Run a single worker. Do not use `--workers`.** Games are kept in process
memory, so with several workers each one would have its own list of games and
game names would no longer be unique. A restart removes every game.

## Test

```bash
./.venv/Scripts/python.exe -m pytest -q
```

## HTTP

`GET /api/health` returns `{"status": "ok"}`.

## WebSocket protocol: `/api/ws`

Messages are JSON objects sent as text frames. A connection can be in at most
one game at a time, either as its host (the creator) or as a joined player.

A game is `waiting` until its last seat is taken, and then `playing`.

**Before the start**, a game lives only while its host's connection is open:
cancelling or disconnecting (refresh, tab close, network loss) removes it, frees
its name and sends `game_closed` to every joined player. A joined player leaves
with `leave_game` or by disconnecting, which frees their name and color in that
game. `cancel_game`, `leave_game` and `game_closed` all leave the connection
open, so the same connection can then create or join another game. Whenever a
player joins or leaves, every other connection in that game, host included,
receives `game_updated`. The one that joined gets `game_joined` instead, and the
one that left with `leave_game` gets `game_left`.

**After the start, the host has no special role.** The host plays like everyone
else, so their leaving or disconnecting does not close the game, and
`cancel_game` changes nothing (it is still answered with `game_cancelled`). See
[Playing a game](#playing-a-game).

A connection that sends `subscribe_lobby` receives a `games_list` right away, and
a new one whenever a game is created, cancelled, removed by a disconnect before
its start, started or ended, and whenever a player joins or leaves one,
including during play. Each `games_list` is the full list, not a
change to the previous one. The subscription lasts until the connection closes,
including while the connection is in a game. Subscribing again only sends a
fresh list. When the connection that acted is subscribed, its confirmation
(`game_created`, `game_cancelled`, `game_joined` or `game_left`) arrives before
the updated list.

### Playing a game

- **Start**: when the last seat is taken, the server shuffles the players into a
  turn order and sends `game_started` to all of them. Messages go out in this
  order: `game_joined` to the joiner, `game_updated` to the others,
  `game_started` to everyone, and then the new `games_list`.
- **Turns**: the current player marks an empty cell with `mark_cell`. Every
  accepted `mark_cell` or `choose_u` sends `game_state` to every player still in
  the game.
- **Scoring**: a U is 5 enabled cells of one player in the U pentomino shape,
  opening to any of four sides; the notch is ignored. A mark that completes one U
  scores it and disables its cells. A mark that completes several keeps the turn,
  in the `choose` phase, until the player picks one with `choose_u`.
- **Leaving**: `leave_game` or a disconnect removes the player from the turn
  order. Their cells and score stay, but they cannot win. If they had the turn it
  passes, and a pending choice scores nothing. The others get `game_state`, or
  just `game_over` if only one of them is left. During a vote, see
  [Voting to end the game](#voting-to-end-the-game).
- **End**: when no cell is empty after a turn (`board_full`), the remaining
  players with the highest score win; the `game_state` of that last move arrives
  first. When one player is left (`last_player`), they win. When a vote to end
  passes (`vote`), the remaining players with the highest score win. The server
  sends `game_over`, removes the game, and frees its name and its connections.

### Voting to end the game

- **Proposing**: on their turn, in the `mark` phase, a player with attempts left
  opens a vote with `propose_end`, and counts as voting to end. Everyone gets
  `game_state` with the `vote`. Until it closes, `mark_cell` and `choose_u` are
  rejected with `vote_pending`.
- **Voting**: every other player still in the game votes once with `vote_end`.
  A vote cannot be changed. While the vote stays open, each accepted one sends
  `game_state` to everyone. Nobody learns what the others voted.
- **Result**: the vote passes when the votes to end are a strict majority of the
  players still in the game (`floor(n / 2) + 1`), so a tie keeps the game going.
  It closes as soon as its result can no longer change.
- **Time limit**: a vote lasts at most 30 seconds. When time runs out, the votes
  still missing count as "continue".
- **Passed**: everyone gets `game_over` with reason `vote`, with no `game_state`
  before it.
- **Failed**: everyone gets `vote_failed` and then `game_state`. It is still the
  proposer's turn, in the `mark` phase. When a vote fails before everyone has
  voted, `vote_failed` counts only the votes cast.
- **Attempts**: each player starts with 2. When a vote fails, its proposer loses
  1 and every other player still in the game gets 1 back, up to 2. A vote that
  passes or is cancelled changes none.
- **Leaving during a vote**: a leaving voter's vote is dropped and the majority
  is computed over the players still in, which can settle the vote. If the
  proposer leaves, the vote is cancelled (no `vote_failed`) and the turn passes.
  If only one player is left, the game ends with reason `last_player`.

### Client to server

| `type` | Fields |
|---|---|
| `subscribe_lobby` | none |
| `create_game` | `username`, `color`, `gameName`, `maxPlayers` (optional, default 2), `boardWidth`, `boardHeight` |
| `cancel_game` | none. Only a host's game that has not started is cancelled. |
| `join_game` | `gameName` (matched ignoring case and surrounding whitespace), `username`, `color` |
| `leave_game` | none. Before the start only a joined player leaves; a host uses `cancel_game`. After the start any player leaves, host included. |
| `mark_cell` | `row` (0 to `boardHeight` - 1), `col` (0 to `boardWidth` - 1) |
| `choose_u` | `index` in the `candidates` of the last state |
| `propose_end` | none. Opens a vote to end the game. |
| `vote_end` | `end`: boolean, `true` to end the game, `false` to keep playing |

Field rules:

- `username` and `gameName`: trimmed, then 3-20 printable characters. Game names
  are unique ignoring case.
- `color`: `red`, `blue`, `yellow`, `green`, `orange` or `purple`.
- `maxPlayers`: integer from 2 to 4.
- `boardWidth` and `boardHeight`: integers from 8 to 30, width >= height.

### Server to client

| `type` | Fields |
|---|---|
| `game_created` | `game`: `{name, maxPlayers, boardWidth, boardHeight, status, players: [{name, color}]}`. `status` is `waiting` or `playing`. For a game in progress, `players` lists only those still in it, in join order. |
| `game_cancelled` | none. Also sent when there was no game to cancel. |
| `game_joined` | `game`: same fields as in `game_created`. `players` is in join order, host first. |
| `game_left` | none. Also sent when the connection had not joined a game. |
| `game_updated` | `game`: same fields as in `game_created`, after a player joined or left |
| `game_closed` | none. The host cancelled or disconnected before the start; this connection is no longer in a game. |
| `games_list` | `games`: list of games, each with the same fields as `game` in `game_created`. Waiting games come first, then games in progress; each group is newest first. |
| `game_started` | `state`: see [Game state](#game-state) |
| `game_state` | `state`: see [Game state](#game-state). Sent after a move, a proposal or a vote, after a vote failed and after a player left. |
| `vote_failed` | `proposer`, `endVotes`, `continueVotes`. A vote to end failed; a `game_state` follows. |
| `game_over` | `winners` (names; several make a draw), `scores` (`{name: points}`, every player), `reason` (`board_full`, `last_player` or `vote`), `board` (the final one, as in the game state). This connection is no longer in a game. |
| `error` | `code`, plus `field` for input errors |

### Game state

Players are identified by name. Colors are not repeated here: take them from the
`players` of the last `game_joined` or `game_updated` before `game_started`, which
lists everyone.

| Field | Value |
|---|---|
| `board` | `boardHeight` rows of `boardWidth` cells; each is `null` or `{owner, disabled}` |
| `turnOrder` | every player's name, in turn order |
| `currentPlayer` | whose turn it is |
| `phase` | `mark` or `choose` |
| `scores` | `{name: points}`, every player |
| `leftPlayers` | names of those who left, in turn order |
| `lastMove` | `{row, col}` of the last cell marked, or `null` |
| `candidates` | only for the current player in the `choose` phase: a list of Us, each 5 `{row, col}`, in a stable order |
| `endProposalsLeft` | `{name: attempts}`, every player: the proposals to end each one has left |
| `vote` | the open vote, or `null`: see below |

The `vote` object differs per recipient only in `yourVote`:

| Field | Value |
|---|---|
| `proposer` | who proposed ending the game |
| `voted` | how many players have voted, the proposer included |
| `total` | how many players are still in the game |
| `secondsLeft` | whole seconds left, rounded up |
| `yourVote` | `end`, `continue` or `null` if this player has not voted |

### Error codes

The socket stays open after every error, and only one error is reported per
request. `already_in_game` is always checked first.

- `create_game`: `invalid_username`, `invalid_color`, `invalid_game_name`,
  `invalid_max_players`, `invalid_board`, then `name_taken`.
- `join_game`: `invalid_username`, `invalid_color`, `game_not_found`,
  `game_in_progress`, `game_full`, `username_taken`, then `color_taken`. A
  missing or non-text `gameName` is reported as `game_not_found`.
- `mark_cell`: `game_not_started`, `not_your_turn`, `vote_pending`,
  `choice_pending`, `cell_out_of_bounds`, then `cell_taken`.
- `choose_u`: `game_not_started`, `not_your_turn`, `vote_pending`,
  `no_choice_pending`, then `invalid_choice`.
- `propose_end`: `game_not_started`, `not_your_turn`, `vote_pending`,
  `choice_pending`, then `no_proposals_left`.
- `vote_end`: `game_not_started`, `no_vote_pending`, `proposer_cannot_vote`,
  `already_voted`, then `invalid_vote`.

| `code` | `field` | Meaning |
|---|---|---|
| `invalid_username` | `username` | Username fails the name rules |
| `invalid_color` | `color` | Color is not one of the six allowed values |
| `invalid_game_name` | `gameName` | Game name fails the name rules |
| `invalid_max_players` | `maxPlayers` | Max players is outside 2-4 |
| `invalid_board` | `board` | Board size is out of range or height > width |
| `name_taken` | `gameName` | Another game already uses this name |
| `game_not_found` | `gameName` | No game has this name |
| `game_in_progress` | `gameName` | The game has already started |
| `game_full` | `gameName` | The game already has `maxPlayers` players |
| `username_taken` | `username` | A player in that game uses this name, ignoring case |
| `color_taken` | `color` | A player in that game uses this color |
| `game_not_started` | none | This connection is not in a started game |
| `not_your_turn` | none | Another player has the turn |
| `choice_pending` | none | A U must be chosen before anything is marked |
| `cell_out_of_bounds` | none | `row` or `col` is missing, not an integer or outside the board |
| `cell_taken` | none | The cell is not empty: it is owned, even by a player who left |
| `no_choice_pending` | none | There is no U to choose |
| `invalid_choice` | none | `index` is missing, not an integer or out of range |
| `vote_pending` | none | A vote to end the game is open |
| `no_proposals_left` | none | This player has no proposals to end left |
| `no_vote_pending` | none | There is no open vote |
| `proposer_cannot_vote` | none | The proposer already counts as voting to end |
| `already_voted` | none | This player has already voted, and votes cannot change |
| `invalid_vote` | none | `end` is missing or not a boolean |
| `already_in_game` | none | This connection is already in a game, as host or player |
| `invalid_message` | none | Binary frame, malformed JSON or unknown `type` |
