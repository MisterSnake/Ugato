# Proposal

## Why

Users can create games and see them in the live lobby, but nobody can join one, so a game never gets more than its host. The next Jira story lets a user pick a game from the lobby and join it with a name and a color, each unique within that game and kept only in memory.

## What Changes

- Lobby rows gain a **Join** button. Full games (players = maxPlayers) are shown at the bottom of the list, marked "Full", without a Join button. Joinable games stay newest first, and so do full games.
- Clicking Join opens a join form for that game with a name field and the six colors. Colors already used in that game are disabled. The form reacts live to lobby updates: a color taken meanwhile is disabled and unselected, and if the game fills up or disappears the user goes back to the lobby with a notice. A **Back** button returns to the lobby.
- New `join_game` message (`gameName`, `username`, `color`). The server checks the name and color with the create-game rules, then that the game exists, that it has room, that no player in it uses the same name (ignoring case and surrounding whitespace), and that no player in it uses the same color. Check and insertion happen atomically.
- After joining, the player sees a shared waiting room with the live player list and a **Leave game** button. Leaving (`leave_game`) or disconnecting removes the player and frees their name and color.
- The host's waiting screen now shows the live player list. Every player in a game receives `game_updated` when someone joins or leaves.
- **BREAKING (game lifecycle)**: when the host cancels or disconnects, every joined player receives `game_closed` and returns to the lobby with the notice "The host closed the game".
- Every join and leave also sends a fresh `games_list` to lobby subscribers.
- A connection can be in at most one game, either as host or as player. `create_game` and `join_game` are rejected with `already_in_game` while it is in one.
- New error codes: `game_not_found`, `game_full`, `username_taken`, `color_taken`.

## Capabilities

### New Capabilities
- `game-joining`: joining an existing game as a player. This covers the `join_game` request and its validation and uniqueness rules, leaving, the player's waiting room, the live roster updates to everyone in the game, closing the game for joined players when the host leaves, and the join form with its live behavior.

### Modified Capabilities
- `game-lobby`: rows are no longer display-only. They get a Join button or a "Full" mark, full games go to the bottom, and the list is also updated when a player joins or leaves.
- `game-creation`: "one game per connection" now covers joined games, cancelling or disconnecting closes the game for joined players, and the host's waiting screen shows the live player list and count.

## Impact

- **Backend**:
  - New messages:
    - client to server: `join_game`, `leave_game`
    - server to client: `game_joined`, `game_left`, `game_updated`, `game_closed`
  - New error codes.
  - `ClientSession` gains a player role next to the host role.
  - A new per-game room tracks the connections in each game so the server can send them roster updates.
  - `lobby_snapshot` sorts full games last.
  - `validation.py` gains join validation.
  - The `backend/README.md` protocol tables are updated.
- **Frontend**:
  - `App.tsx` gains `join` and `joined` views.
  - `HomeScreen` gets Join buttons and the "Full" state.
  - There is a new `JoinGameForm`.
  - `WaitingScreen` shows the player list and supports the player role (Leave instead of Cancel).
  - `gameSocket.ts` and `types.ts` gain the new messages and errors.
  - `validation.ts` mirrors the server's join rules.
  - `waitingGameFlag` records the role so a refresh shows the right notice.
- **Out of scope**:
  - Starting the game when it is full.
  - Kicking players.
  - Passing host rights to another player.
  - Automatic reconnection or rejoining after a refresh.
  - Running on multiple workers.
