# Tasks

Every feature task is a Red-Green-Refactor cycle:
1. **Red**: write the failing test and run the suite to see it fail.
2. **Green**: write the minimal English-named code that makes it pass.
3. **Refactor**: clean up with the suite still green.

Backend tests run with `./.venv/Scripts/python.exe -m pytest -q` (from `backend/`). Frontend tests run with `npm test` (from `frontend/`).

Rule tests build boards from small ASCII grids (for example `"R.R/RRR"`), using a test helper written in the first task that needs it.

## 1. Backend: pure game rules

- [x] 1.1 U candidates through a cell.
  - Red: `tests/games/test_board.py` checks these cases:
    - Each of the 4 orientations is found with the marked cell in each of its 5 positions.
    - The notch can be empty, the player's own cell, or another player's cell.
    - Another player's cell inside the shape, a disabled cell, or a cell off the board means no U.
    - The two-U board from the spec (`R.R.R/RR?RR`, marking `?`) returns exactly 2 candidates, in the same order on every call.
    - A 2 x 3 block of the player's cells returns 2 candidates, with no duplicates.
  - Green: a new `app/games/board.py` with the 4 orientations as offset lists and `find_u_candidates(board, row, col, player)`.
  - Refactor.
  - Verify: tests green.
- [x] 1.2 Start a match.
  - Red: `tests/games/test_match.py` checks that a new match has an empty `width` x `height` board, a turn order that comes from the injected random source and lists every player once, the first player in the order as current player, phase `mark`, every score at 0 and nobody left.
  - Green: a `Match` in a new `app/games/match.py`, created from the game's players, size and a random source.
  - Refactor.
  - Verify: tests green.
- [x] 1.3 Mark a cell, with errors in the spec's order.
  - Red: a valid mark sets the owner and the last cell marked. These are rejected with the right code and leave the match unchanged:
    - `not_your_turn`.
    - `choice_pending` while in the `choose` phase.
    - `cell_out_of_bounds` for a negative, too large, missing, non-integer or boolean `row` or `col`.
    - `cell_taken` for an owned cell, a disabled cell, or a cell of a player who left.
    - When several rules fail, only the first code in the order is reported.
  - Green: `Match.mark(player, row, col)`, raising the existing `ValidationError`.
  - Refactor.
  - Verify: tests green.
- [x] 1.4 Score after a mark.
  - Red: with 0 candidates, no score changes and the turn passes. With 1, the score goes up by 1, the 5 cells are disabled and the turn passes. With 2 or more, the phase is `choose`, the candidates are stored and the turn stays. A disabled cell is never reused in a later U.
  - Green: scoring in `Match.mark`.
  - Refactor.
  - Verify: tests green.
- [x] 1.5 Choose a U.
  - Red: `choose(player, index)` disables only that candidate's cells, adds 1 point and passes the turn. These are rejected with the match unchanged:
    - `not_your_turn`.
    - `no_choice_pending` in the `mark` phase.
    - `invalid_choice` for an index out of range, missing, non-integer or boolean.
  - Green: `Match.choose`.
  - Refactor.
  - Verify: tests green.
- [x] 1.6 End of the turn and a full board.
  - Red:
    - The next turn skips players who left, wrapping around the order.
    - When the last empty cell is marked, the match ends with the remaining players who have the highest score as winners and reason `board_full`.
    - A tie gives several winners.
    - A player who left with the highest score does not win.
    - A last mark that completes 2 Us goes to the `choose` phase first and ends only after `choose`.
  - Green: turn advance and end check in `Match`.
  - Refactor.
  - Verify: tests green.
- [x] 1.7 A player leaves the match.
  - Red:
    - A player who leaves is marked as left, and their cells and score stay.
    - If it was their turn, the next remaining player gets it.
    - If they were choosing, no cell is disabled, they score nothing, and the phase goes back to `mark` for the next player.
    - When one player is left, the match ends with that player as the only winner and reason `last_player`, whatever the scores.
  - Green: `Match.leave(player)`.
  - Refactor.
  - Verify: tests green.
- [x] 1.8 State as each player sees it.
  - Red:
    - `match_state(match, viewer)` returns the board as rows of `null` or `{owner, disabled}`, plus `turnOrder`, `currentPlayer`, `phase`, `scores`, `leftPlayers` and `lastMove`.
    - `candidates`, each a list of 5 `{row, col}`, are present only when the viewer is the choosing player.
    - `game_over_payload(match)` returns `winners`, `scores`, `reason` and `board`.
  - Green: serialization functions in `match.py`.
  - Refactor.
  - Verify: tests green.
- [x] 1.9 No U is ever left unscored.
  - Red: a test plays many random games with a seeded random source, choosing a random candidate whenever there is a choice. After every turn, it checks that no cell is part of a complete, enabled U that could still be scored.
  - Green: nothing new should be needed; fix the rules if the test finds a case.
  - Refactor.
  - Verify: test green.

## 2. Backend: game status in the lobby

- [x] 2.1 `status` in the summary.
  - Red: `tests/games/test_lobby.py` checks that `game_summary` gives `status: "waiting"` for a game that has not started, and `"playing"` with only the players still in it, in join order, once the game has started and a player has left.
  - Green: a status on `Game` (with the `Match` attached to it), and the field in `game_summary`.
  - Refactor.
  - Verify: tests green, and the existing summary tests updated for the new field.
- [x] 2.2 Waiting games before games in progress.
  - Red: the spec scenarios "Order by creation", "Games in progress last" and "Games in progress newest first", replacing the old full-games tests.
  - Green: `lobby_snapshot` sorts by status instead of by fullness.
  - Refactor.
  - Verify: tests green.

## 3. Backend: play over `WS /api/ws`

- [x] 3.1 Start when the last seat is taken.
  - Red: `tests/games/test_ws.py`, with a fixed random source injected through a new `get_random` dependency, checks:
    - When the last seat of a 2-player game is taken, the joiner gets `game_joined` then `game_started`. The host gets `game_updated` then `game_started`. Both states match the fixed turn order and show an empty board. A lobby subscriber gets a `games_list` with status `playing`.
    - In a 3-player game, the second player joining sends no `game_started`.
  - Green: `get_random` dependency. The match is created in `_join` with no `await` before it. A playing role is set on every session in the game.
  - Refactor.
  - Verify: tests green.
- [x] 3.2 Joining a game in progress.
  - Red: `join_game` for a started game gets `gameName`/`game_in_progress`, ahead of any name or color clash. A lobby subscriber gets no update.
  - Green: the check in `check_can_join`, after the game is found.
  - Refactor.
  - Verify: tests green.
- [x] 3.3 `mark_cell` over the socket.
  - Red: a valid mark sends `game_state` to every player, with the candidates only to the chooser when there is a choice. Each move error from 1.3 reaches only the sender, and nobody gets `game_state`. A `mark_cell` from a waiting room or from a connection in no game gets `game_not_started`.
  - Green: `mark_cell` handling in `ClientSession`, sending per-viewer states with `send_to_each`.
  - Refactor.
  - Verify: tests green.
- [x] 3.4 `choose_u` over the socket.
  - Red: a valid choice sends `game_state` to everyone. `no_choice_pending`, `invalid_choice`, `not_your_turn` and `game_not_started` reach only the sender.
  - Green: `choose_u` handling.
  - Refactor.
  - Verify: tests green.
- [x] 3.5 Leaving during play, host included.
  - Red:
    - A player's `leave_game` gets `game_left`. The others get `game_state` listing them as left, and the lobby updates.
    - The host's connection closing during play does not send `game_closed`, and the game goes on.
    - The host's `cancel_game` during play gets `game_cancelled` and changes nothing.
    - A player who left can create or join another game.
    - The player whose turn it was leaving passes the turn, even in the middle of a choice.
  - Green: the playing role in `close`, `_leave` and `_cancel`.
  - Refactor.
  - Verify: tests green, and the waiting-room host and player tests still pass unchanged.
- [x] 3.6 End of the game.
  - Red:
    - When the board fills up, and when only one player is left, every remaining player gets `game_over` with the expected winners and reason.
    - The game is no longer in the registry, its name can be used again, and its players can create or join another game.
    - Lobby subscribers get a `games_list` without it.
  - Green: on match end, send `game_over`, then remove the game and close its room in one synchronous step, and broadcast the lobby.
  - Refactor.
  - Verify: tests green.
- [x] 3.7 Document the protocol in `backend/README.md`:
  - `mark_cell`, `choose_u`, `game_started`, `game_state` and `game_over` with their fields.
  - The `status` field and the new lobby order.
  - The new error codes, with their order for `mark_cell`, `choose_u` and `join_game`.
  - The lifetime rule: the host only ends a game that has not started.
  - Verify: every message type and error code in `ws.py` appears in the README.

## 4. Frontend: types and socket client

- [x] 4.1 New messages in `gameSocket.ts`.
  - Red: `gameSocket.test.ts` checks that `markCell(row, col)` and `chooseU(index)` send the expected JSON (queued until the socket opens), and that `game_started`, `game_state` and `game_over` reach their handlers.
  - Green: `GameState`, `GameOver`, `Cell`, `GameStatus` and the new error codes in `types.ts`, and the new methods and events in `gameSocket.ts`.
  - Refactor.
  - Verify: tests green, and `npx tsc -b` passes.
- [x] 4.2 Error message for `game_in_progress`.
  - Red: `errorMessages.test.ts` maps `game_in_progress` to "That game has already started".
  - Green: the entry in `errorMessages.ts`.
  - Refactor.
  - Verify: tests green.

## 5. Frontend: pure game modules

- [x] 5.1 `turnStatus(state, me)`.
  - Red: `src/game/turnStatus.test.ts` checks these outputs:
    - Someone else's turn: "Ana's turn".
    - Own turn: "Your turn!" and `isMyTurn`.
    - Own choice: "Choose your U".
    - Someone else's choice: "Ana is choosing a U".
  - Green: `src/game/turnStatus.ts`.
  - Refactor.
  - Verify: tests green.
- [x] 5.2 `cellLook(cell, leftPlayers, lastMove)`.
  - Red: it returns the right look (`empty`, `taken`, `disabled`, `left`, `left-disabled`) and a last-move flag for each case.
  - Green: `src/game/cellLook.ts`.
  - Refactor.
  - Verify: tests green.
- [x] 5.3 `viewport.ts` zoom and pan.
  - Red:
    - The fit scale for a board and an area, both rotated and not.
    - Zooming in and out stays between the fit scale and the maximum.
    - A pinch keeps the point under the fingers in place.
    - Panning can't move the board out of view.
    - Reset returns to the fit scale.
  - Green: `src/game/viewport.ts`.
  - Refactor.
  - Verify: tests green.
- [x] 5.4 Rotation mapping.
  - Red: `shouldRotate(area)` is true only when the area is taller than wide. Screen-to-cell mapping returns the same `(row, col)` for a cell whether the board is rotated or not, including corners.
  - Green: rotation functions in `viewport.ts`.
  - Refactor.
  - Verify: tests green.
- [x] 5.5 `tapDetector.ts`.
  - Red: one pointer that moved less than 8px is a tap. More movement is a pan. A second pointer makes it a pinch, and never a tap.
  - Green: `src/game/tapDetector.ts`.
  - Refactor.
  - Verify: tests green.
- [x] 5.6 `winnerTitle(gameOver, me)`.
  - Red: "You win!", "Esteban wins!" and "Draw between Esteban and Ana". For reason `last_player`, it adds the "everyone else left" line.
  - Green: `src/game/winnerTitle.ts`.
  - Refactor.
  - Verify: tests green.

## 6. Frontend: screens

- [x] 6.1 In-progress rows in `HomeScreen`.
  - Red: `HomeScreen.test.tsx` checks the spec scenarios "Game in progress row" and "Host left a game in progress". The old "Full" test is replaced.
  - Green: rows by `status` in `HomeScreen.tsx`.
  - Refactor.
  - Verify: tests green.
- [x] 6.2 `GameScreen` layout.
  - Red: `GameScreen.test.tsx` checks:
    - A grid of `width` x `height` cells, all with the same empty look.
    - Players in turn order with color and score, those who left marked "(left)".
    - "Leave game" calls `onLeave`.
  - Green: `src/screens/GameScreen.tsx`.
  - Refactor.
  - Verify: tests green.
- [x] 6.3 Turn bar.
  - Red: the bar shows the `turnStatus` text and the current player's color. On the user's turn, the board has the turn class with the user's color, and `document.title` mentions the turn. The bar is outside the zoomed element.
  - Green: turn bar in `GameScreen`.
  - Refactor.
  - Verify: tests green.
- [x] 6.4 Cell styles.
  - Red: each cell gets the class from `cellLook`, and the last move gets its marker.
  - Green: CSS for the looks: a hatch for disabled cells, reduced opacity for players who left, a dark border on colored cells.
  - Refactor.
  - Verify: tests green. The looks are checked by eye in 8.2.
- [x] 6.5 Marking with a mouse or a touch.
  - Red:
    - On the user's turn, a mouse `pointerup` on an empty cell calls `onMark` at once.
    - A touch tap outlines the cell and shows "Mark", which calls `onMark`. Tapping another cell moves the outline, and tapping it again clears it.
    - Out of turn, in the `choose` phase, or on a taken cell, nothing happens.
  - Green: input handling in `GameScreen`, using `tapDetector`.
  - Refactor.
  - Verify: tests green.
- [x] 6.6 Choosing a U.
  - Red: with 3 candidates, the screen shows "Choose your U (1 of 3)", with candidate 0 highlighted and the other cells dimmed. "Next" moves to 2 of 3 and "Previous" back. "Confirm" calls `onChoose(index)`. Other players see only the waiting text.
  - Green: choice controls in `GameScreen`.
  - Refactor.
  - Verify: tests green.
- [x] 6.7 Zoom, pan and rotation wiring.
  - Red: "+", "-" and "Fit" change the board's transform as `viewport.ts` computes it. A board area that is taller than wide renders the board rotated, using a mocked `ResizeObserver` in the test. When the candidate shown is off screen, the view pans to it.
  - Green: pointer handlers and a `transform` on the board's inner element, `touch-action: none`, and a `ResizeObserver`.
  - Refactor.
  - Verify: tests green. Real pinch and pan are checked in 8.2.
- [x] 6.8 `WinnerScreen`.
  - Red: `WinnerScreen.test.tsx` checks that it shows `winnerTitle` and every final score, and that "Close" calls `onClose`.
  - Green: `src/screens/WinnerScreen.tsx`.
  - Refactor.
  - Verify: tests green.

## 7. Frontend: App flow

- [x] 7.1 From the waiting screen to the game.
  - Red: `App.test.tsx` checks that `game_started` shows the game screen for the host and for a joined player, including when `game_joined` and `game_started` arrive together.
  - Green: a `playing` view in `App.tsx` that keeps the state and the user's name.
  - Refactor.
  - Verify: tests green.
- [x] 7.2 Moves.
  - Red: `game_state` replaces the shown state. Marking and confirming a U send `mark_cell` and `choose_u` through the fake socket.
  - Green: handlers wired to `GameScreen`.
  - Refactor.
  - Verify: tests green.
- [x] 7.3 End of the game.
  - Red: `game_over` shows the winner screen. "Close" returns to the lobby with the current list, sends nothing and clears the waiting flag.
  - Green: a `finished` view.
  - Refactor.
  - Verify: tests green.
- [x] 7.4 Leaving and losing the connection during play.
  - Red:
    - "Leave game" sends `leave_game` (never `cancel_game`, even for the host) and returns to the lobby with no notice.
    - An unintentional close shows "Connection lost, you left the game" with the disconnected lobby.
    - A refresh while playing shows that notice once.
  - Green: the waiting flag kept while playing, and notices for the `playing` view.
  - Refactor.
  - Verify: tests green.
- [x] 7.5 The join form reacts to a game starting.
  - Red: on the join form, a `games_list` with the game in status `playing`, or the error `game_in_progress`, returns to the lobby with "That game has already started".
  - Green: `viewAfterLobbyUpdate` and `viewAfterServerError`.
  - Refactor.
  - Verify: tests green.

- [x] 7.6 Cancelling as the game starts.
  - Red: after "Cancel game", a `game_started` sends `leave_game` once and keeps the lobby. A player who left sends no second `leave_game`, and a game joined after cancelling is not left.
  - Green: `App.tsx` remembers that the user cancelled until they enter another game.
  - Refactor.
  - Verify: tests green.

## 8. Integration check

- [x] 8.1 Full suites and build. In the backend, `pytest -q` is green. In the frontend, `npm test`, `npm run lint` and `npm run build` are all green.
- [x] 8.2 Manual end-to-end check with both dev servers, two desktop browser tabs and a phone on the same network:
  - A creates "Partida 1" with maxPlayers 3 and a 12 x 8 board. B joins, then the phone joins as the third player.
  - The game starts on all three. The lobby in a fourth tab shows "In progress" with the host and "3 / 3", and joining it is impossible.
  - The turn bar always shows whose turn it is, and the current player sees "Your turn!" and the colored border.
  - On desktop, a click marks a cell. On the phone, a tap selects a cell and "Mark" confirms it. A pan never marks a cell.
  - Pinch, "+", "-" and "Fit" work on the phone. The board is drawn rotated when the phone is held upright and turns back when it's held sideways.
  - Forming one U scores it at once, and its cells show hatching. Forming two Us at once shows the choice, and the candidates scroll into view.
  - The host closes their tab. The game goes on, and the host's cells look faded.
  - B leaves, and the phone sees "You win!", with reason "everyone else left". "Close" returns to the lobby, and "Partida 1" is gone from it.
  - A game played to a full board shows the right winner, or a draw.
  - All UI text is in English.

## Workflow follow-up

- Archive the change after review. Archiving creates `openspec/specs/game-play/` and applies the `game-creation`, `game-joining` and `game-lobby` deltas.
- After archiving, update the Purpose of `openspec/specs/game-creation/spec.md`: it still says a game lives only while its creator stays connected, which is now true only before the game starts.
