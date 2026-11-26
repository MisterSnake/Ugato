# Spec Delta

## ADDED Requirements

### Requirement: End-vote attempts
Each player SHALL start the game with 2 attempts to propose ending it. Proposing SHALL need at least 1 attempt. When a vote fails, its proposer SHALL lose 1 attempt and every other player still in the game SHALL gain 1, never going above 2. A vote that ends the game or is cancelled SHALL change no attempts.

#### Scenario: Attempts at the start
- **WHEN** a game starts
- **THEN** every player has 2 attempts left

#### Scenario: Failed vote spends an attempt
- **GIVEN** Esteban, Ana and Luis each have 2 attempts
- **WHEN** a vote proposed by Esteban fails
- **THEN** Esteban has 1 attempt left, and Ana and Luis still have 2

#### Scenario: Another player's failed vote gives an attempt back
- **GIVEN** Esteban has 1 attempt left and Ana has 2
- **WHEN** a vote proposed by Ana fails
- **THEN** Esteban has 2 attempts left and Ana has 1

#### Scenario: Attempts recover from zero
- **GIVEN** Esteban has 0 attempts left and Ana has 2
- **WHEN** a vote proposed by Ana fails
- **THEN** Esteban has 1 attempt left

### Requirement: Propose ending the game
On their turn, in the `mark` phase and with no vote open, a player SHALL propose ending the game by sending `propose_end`. The system SHALL open a vote with that player as proposer, counting them as a vote to end, and send `game_state` to every player still in the game.

#### Scenario: Proposal opens a vote
- **GIVEN** it is Esteban's turn in the `mark` phase and he has 2 attempts
- **WHEN** Esteban sends `propose_end`
- **THEN** Esteban and Ana receive `game_state` showing an open vote proposed by Esteban, in which Esteban has voted to end

### Requirement: Proposal errors
The system SHALL reject a `propose_end` without changing the game, replying `error` with the first matching code in this order: `game_not_started`, `not_your_turn`, `vote_pending` (a vote is open), `choice_pending` (the turn is in the `choose` phase), then `no_proposals_left` (the player has 0 attempts).

#### Scenario: Out of turn
- **GIVEN** it is Esteban's turn
- **WHEN** Ana sends `propose_end`
- **THEN** Ana receives `error` with code `not_your_turn` and no vote is open

#### Scenario: While choosing a U
- **GIVEN** it is Esteban's turn and he must choose a U
- **WHEN** Esteban sends `propose_end`
- **THEN** Esteban receives `error` with code `choice_pending`

#### Scenario: No attempts left
- **GIVEN** it is Esteban's turn and he has 0 attempts left
- **WHEN** Esteban sends `propose_end`
- **THEN** Esteban receives `error` with code `no_proposals_left`

#### Scenario: Vote already open
- **GIVEN** Esteban has proposed ending the game and the vote is open
- **WHEN** Esteban sends `propose_end` again
- **THEN** Esteban receives `error` with code `vote_pending`

### Requirement: Open vote in the game state
The `vote` of the game state SHALL carry its proposer, how many players have voted (the proposer included), how many players are still in the game, the whole seconds left, and the viewer's own vote (`end`, `continue` or null). It SHALL NOT reveal the other players' votes.

#### Scenario: Each player sees their own vote
- **GIVEN** Esteban, Ana and Luis are playing and Esteban proposed ending the game
- **WHEN** Ana and Esteban receive `game_state`
- **THEN** both see proposer Esteban, 1 of 3 voted and up to 30 seconds left; Ana's own vote is null and Esteban's is `end`

#### Scenario: Votes stay secret
- **GIVEN** Esteban proposed ending the game and Ana voted to keep playing
- **WHEN** Luis receives `game_state`
- **THEN** it shows 2 of 3 voted and does not say what Ana voted

### Requirement: Voting
While a vote is open, every player still in the game other than the proposer SHALL vote once by sending `vote_end` with `end` set to `true` (end the game) or `false` (keep playing). A vote SHALL NOT be changed. After each accepted vote the system SHALL send `game_state` to every player still in the game, unless the vote settles.

#### Scenario: A player votes
- **GIVEN** Esteban, Ana, Luis and Marta are playing and Esteban proposed ending the game
- **WHEN** Ana sends `vote_end` with `end` false
- **THEN** every player receives `game_state` showing 2 of 4 players have voted, and the vote is still open

### Requirement: Vote errors
The system SHALL reject a `vote_end` without changing the game, replying `error` with the first matching code in this order: `game_not_started`, `no_vote_pending` (no vote is open), `proposer_cannot_vote`, `already_voted`, then `invalid_vote` (`end` is missing or not a boolean).

#### Scenario: No vote open
- **GIVEN** a started game with no vote open
- **WHEN** Ana sends `vote_end` with `end` true
- **THEN** Ana receives `error` with code `no_vote_pending`

#### Scenario: Proposer votes
- **GIVEN** Esteban proposed ending the game
- **WHEN** Esteban sends `vote_end` with `end` false
- **THEN** Esteban receives `error` with code `proposer_cannot_vote`

#### Scenario: Second vote
- **GIVEN** Ana has already voted in the open vote
- **WHEN** Ana sends `vote_end` again
- **THEN** Ana receives `error` with code `already_voted` and her first vote stands

#### Scenario: Not a boolean
- **GIVEN** a vote is open and Ana has not voted
- **WHEN** Ana sends `vote_end` with `end` "yes"
- **THEN** Ana receives `error` with code `invalid_vote`

### Requirement: Settling a vote
A vote SHALL pass when the votes to end are a strict majority of the players still in the game, that is at least floor(n / 2) + 1 of n. It SHALL fail on a tie or a majority to keep playing. The system SHALL settle the vote as soon as its result can no longer change, without waiting for the remaining votes.

#### Scenario: Majority ends the game
- **GIVEN** Esteban, Ana and Luis are playing and Esteban proposed ending the game
- **WHEN** Ana votes to end
- **THEN** the vote passes at once, before Luis votes

#### Scenario: Tie keeps the game going
- **GIVEN** Esteban, Ana, Luis and Marta are playing, Esteban proposed ending the game and Ana voted to end
- **WHEN** Luis and Marta vote to keep playing
- **THEN** the vote fails

#### Scenario: Two players must agree
- **GIVEN** Esteban and Ana are playing and Esteban proposed ending the game
- **WHEN** Ana votes to keep playing
- **THEN** the vote fails

#### Scenario: Result decided early
- **GIVEN** Esteban, Ana, Luis and Marta are playing and Esteban proposed ending the game
- **WHEN** Ana and Luis vote to keep playing
- **THEN** the vote fails at once, before Marta votes

### Requirement: Vote time limit
A vote SHALL close 30 seconds after it was proposed if it has not settled. Players who have not voted by then SHALL count as votes to keep playing, and the vote SHALL then be settled.

#### Scenario: Silent players keep the game going
- **GIVEN** Esteban, Ana and Luis are playing, Esteban proposed ending the game and nobody else voted
- **WHEN** 30 seconds pass
- **THEN** the vote fails with 1 vote to end and 2 to keep playing

#### Scenario: Early close stops the clock
- **GIVEN** a vote passed or failed before its 30 seconds were up
- **WHEN** the 30 seconds pass
- **THEN** nothing happens and nobody receives a message

### Requirement: Failed vote
When a vote fails, the system SHALL send `vote_failed` with the proposer and the number of votes to end and to keep playing, then `game_state`, to every player still in the game. The vote SHALL close, the attempts SHALL change as the end-vote attempts rule says, and it SHALL still be the proposer's turn, in the `mark` phase.

#### Scenario: Proposer goes on with the turn
- **GIVEN** it is Esteban's turn and he proposed ending the game against Ana
- **WHEN** Ana votes to keep playing
- **THEN** Esteban and Ana receive `vote_failed` with 1 vote to end and 1 to keep playing, then `game_state` with no open vote, and it is still Esteban's turn in the `mark` phase

### Requirement: Passed vote
When a vote passes, the system SHALL end the game. The winners SHALL be the remaining players with the highest score; several winners make a draw, and a player who left SHALL NOT win.

#### Scenario: Highest score wins
- **GIVEN** Esteban has 3 points, Ana 1 and Luis 2, and Esteban proposed ending the game
- **WHEN** Ana votes to end
- **THEN** the game ends with winners `["Esteban"]`

#### Scenario: Tied scores make a draw
- **GIVEN** Esteban and Ana both have 2 points and Luis has 1
- **WHEN** a vote to end the game passes
- **THEN** the game ends with winners Esteban and Ana

### Requirement: Leaving during a vote
When a voter leaves during a vote, their vote SHALL no longer count and the majority SHALL be computed over the players still in the game, which can settle the vote. When the proposer leaves, the vote SHALL be cancelled with no change to attempts, and the turn SHALL pass as for any player who leaves. When only one player is left, the last player standing rule SHALL apply instead.

#### Scenario: Voter leaves and the vote settles
- **GIVEN** Esteban, Ana, Luis and Marta are playing, Esteban proposed ending the game, Ana voted to end and Luis voted to keep playing
- **WHEN** Luis leaves
- **THEN** the vote passes with 2 of 3 players voting to end

#### Scenario: Proposer leaves
- **GIVEN** Esteban, Ana and Luis are playing, Esteban proposed ending the game with 2 attempts and Ana comes after him
- **WHEN** Esteban leaves
- **THEN** the vote is cancelled, it is Ana's turn, and Ana and Luis still have 2 attempts

#### Scenario: Last player during a vote
- **GIVEN** Esteban and Ana are playing and Esteban proposed ending the game
- **WHEN** Ana leaves
- **THEN** the game ends with reason `last_player` and Esteban as the only winner

### Requirement: Propose button
The turn bar SHALL show a "Propose ending (n left)" button, where n is the user's attempts left. It SHALL be enabled only on the user's own turn, in the `mark` phase, with no vote open and at least 1 attempt left. Pressing it SHALL send `propose_end`.

#### Scenario: Proposing from the turn bar
- **GIVEN** it is the user's turn in the `mark` phase and they have 2 attempts left
- **WHEN** the user presses "Propose ending (2 left)"
- **THEN** the client sends `propose_end`

#### Scenario: Button disabled out of turn
- **GIVEN** it is not the user's turn
- **WHEN** the game screen is shown
- **THEN** the "Propose ending" button is disabled

### Requirement: Voting panel
While a vote is open, every player SHALL see "<name> wants to end the game" (or "You proposed ending the game" for the proposer), how many players have voted out of how many, and the seconds left, counting down. A player who has not voted SHALL see "End game" and "Keep playing" buttons that send `vote_end` with `end` true and false. Who voted what SHALL NOT be shown. The board SHALL ignore cell input meanwhile.

#### Scenario: Voting from the panel
- **GIVEN** the user is Ana and Esteban proposed ending the game
- **WHEN** Ana presses "Keep playing"
- **THEN** the client sends `vote_end` with `end` false, and the buttons are replaced by a note that she has voted

#### Scenario: Proposer only waits
- **GIVEN** the user proposed ending the game
- **WHEN** the voting panel is shown
- **THEN** the user sees "You proposed ending the game" and the countdown, and no vote buttons

#### Scenario: Board inert during a vote
- **GIVEN** a vote is open on the user's turn
- **WHEN** the user clicks an empty cell
- **THEN** nothing is sent

### Requirement: Failed vote notice
On `vote_failed`, the client SHALL show "The game goes on" with the number of votes to end and to keep playing, until the next move.

#### Scenario: Notice after a failed vote
- **WHEN** `vote_failed` arrives with 1 vote to end and 2 to keep playing
- **THEN** the user sees "The game goes on (1 to end, 2 to keep playing)"

## MODIFIED Requirements

### Requirement: Game state messages
`game_started` and `game_state` SHALL carry the full game state: every cell of the board (empty, or the owning player and whether it is disabled), the turn order, the current player, the turn phase (`mark` or `choose`), each player's score, which players have left, the last cell marked, each player's end-vote attempts left (`endProposalsLeft`) and the open vote (`vote`, or null). After every accepted move the system SHALL send `game_state` to every player still in the game.

#### Scenario: Everyone sees a move
- **GIVEN** it is Esteban's turn in a game with Ana
- **WHEN** Esteban sends a valid `mark_cell`
- **THEN** Esteban and Ana each receive `game_state` with that cell owned by Esteban and the turn on Ana

#### Scenario: No vote open
- **WHEN** a game starts
- **THEN** `game_started` has `vote` null and `endProposalsLeft` 2 for every player

### Requirement: Move errors
The system SHALL reject an invalid move without changing the game, replying `error` with the first matching code in this order: `game_not_started` (not in a started game), `not_your_turn`, `vote_pending` (a vote is open), `choice_pending` (a `mark_cell` while the turn is in the `choose` phase), `cell_out_of_bounds` (missing, non-integer or out-of-range `row` or `col`), then `cell_taken` (the cell is not empty).

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

#### Scenario: Mark during a vote
- **GIVEN** it is Esteban's turn and he proposed ending the game
- **WHEN** Esteban sends `mark_cell` with an empty cell
- **THEN** Esteban receives `error` with code `vote_pending` and the cell stays empty

### Requirement: Choice errors
The system SHALL reject a `choose_u` without changing the game, replying `error` with the first matching code in this order: `game_not_started`, `not_your_turn`, `vote_pending` (a vote is open), `no_choice_pending` (the turn is in the `mark` phase), then `invalid_choice` (missing, non-integer or out-of-range `index`).

#### Scenario: Nothing to choose
- **GIVEN** it is Esteban's turn in the `mark` phase
- **WHEN** Esteban sends `choose_u` with index 0
- **THEN** Esteban receives `error` with code `no_choice_pending`

#### Scenario: Index out of range
- **GIVEN** Esteban must choose between 2 candidates
- **WHEN** Esteban sends `choose_u` with index 2
- **THEN** Esteban receives `error` with code `invalid_choice` and must still choose

#### Scenario: Choice during a vote
- **GIVEN** it is Esteban's turn and he proposed ending the game
- **WHEN** Esteban sends `choose_u` with index 0
- **THEN** Esteban receives `error` with code `vote_pending`

### Requirement: End of the game
When a game ends, the system SHALL send `game_over` to every player still in it, with the winners, every player's final score, the reason (`board_full`, `last_player` or `vote`) and the final board. It SHALL then remove the game, freeing its name, and those connections SHALL no longer be in any game.

#### Scenario: Game removed after the end
- **GIVEN** "Partida 1" has just ended
- **WHEN** a client sends `create_game` with game name "Partida 1"
- **THEN** the game is created

#### Scenario: Players are free after the end
- **GIVEN** Ana received `game_over`
- **WHEN** Ana sends a valid `join_game`
- **THEN** she joins the game

#### Scenario: Game ended by vote
- **GIVEN** Esteban and Ana are playing and Esteban proposed ending the game
- **WHEN** Ana votes to end
- **THEN** Esteban and Ana receive `game_over` with reason `vote`

### Requirement: Winner screen
On `game_over`, the client SHALL show a winner screen: "You win!" when the user is the only winner, "<name> wins!" for another single winner, or "Draw between <names>" for several, plus every player's final score. For `last_player` it SHALL say everyone else left. For `vote` it SHALL say the players voted to end the game. Its "Close" button SHALL return to the lobby.

#### Scenario: Another player wins
- **GIVEN** the user is Ana
- **WHEN** `game_over` arrives with winners `["Esteban"]` and reason `board_full`
- **THEN** the user sees "Esteban wins!" and the final scores

#### Scenario: Draw
- **WHEN** `game_over` arrives with winners Esteban and Ana
- **THEN** the user sees "Draw between Esteban and Ana"

#### Scenario: Ended by vote
- **GIVEN** the user is Ana
- **WHEN** `game_over` arrives with winners `["Esteban"]` and reason `vote`
- **THEN** the user sees "Esteban wins!", a line saying the players voted to end the game, and the final scores

#### Scenario: Closing returns to the lobby
- **GIVEN** the winner screen is shown
- **WHEN** the user clicks "Close"
- **THEN** the user is on the lobby, which shows the current list of games, and no message is sent to the server
