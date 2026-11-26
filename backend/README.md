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

A game lives only while its host's connection is open: cancelling or
disconnecting (refresh, tab close, network loss) removes it, frees its name and
sends `game_closed` to every joined player. A joined player leaves with
`leave_game` or by disconnecting, which frees their name and color in that game.
`cancel_game`, `leave_game` and `game_closed` all leave the connection open, so
the same connection can then create or join another game.

Whenever a player joins or leaves, every other connection in that game, host
included, receives `game_updated`. The one that joined gets `game_joined`
instead, and the one that left with `leave_game` gets `game_left`.

A connection that sends `subscribe_lobby` receives a `games_list` right away, and
a new one whenever a game is created, cancelled or removed by a disconnect, and
whenever a player joins or leaves one. Each `games_list` is the full list, not a
change to the previous one. The subscription lasts until the connection closes,
including while the connection is in a game. Subscribing again only sends a
fresh list. When the connection that acted is subscribed, its confirmation
(`game_created`, `game_cancelled`, `game_joined` or `game_left`) arrives before
the updated list.

### Client to server

| `type` | Fields |
|---|---|
| `subscribe_lobby` | none |
| `create_game` | `username`, `color`, `gameName`, `maxPlayers` (optional, default 2), `boardWidth`, `boardHeight` |
| `cancel_game` | none. Only a host's game is cancelled. |
| `join_game` | `gameName` (matched ignoring case and surrounding whitespace), `username`, `color` |
| `leave_game` | none. Only a joined player leaves; a host uses `cancel_game`. |

Field rules:

- `username` and `gameName`: trimmed, then 3-20 printable characters. Game names
  are unique ignoring case.
- `color`: `red`, `blue`, `yellow`, `green`, `orange` or `purple`.
- `maxPlayers`: integer from 2 to 4.
- `boardWidth` and `boardHeight`: integers from 8 to 30, width >= height.

### Server to client

| `type` | Fields |
|---|---|
| `game_created` | `game`: `{name, maxPlayers, boardWidth, boardHeight, players: [{name, color}]}` |
| `game_cancelled` | none. Also sent when there was no game to cancel. |
| `game_joined` | `game`: same fields as in `game_created`. `players` is in join order, host first. |
| `game_left` | none. Also sent when the connection had not joined a game. |
| `game_updated` | `game`: same fields as in `game_created`, after a player joined or left |
| `game_closed` | none. The host cancelled or disconnected; this connection is no longer in a game. |
| `games_list` | `games`: list of games, each with the same fields as `game` in `game_created`. Games with room come first, then full ones (players = `maxPlayers`); each group is newest first. |
| `error` | `code`, plus `field` for input errors |

### Error codes

The socket stays open after every error, and only one error is reported per
request. `already_in_game` is always checked first.

- `create_game`: `invalid_username`, `invalid_color`, `invalid_game_name`,
  `invalid_max_players`, `invalid_board`, then `name_taken`.
- `join_game`: `invalid_username`, `invalid_color`, `game_not_found`,
  `game_full`, `username_taken`, then `color_taken`. A missing or non-text
  `gameName` is reported as `game_not_found`.

| `code` | `field` | Meaning |
|---|---|---|
| `invalid_username` | `username` | Username fails the name rules |
| `invalid_color` | `color` | Color is not one of the six allowed values |
| `invalid_game_name` | `gameName` | Game name fails the name rules |
| `invalid_max_players` | `maxPlayers` | Max players is outside 2-4 |
| `invalid_board` | `board` | Board size is out of range or height > width |
| `name_taken` | `gameName` | Another game already uses this name |
| `game_not_found` | `gameName` | No game has this name |
| `game_full` | `gameName` | The game already has `maxPlayers` players |
| `username_taken` | `username` | A player in that game uses this name, ignoring case |
| `color_taken` | `color` | A player in that game uses this color |
| `already_in_game` | none | This connection is already in a game, as host or player |
| `invalid_message` | none | Binary frame, malformed JSON or unknown `type` |
