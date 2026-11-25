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

Messages are JSON objects sent as text frames. A game lives only while its
creator's connection is open: cancelling or disconnecting (refresh, tab close,
network loss) removes it and frees its name. A connection can own one game at a
time. `cancel_game` leaves the connection open, so the same connection can create
another game.

A connection that sends `subscribe_lobby` receives a `games_list` right away, and
a new one whenever a game is created, cancelled or removed by a disconnect. Each
`games_list` is the full list, not a change to the previous one. The subscription
lasts until the connection closes, including while the connection owns a game.
Subscribing again only sends a fresh list. When a creator is subscribed,
`game_created` or `game_cancelled` arrives before the updated list.

### Client to server

| `type` | Fields |
|---|---|
| `subscribe_lobby` | none |
| `create_game` | `username`, `color`, `gameName`, `maxPlayers` (optional, default 2), `boardWidth`, `boardHeight` |
| `cancel_game` | none |

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
| `games_list` | `games`: list of games, newest first, each with the same fields as `game` in `game_created` |
| `error` | `code`, plus `field` for input errors |

### Error codes

The socket stays open after every error. When several fields are invalid, only
the first one is reported, in the order of the table. `name_taken` is checked
after all fields are valid.

| `code` | `field` | Meaning |
|---|---|---|
| `invalid_username` | `username` | Username fails the name rules |
| `invalid_color` | `color` | Color is not one of the six allowed values |
| `invalid_game_name` | `gameName` | Game name fails the name rules |
| `invalid_max_players` | `maxPlayers` | Max players is outside 2-4 |
| `invalid_board` | `board` | Board size is out of range or height > width |
| `name_taken` | `gameName` | Another game already uses this name |
| `already_in_game` | none | This connection already has a game |
| `invalid_message` | none | Binary frame, malformed JSON or unknown `type` |
