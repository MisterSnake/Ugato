# Proposal

## Why

Players can create, find and join games, but a full game just sits in its waiting room: nothing can be played. The next story turns a full game into the actual turn-based board game: players take turns marking cells, score a point for each 5-cell U they form, and the highest score wins when the board is full.

## What Changes

- **Start**: a game starts automatically the moment its last seat is taken. The server shuffles the turn order and sends `game_started` with an empty board to every player.
- **Turns**: on their turn a player marks one empty cell with `mark_cell {row, col}`. The cell takes their color and the turn passes to the next player in the shuffled order. The server rejects moves out of turn, out of bounds, or on a cell that is not empty.
- **Scoring**: a U is any 5 enabled cells of the same player in the U pentomino shape, opening up, down, left or right. What is in the notch does not matter. A U can only form through the cell just marked, so a player scores at most 1 point per turn. The U's 5 cells become **disabled**: they keep the player's color with a distinct look, cannot be marked and cannot be part of another U.
- **Choosing a U**: when one mark completes a single U it is scored automatically. When it completes several, the turn enters a choice phase: the player cycles through the candidates and confirms one with `choose_u {index}`. The mark cannot be undone.
- **Leaving during play**: a player who leaves or disconnects is removed from the turn order, and the game goes on. Their cells stay on the board, shown faded, and cannot be marked. Their score stays visible, but they cannot win. If they had the turn, it passes. If they were choosing a U, they score nothing. Once the game has started the host has no special role: their leaving does not end the game.
- **End**: the game ends when no empty cell is left, or when only one player is still in it. That player wins automatically. Otherwise the remaining player or players with the highest score win, so a tie is a draw with several winners. The server sends `game_over`, removes the game, and every player sees a winner screen. Closing that screen returns to the lobby.
- **Game screen**: the board has a single uniform color for empty cells. A fixed bar always shows whose turn it is, and the player whose turn it is gets an unmistakable "Your turn!" state. The screen also shows the turn order with scores and a way to leave the game.
- **Phones**: the board fits the screen and can be zoomed with a pinch or with zoom buttons. It is drawn rotated when the phone is held upright. On touch screens marking takes two steps (select, then "Mark"); a mouse click marks directly.
- **Lobby**: games being played are listed as "In progress", with no Join button, after the games with room. Since a game starts as soon as it fills up, the "Full" label goes away.
- **BREAKING (game lifecycle)**: "the game ends when its host cancels or disconnects" now applies only before the game starts.
- New messages: `mark_cell`, `choose_u` (client to server); `game_started`, `game_state`, `game_over` (server to client).
- New error codes: `game_in_progress`, `not_your_turn`, `cell_out_of_bounds`, `cell_taken`, `game_not_started`, `choice_pending`, `no_choice_pending`, `invalid_choice`.

**Out of scope**: turn timeouts. A player who keeps their tab open but stops playing blocks the game, and the others can only leave it. Reconnecting to a game after a refresh is still not supported.

## Capabilities

### New Capabilities
- `game-play`: playing a started game. This covers the start and the turn order, marking cells, detecting and choosing Us, scoring and disabled cells, leaving during play, the end of the game and its winners, and the game and winner screens, including how they work on touch screens.

### Modified Capabilities
- `game-creation`: cancelling and the host's disconnect only close a game that has not started yet. A game that started is no longer tied to its host's connection.
- `game-joining`: joining a started game is rejected with `game_in_progress`. Leaving, disconnecting and the host closing the game follow the waiting-room rules only before the game starts. The join form and the waiting room react to the game starting.
- `game-lobby`: game summaries gain a `status`, games in progress are listed after games with room and marked "In progress", and the list is also updated when a game starts or ends and when a player leaves a game in progress.

## Impact

- **Backend**:
  - `Game` gains a status (waiting or playing), a board, the turn order, the current turn phase and the scores.
  - New pure module for the board rules: finding every U through a cell, and the end-of-game check.
  - `ClientSession` gains the new messages. Leaving and disconnecting behave differently once a game has started, for the host as well as for players.
  - `game_summary` and `lobby_snapshot` gain the status and its sort order.
  - `validation.py` gains move validation. The `backend/README.md` protocol tables are updated.
- **Frontend**:
  - `App.tsx` gains `playing` and `finished` views.
  - New `GameScreen` (board, turn bar, players and scores, U choice) and `WinnerScreen`.
  - Pure modules for the zoom and pan math and for telling a tap from a pan.
  - `gameSocket.ts` and `types.ts` gain the new messages and error codes.
  - The lobby row and the join form handle the "In progress" status.
- **Dependencies**: none planned. Zoom and pan are implemented with pointer events, not a library.
