# Proposal

## Why

Players can create a game, but nobody else can see it, so no one can find a game to play. The next Jira story turns the home screen into a lobby: a list of every game other users have created, kept up to date live over the WebSocket, with "Create game" at the top of the list. It is the step before joining a game.

## What Changes

- The home screen becomes a lobby. A "Create game" button sits at the top, above an "Open games" list. Each row shows the game name, the host's name and color, the player count as "1 / maxPlayers", and the board size. Rows are display-only. All UI text is in English.
- The list is live. On connecting, the client sends `subscribe_lobby`. The server replies with a full `games_list` snapshot and sends a new snapshot whenever a game is created, cancelled or removed by a disconnect. Games are listed newest first.
- **BREAKING (client lifecycle)**: one WebSocket per tab, opened when the app loads instead of when the create-game form is submitted. `create_game` and `cancel_game` use this connection. Cancelling a game no longer closes it, and the user goes back to the lobby.
- The lobby has a loading state ("Loading games..."), an empty state ("No games yet. Create one!") and a disconnected state ("Can't reach the server." with a manual **Retry**). "Create game" is disabled until the lobby is connected and has its first snapshot.
- If the connection drops on the form or waiting screen, the user goes back to the lobby in its disconnected state. On the waiting screen the existing "Connection lost, the game was removed" notice is also shown.

## Capabilities

### New Capabilities
- `game-lobby`: the live list of open games. This covers the subscription, snapshot broadcasts, ordering, how the lobby screen is laid out, and its loading, empty and disconnected states.

### Modified Capabilities
- `game-creation`: creating a game now uses the tab's shared connection instead of a connection opened on submit, cancelling keeps that connection open and returns to the lobby, and losing the connection while waiting goes to the disconnected lobby.

## Impact

- **Backend**:
  - New message types: `subscribe_lobby` (client to server) and `games_list` (server to client).
  - A new lobby broadcaster tracks subscribed connections. It sends to each one separately, so one failed send does not affect the others.
  - `CreatorSession` becomes a general per-connection session that can both subscribe and own a game.
  - `backend/README.md` protocol tables are updated.
- **Frontend**:
  - `App.tsx` owns one socket for the whole session and adds lobby state.
  - `gameSocket.ts` gains `subscribeLobby()` and a `games_list` event. `cancel()` no longer closes the socket.
  - `HomeScreen` renders the lobby list and its states.
  - `types.ts` gains the new message types.
- **Out of scope**:
  - Joining a game, or clicking a row.
  - Full or started game states.
  - Automatic reconnection.
  - Filtering out games from the same person's other tabs.
  - Running on multiple workers.
