# turn-timer Specification

## Purpose

Gives each player of a timed game their own clock, so the host can set how fast the game plays: clocks run down on the player's turn, refill with an increment after each finished turn, and cost the turn when they run out.

## ADDED Requirements

### Requirement: Timer modes
A game SHALL have one of four timer modes, chosen by its creator: `none` (No timer), `slow` (Slow 60-15), `normal` (Normal 30-10) or `fast` (Fast 10-5). For a timed mode the first number is the starting time in seconds and the second is the increment in seconds gained after each finished turn: 60 and 15, 30 and 10, 10 and 5.

#### Scenario: Normal mode values
- **GIVEN** "Partida 1" was created with timer `normal`
- **WHEN** the game starts
- **THEN** every player's clock shows 30 seconds and each finished turn will add 10 seconds

#### Scenario: Fast mode values
- **GIVEN** "Duel" was created with timer `fast`
- **WHEN** the game starts
- **THEN** every player's clock shows 10 seconds and each finished turn will add 5 seconds

### Requirement: Games without a timer
A game with timer `none` SHALL have no clocks: no player can run out of time, choosing a U has no time limit, and play SHALL behave exactly as it does without this capability.

#### Scenario: No time limit
- **GIVEN** a started game with timer `none` and it is Esteban's turn
- **WHEN** 10 minutes pass without a move
- **THEN** it is still Esteban's turn and nobody receives a message

### Requirement: Clocks start with the game
When a timed game starts, every player's clock SHALL be set to the mode's starting time and the first player's clock SHALL start running.

#### Scenario: First player's clock runs
- **GIVEN** a game with timer `normal`, players Ana and Esteban, Ana first in the turn order
- **WHEN** the game starts and 4 seconds pass
- **THEN** Ana's clock shows 26 seconds and Esteban's shows 30

### Requirement: Clock runs only on the player's own mark phase
A player's clock SHALL run only while it is their turn, in the `mark` phase, with no vote open. At every other moment it SHALL keep its value.

#### Scenario: Other players' clocks stay still
- **GIVEN** a game with timer `normal` and it is Ana's turn
- **WHEN** 5 seconds pass
- **THEN** Ana's clock has gone down by 5 seconds and Esteban's has not changed

### Requirement: Increment after a finished turn
When a player's turn ends with a move, the time it took SHALL be taken from their clock and the mode's increment SHALL then be added to it. A turn ends with a move when a mark completes no U or exactly one U, or when a U is chosen, by the player or by the server. There SHALL be no upper limit to a clock.

#### Scenario: Mark without a U
- **GIVEN** a game with timer `normal`, Ana's clock shows 30 seconds and it is her turn
- **WHEN** Ana marks a cell after 4 seconds and completes no U
- **THEN** Ana's clock shows 36 seconds and it is the next player's turn

#### Scenario: Clocks grow without a cap
- **GIVEN** a game with timer `slow` and Esteban's clock shows 120 seconds on his turn
- **WHEN** Esteban marks a cell after 3 seconds
- **THEN** Esteban's clock shows 132 seconds

### Requirement: Running out of time
When the current player's clock reaches 0 in the `mark` phase, the server SHALL wait the grace window and then, if no move arrived, end the turn without a mark and without an increment, reset that player's clock to the mode's starting time, and pass the turn to the next remaining player, whose clock starts running.

#### Scenario: Turn is lost
- **GIVEN** a game with timer `fast`, Ana and Esteban, and it is Ana's turn with 2 seconds on her clock
- **WHEN** 2.5 seconds pass without a move
- **THEN** no cell is marked, Ana's clock shows 10 seconds, and it is Esteban's turn with his clock running

#### Scenario: Reset can lower a large clock
- **GIVEN** a game with timer `slow` and Esteban has 200 seconds on his clock on his turn
- **WHEN** his clock runs out
- **THEN** Esteban's clock shows 60 seconds

### Requirement: Timeout message
When a turn is lost to the clock, the system SHALL send `turn_timed_out` with the `player` who ran out of time, then `game_state`, to every player still in the game.

#### Scenario: Everyone is told
- **GIVEN** a game with timer `normal` and Ana, Esteban and Luis are playing
- **WHEN** Ana's clock runs out on her turn
- **THEN** Ana, Esteban and Luis each receive `turn_timed_out` with player "Ana", then `game_state` with the turn on the next player

### Requirement: Grace window
After a clock reaches 0, the system SHALL wait 500 milliseconds before acting on it. A valid move that arrives within that window SHALL be accepted as if it arrived in time. A clock SHALL never show less than 0.

#### Scenario: Move just in time
- **GIVEN** a game with timer `normal` and Ana's clock reached 0 on her turn 300 milliseconds ago
- **WHEN** Ana sends a valid `mark_cell` that completes no U
- **THEN** the mark is accepted, Ana's clock shows 10 seconds, and nobody receives `turn_timed_out`

#### Scenario: Move after the window
- **GIVEN** Ana's clock reached 0 on her turn and her turn was lost
- **WHEN** Ana's `mark_cell` arrives afterwards
- **THEN** Ana receives `error` with code `not_your_turn`

### Requirement: Choose clock
When a mark sends the turn into the `choose` phase in a timed game, the player's clock SHALL stop with the time it had, and a separate choose clock SHALL start, lasting `ceil(increment / 2) * (n - 1)` seconds, where `n` is the number of candidate Us. Choose time left unused SHALL be lost.

#### Scenario: Two candidates on Normal
- **GIVEN** a game with timer `normal` and Esteban's clock shows 18 seconds on his turn
- **WHEN** Esteban's mark completes 2 Us
- **THEN** Esteban's clock stays at 18 seconds and the choose clock shows 5 seconds

#### Scenario: Three candidates on Slow
- **GIVEN** a game with timer `slow`
- **WHEN** a player's mark completes 3 Us
- **THEN** the choose clock shows 16 seconds

#### Scenario: Unused choose time is lost
- **GIVEN** a game with timer `normal`, Esteban's clock stopped at 18 seconds and the choose clock started at 10 seconds
- **WHEN** Esteban chooses a U after 2 seconds
- **THEN** Esteban's clock shows 28 seconds

### Requirement: Choose clock runs out
When the choose clock reaches 0, the system SHALL wait the grace window and then, if no choice arrived, choose the first candidate for the player: they SHALL score 1 point, its cells SHALL become disabled, they SHALL gain the increment, and the turn SHALL end. Every player still in the game SHALL receive `game_state`.

#### Scenario: Server picks the first candidate
- **GIVEN** a game with timer `fast`, Esteban has 1 point, his clock stopped at 6 seconds, and he must choose between 2 candidates
- **WHEN** 3.5 seconds pass without a choice
- **THEN** the cells of candidate 0 are disabled, Esteban has 2 points, his clock shows 11 seconds, and it is the next player's turn

### Requirement: Vote freezes the clock
While an end-game vote is open, the proposer's clock SHALL not run. When the vote fails, the proposer's clock SHALL resume from the value it had when the vote opened. The vote's own time limit is not affected.

#### Scenario: Clock resumes after a failed vote
- **GIVEN** a game with timer `normal`, it is Esteban's turn and his clock shows 21 seconds
- **WHEN** Esteban proposes ending the game, the vote fails 12 seconds later, and then 1 second passes
- **THEN** Esteban's clock shows 20 seconds and it is still his turn

### Requirement: Leaving stops the clock
When the current player leaves, their clock SHALL stop, any choose clock SHALL be dropped, and the clock of the player who gets the turn SHALL start running from its own value. A player who leaves SHALL gain no increment.

#### Scenario: Next player's clock starts
- **GIVEN** a game with timer `normal`, it is Luis's turn, Ana comes after him and her clock shows 25 seconds
- **WHEN** Luis leaves and 3 seconds pass
- **THEN** it is Ana's turn and her clock shows 22 seconds

### Requirement: Clocks in the game state
`game_started` and `game_state` SHALL carry `timer` (the mode), `clocks` (each player's remaining time in milliseconds, as of when the message is sent, or null for timer `none`) and `chooseMsLeft` (the choose clock's remaining milliseconds, or null when no choose clock is running).

#### Scenario: Timed game state
- **GIVEN** a game with timer `normal`, Ana's turn, and Ana has used 4 seconds
- **WHEN** a `game_state` is sent
- **THEN** it has timer `normal`, clocks Ana 26000 and Esteban 30000, and chooseMsLeft null

#### Scenario: Untimed game state
- **WHEN** a game with timer `none` starts
- **THEN** `game_started` has timer `none`, clocks null and chooseMsLeft null

### Requirement: Clocks on the game screen
In a timed game, the game screen SHALL show each player's remaining time next to their score, and the current player's time counting down while their clock runs. Times of 10 seconds or more SHALL be shown as "m:ss" and times under 10 seconds with tenths, as "s.t".

#### Scenario: Times are formatted
- **GIVEN** a game with timer `slow`
- **WHEN** a `game_state` arrives with clocks Ana 75000 and Esteban 9400
- **THEN** the player list shows "1:15" for Ana and "9.4" for Esteban

#### Scenario: Frozen clock does not count down
- **GIVEN** a vote is open on Esteban's turn and his clock shows "0:21"
- **WHEN** 5 seconds pass
- **THEN** Esteban's clock still shows "0:21"

#### Scenario: Untimed game shows no clocks
- **WHEN** a game with timer `none` starts
- **THEN** the game screen shows no clock

### Requirement: Choose clock on the game screen
While a choose clock runs, the turn bar SHALL show it counting down, in the same format as the player clocks: "Choose a U (<time>)" for the player choosing and "<name> is choosing a U (<time>)" for everyone else.

#### Scenario: Others see the choose countdown
- **GIVEN** the user is Ana
- **WHEN** a `game_state` arrives with Esteban in the `choose` phase and chooseMsLeft 5000
- **THEN** the turn bar shows "Esteban is choosing a U (5.0)"

### Requirement: Timeout notice
On `turn_timed_out`, the client SHALL show "<name> ran out of time", or "You ran out of time" to the player who did, until the next move.

#### Scenario: Notice to the others
- **GIVEN** the user is Esteban
- **WHEN** `turn_timed_out` arrives with player "Ana"
- **THEN** the user sees "Ana ran out of time"

#### Scenario: Notice to the player
- **GIVEN** the user is Ana
- **WHEN** `turn_timed_out` arrives with player "Ana"
- **THEN** the user sees "You ran out of time"
