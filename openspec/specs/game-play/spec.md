# game-play Specification

## Purpose

Lets the players of a full game play it: they take turns marking cells on the board, score a point for each 5-cell U they form, and the game ends with a winner screen when the board is full or only one player is left.

## Requirements

### Requirement: Game starts when it fills up
The system SHALL start a game the moment its player count reaches `maxPlayers`. It SHALL shuffle the players into a random turn order, create an empty board of `boardWidth` x `boardHeight` cells, and send `game_started` with the full game state to every player in the game, after the usual `game_joined` and `game_updated` messages.

#### Scenario: Last seat starts the game
- **GIVEN** "Partida 1" has maxPlayers 2 and 1 player, "Esteban"
- **WHEN** "Ana" joins "Partida 1"
- **THEN** Ana receives `game_joined` then `game_started`, Esteban receives `game_updated` then `game_started`, and both states show an empty 12 x 10 board

#### Scenario: Game with room does not start
- **GIVEN** "Partida 1" has maxPlayers 3 and 1 player
- **WHEN** a second player joins
- **THEN** no `game_started` is sent

### Requirement: Random turn order
The turn order SHALL contain every player of the game exactly once, in an order chosen at random by the server when the game starts. The first player in that order SHALL have the first turn. The order SHALL NOT change during the game, except that players who leave are skipped.

#### Scenario: Order covers every player
- **GIVEN** a game with players "Esteban", "Ana" and "Luis" has just started
- **WHEN** a player reads the turn order in `game_started`
- **THEN** it lists each of the three names exactly once, and the current player is the first one

#### Scenario: Order comes from the server's randomness
- **GIVEN** the server's random source is fixed to put "Ana" first
- **WHEN** the game starts
- **THEN** the turn order starts with "Ana" and it is Ana's turn

### Requirement: Game state messages
`game_started` and `game_state` SHALL carry the full game state: every cell of the board (empty, or the owning player and whether it is disabled), the turn order, the current player, the turn phase (`mark` or `choose`), each player's score, which players have left, and the last cell marked. After every accepted move the system SHALL send `game_state` to every player still in the game.

#### Scenario: Everyone sees a move
- **GIVEN** it is Esteban's turn in a game with Ana
- **WHEN** Esteban sends a valid `mark_cell`
- **THEN** Esteban and Ana each receive `game_state` with that cell owned by Esteban and the turn on Ana

### Requirement: Mark a cell
On their turn, in the `mark` phase, a player SHALL mark one empty cell by sending `mark_cell` with `row` (0 to `boardHeight` - 1) and `col` (0 to `boardWidth` - 1). The cell SHALL become owned by that player. A mark cannot be undone.

#### Scenario: Valid mark
- **GIVEN** it is Esteban's turn and cell (2, 3) is empty
- **WHEN** Esteban sends `mark_cell` with row 2 and col 3
- **THEN** cell (2, 3) is owned by Esteban and is the last cell marked

### Requirement: Move errors
The system SHALL reject an invalid move without changing the game, replying `error` with the first matching code in this order: `game_not_started` (not in a started game), `not_your_turn`, `choice_pending` (a `mark_cell` while the turn is in the `choose` phase), `cell_out_of_bounds` (missing, non-integer or out-of-range `row` or `col`), then `cell_taken` (the cell is not empty).

#### Scenario: Out of turn
- **GIVEN** it is Esteban's turn
- **WHEN** Ana sends `mark_cell`
- **THEN** Ana receives `error` with code `not_your_turn` and nobody receives `game_state`

#### Scenario: Cell already owned
- **GIVEN** cell (2, 3) is owned by Ana and it is Esteban's turn
- **WHEN** Esteban sends `mark_cell` with row 2 and col 3
- **THEN** Esteban receives `error` with code `cell_taken` and it is still his turn

#### Scenario: Disabled cell
- **GIVEN** cell (2, 3) is disabled and it is Esteban's turn
- **WHEN** Esteban sends `mark_cell` with row 2 and col 3
- **THEN** Esteban receives `error` with code `cell_taken`

#### Scenario: Outside the board
- **GIVEN** the board is 12 x 10 and it is Esteban's turn
- **WHEN** Esteban sends `mark_cell` with row 10 and col 0
- **THEN** Esteban receives `error` with code `cell_out_of_bounds`

#### Scenario: Waiting room move
- **GIVEN** a client is in a game that has not started
- **WHEN** it sends `mark_cell`
- **THEN** it receives `error` with code `game_not_started`

#### Scenario: Mark during a choice
- **GIVEN** it is Esteban's turn and he must choose a U
- **WHEN** Esteban sends `mark_cell`
- **THEN** Esteban receives `error` with code `choice_pending`

### Requirement: U shape
A U SHALL be 5 cells owned by the same player and not disabled, forming the U pentomino: a row or column of 3 cells with one more cell at each end on the same side. It can open up, down, left or right. The notch cell between the two arms SHALL NOT be checked: it can be empty or held by anyone.

#### Scenario: U opening up
- **GIVEN** Esteban owns (1,0), (1,1), (1,2) and (0,0), and (0,1) is empty
- **WHEN** Esteban marks (0,2)
- **THEN** a U is formed by (0,0), (0,2), (1,0), (1,1), (1,2)

#### Scenario: U opening left
- **GIVEN** Esteban owns (0,1), (1,1), (2,1) and (0,0)
- **WHEN** Esteban marks (2,0)
- **THEN** a U is formed

#### Scenario: Notch held by the same player
- **GIVEN** Esteban owns (0,0), (0,1), (1,0), (1,1), (1,2)
- **WHEN** Esteban marks (0,2)
- **THEN** a U is formed, although the notch (0,1) is also his

#### Scenario: Another player's cell breaks the shape
- **GIVEN** Esteban owns (0,0), (1,0), (1,1) and Ana owns (0,2)
- **WHEN** Esteban marks (1,2)
- **THEN** no U is formed

#### Scenario: Disabled cells do not count
- **GIVEN** Esteban owns (0,0), (1,0), (1,1), (1,2), and (1,1) is disabled
- **WHEN** Esteban marks (0,2)
- **THEN** no U is formed

### Requirement: Scoring a U
After a mark, the system SHALL find every U that contains the marked cell. With none, the turn ends. With exactly one, the player SHALL score 1 point, the U's 5 cells SHALL become disabled, and the turn ends. With two or more, the turn SHALL enter the `choose` phase. A player SHALL score at most 1 point per turn.

#### Scenario: One U is scored automatically
- **GIVEN** Esteban's mark completes exactly one U
- **WHEN** the move is applied
- **THEN** Esteban's score goes up by 1, the U's 5 cells are disabled, and it is the next player's turn

#### Scenario: No U
- **GIVEN** Esteban's mark completes no U
- **WHEN** the move is applied
- **THEN** no score changes and it is the next player's turn

### Requirement: Disabled cells
A disabled cell SHALL stay owned by its player and SHALL never again be marked, be part of another U, or become enabled.

#### Scenario: Disabled cell cannot join a second U
- **GIVEN** Esteban scored a U whose cells include (1,2)
- **WHEN** Esteban later marks cells that would form a U only by reusing (1,2)
- **THEN** no U is formed

### Requirement: Choosing between several Us
In the `choose` phase, the player whose turn it is SHALL pick one candidate U by sending `choose_u` with its `index` in the candidate list. The player SHALL score 1 point, the chosen U's cells SHALL become disabled, and the turn ends. Only that player's `game_state` SHALL include the candidates, each as its list of 5 cells, in the same order every time.

#### Scenario: Two Us from one mark
- **GIVEN** Esteban owns (0,0), (0,2), (0,4), (1,0), (1,1), (1,3), (1,4)
- **WHEN** Esteban marks (1,2)
- **THEN** the turn enters the `choose` phase, Esteban's `game_state` lists 2 candidates, and Ana's lists none

#### Scenario: Player picks one
- **GIVEN** Esteban must choose between 2 candidates
- **WHEN** Esteban sends `choose_u` with index 1
- **THEN** the cells of candidate 1 are disabled, Esteban scores 1 point, the cells of the other candidate that are not in candidate 1 stay enabled, and it is the next player's turn

### Requirement: Choice errors
The system SHALL reject a `choose_u` without changing the game, replying `error` with the first matching code in this order: `game_not_started`, `not_your_turn`, `no_choice_pending` (the turn is in the `mark` phase), then `invalid_choice` (missing, non-integer or out-of-range `index`).

#### Scenario: Nothing to choose
- **GIVEN** it is Esteban's turn in the `mark` phase
- **WHEN** Esteban sends `choose_u` with index 0
- **THEN** Esteban receives `error` with code `no_choice_pending`

#### Scenario: Index out of range
- **GIVEN** Esteban must choose between 2 candidates
- **WHEN** Esteban sends `choose_u` with index 2
- **THEN** Esteban receives `error` with code `invalid_choice` and must still choose

### Requirement: Leaving a started game
A player, host included, SHALL leave a started game by sending `leave_game` or when their connection closes. They SHALL be confirmed with `game_left` when they sent `leave_game`, and their connection SHALL then be free to create or join another game. Everyone still in the game SHALL receive `game_state` showing them as left.

#### Scenario: Player leaves mid-game
- **GIVEN** Esteban, Ana and Luis are playing
- **WHEN** Luis sends `leave_game`
- **THEN** Luis receives `game_left`, and Esteban and Ana receive `game_state` listing Luis as left

#### Scenario: Host disconnects mid-game
- **GIVEN** Esteban created the game and is playing with Ana and Luis
- **WHEN** Esteban's connection closes
- **THEN** the game continues for Ana and Luis, and neither receives `game_closed`

### Requirement: What a leaving player leaves behind
The cells of a player who left SHALL stay on the board, owned by them, and SHALL never be marked again or be part of a U. Their score SHALL stay in the game state, but they SHALL NOT win. They SHALL be skipped in the turn order. If it was their turn, the turn SHALL pass to the next remaining player; if they were choosing a U, they SHALL score nothing and no cell is disabled.

#### Scenario: Turn passes when its player leaves
- **GIVEN** it is Luis's turn and Ana comes after him
- **WHEN** Luis leaves
- **THEN** it is Ana's turn

#### Scenario: Leaving while choosing scores nothing
- **GIVEN** Luis has 2 points and must choose between 2 candidates
- **WHEN** Luis's connection closes
- **THEN** Luis still has 2 points, none of the candidate cells is disabled, and the next player has the turn

#### Scenario: Left player's cells stay taken
- **GIVEN** Luis owned cell (4, 4) and has left
- **WHEN** Ana sends `mark_cell` with row 4 and col 4
- **THEN** Ana receives `error` with code `cell_taken`

### Requirement: Game ends when the board is full
After a turn ends, if no cell is empty, the system SHALL end the game. The winners SHALL be the remaining players with the highest score; several winners make a draw. A mark that fills the last empty cell and completes several Us SHALL first go through the `choose` phase.

#### Scenario: Clear winner
- **GIVEN** the last empty cell is marked, the remaining players are Esteban with 4 points and Ana with 2
- **WHEN** the turn ends
- **THEN** the game ends with winners `["Esteban"]`

#### Scenario: Draw
- **GIVEN** the board becomes full with Esteban and Ana both on 3 points
- **WHEN** the turn ends
- **THEN** the game ends with winners Esteban and Ana

#### Scenario: Left player's score does not win
- **GIVEN** the board becomes full, Luis left with 5 points, and Ana has the best remaining score with 3
- **WHEN** the turn ends
- **THEN** the winners are `["Ana"]`

### Requirement: Last player standing wins
When a player leaves a started game and exactly one player is still in it, the system SHALL end the game at once with that player as the only winner, whatever the scores.

#### Scenario: Everyone else leaves
- **GIVEN** Esteban has 0 points and Ana has 3
- **WHEN** Ana leaves
- **THEN** the game ends and Esteban is the only winner

### Requirement: End of the game
When a game ends, the system SHALL send `game_over` to every player still in it, with the winners, every player's final score, the reason (`board_full` or `last_player`) and the final board. It SHALL then remove the game, freeing its name, and those connections SHALL no longer be in any game.

#### Scenario: Game removed after the end
- **GIVEN** "Partida 1" has just ended
- **WHEN** a client sends `create_game` with game name "Partida 1"
- **THEN** the game is created

#### Scenario: Players are free after the end
- **GIVEN** Ana received `game_over`
- **WHEN** Ana sends a valid `join_game`
- **THEN** she joins the game

### Requirement: Game screen
On `game_started`, the client SHALL show the game screen: the board, where every empty cell has the same color, a fixed turn bar, the players in turn order with their color and score (players who left marked "(left)"), and a "Leave game" button that sends `leave_game` and returns to the lobby. All UI text SHALL be in English.

#### Scenario: Screen after the start
- **WHEN** `game_started` arrives for a 12 x 10 game with Ana first and Esteban second
- **THEN** the user sees a 12 x 10 board of identical empty cells, and the players "Ana 0" and "Esteban 0" in that order

#### Scenario: Leaving from the game screen
- **WHEN** the user clicks "Leave game"
- **THEN** the client sends `leave_game` and the user is on the lobby with no notice

### Requirement: Whose turn it is
The turn bar SHALL always show whose turn it is, with that player's name and color. For the player whose turn it is, it SHALL show "Your turn!", the board SHALL get a border in their color, and the page title SHALL say it is their turn. While a player chooses a U, the others SHALL see "<name> is choosing a U". The bar SHALL stay visible at any zoom level.

#### Scenario: Someone else's turn
- **GIVEN** the user is Esteban
- **WHEN** a `game_state` arrives with Ana as current player
- **THEN** the turn bar shows "Ana's turn" with Ana's color

#### Scenario: Own turn
- **GIVEN** the user is Esteban
- **WHEN** a `game_state` arrives with Esteban as current player
- **THEN** the turn bar shows "Your turn!", the board has a border in Esteban's color, and the page title mentions the turn

### Requirement: Cell appearance
Each cell state SHALL be distinguishable without relying on color alone: empty (uniform neutral), taken (solid player color), disabled (player color with a hatch pattern), taken by a player who left (faded player color, no pattern), disabled and left (faded with hatch). The last cell marked SHALL be marked. Every colored cell SHALL have a dark border.

#### Scenario: Disabled cells look different
- **GIVEN** Esteban (red) owns a taken cell and a disabled cell
- **WHEN** the board is shown
- **THEN** both cells are red, and only the disabled one shows the hatch pattern

#### Scenario: Left player's cells are faded
- **GIVEN** Luis has left
- **WHEN** the board is shown
- **THEN** Luis's cells are shown faded

### Requirement: Marking with a mouse or a touch
Only on the user's own turn in the `mark` phase, and only on empty cells, the board SHALL accept input. A mouse click SHALL send `mark_cell` at once. A touch or pen tap SHALL select the cell, shown outlined, and a "Mark" button in the turn bar SHALL send `mark_cell`. Tapping another cell moves the selection; tapping the selected cell clears it.

#### Scenario: Mouse click marks
- **GIVEN** it is the user's turn
- **WHEN** the user clicks an empty cell with a mouse
- **THEN** the client sends `mark_cell` for that cell

#### Scenario: Touch needs confirmation
- **GIVEN** it is the user's turn
- **WHEN** the user taps an empty cell with a finger
- **THEN** the cell is outlined, nothing is sent, and a "Mark" button appears; pressing it sends `mark_cell` for that cell

#### Scenario: Board inert out of turn
- **GIVEN** it is not the user's turn
- **WHEN** the user clicks an empty cell
- **THEN** nothing is sent and nothing is selected

### Requirement: Choosing a U on screen
In the `choose` phase, the choosing player SHALL see "Choose your U (i of n)", with the current candidate's cells highlighted on the board and the other cells dimmed, and "Previous", "Next" and "Confirm" buttons. Confirm SHALL send `choose_u` with the shown index. A candidate off screen SHALL be brought into view. The board SHALL ignore cell input meanwhile.

#### Scenario: Cycling and confirming
- **GIVEN** the user must choose between 3 candidates and sees "Choose your U (1 of 3)"
- **WHEN** the user presses "Next" and then "Confirm"
- **THEN** the client sends `choose_u` with index 1

### Requirement: Board fits the screen and zooms
The board SHALL start fitted to the space available. The user SHALL zoom it with a pinch, or with "-", "Fit" and "+" buttons, and pan it with one finger or by dragging. Only the board SHALL zoom. A touch SHALL count as a tap only if it moved less than a small threshold and used one finger. Zoom and pan SHALL reset when the screen rotates.

#### Scenario: Zoom buttons
- **GIVEN** the board is fitted
- **WHEN** the user presses "+"
- **THEN** the cells get bigger and the turn bar keeps its size

#### Scenario: Pan does not mark
- **GIVEN** it is the user's turn
- **WHEN** the user drags a finger across the board
- **THEN** the board pans and no cell is selected

### Requirement: Board rotated in portrait
When the board area is taller than it is wide, the client SHALL draw the board rotated a quarter turn, so its longer side runs along the longer side of the screen. Rotation SHALL only change how the board is drawn: the cells and their coordinates SHALL stay the same.

#### Scenario: Phone held upright
- **GIVEN** a 30 x 12 game on a screen taller than it is wide
- **WHEN** the board is shown
- **THEN** it is drawn 12 cells across and 30 cells down, and tapping a cell selects the same cell as on an unrotated board

### Requirement: Winner screen
On `game_over`, the client SHALL show a winner screen: "You win!" when the user is the only winner, "<name> wins!" for another single winner, or "Draw between <names>" for several, plus every player's final score. For `last_player` it SHALL say everyone else left. Its "Close" button SHALL return to the lobby.

#### Scenario: Another player wins
- **GIVEN** the user is Ana
- **WHEN** `game_over` arrives with winners `["Esteban"]` and reason `board_full`
- **THEN** the user sees "Esteban wins!" and the final scores

#### Scenario: Draw
- **WHEN** `game_over` arrives with winners Esteban and Ana
- **THEN** the user sees "Draw between Esteban and Ana"

#### Scenario: Closing returns to the lobby
- **GIVEN** the winner screen is shown
- **WHEN** the user clicks "Close"
- **THEN** the user is on the lobby, which shows the current list of games, and no message is sent to the server

### Requirement: Connection lost during play
When the connection is lost or the page is reloaded during play, the client SHALL show the lobby, in its disconnected state when the connection was lost, with the notice "Connection lost, you left the game" once.

#### Scenario: Connection lost while playing
- **GIVEN** the user is on the game screen
- **WHEN** the connection closes
- **THEN** the user sees "Connection lost, you left the game" and the lobby in its disconnected state
