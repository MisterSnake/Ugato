## MODIFIED Requirements

### Requirement: Player waiting room
After `game_joined`, the client SHALL show a waiting room with "Waiting for players...", the game name, the player list (each name with its color, the host marked "(host)"), the count as "players / maxPlayers", the board size, the timer mode and a "Leave game" button. It SHALL update on each `game_updated`. When `game_started` arrives, it SHALL be replaced by the game screen. No other menu SHALL be reachable while in the game.

#### Scenario: Waiting room after joining
- **WHEN** the server replies `game_joined` for "Partida 1" with players "Esteban" (red) and "Ana" (blue), maxPlayers 3, board 12 x 10, timer `slow`
- **THEN** the user sees "Waiting for players...", "Partida 1", "Esteban (host)", "Ana", "2 / 3", "12 x 10", "Slow 60-15" and a "Leave game" button

#### Scenario: Untimed game in the waiting room
- **WHEN** the server replies `game_joined` for a game with timer `none`
- **THEN** the waiting room shows "No timer"

#### Scenario: Roster updates live
- **GIVEN** the user is in the waiting room of "Partida 1" with 2 of 4 players
- **WHEN** a `game_updated` arrives with 3 players
- **THEN** the list shows the new player and the count shows "3 / 4"

#### Scenario: Leave returns to the lobby
- **WHEN** the user clicks "Leave game"
- **THEN** the client sends `leave_game`, and the user returns to the lobby with no notice and without opening a new connection

#### Scenario: Joining the last seat starts the game
- **WHEN** the server replies `game_joined` and then `game_started`
- **THEN** the user sees the game screen
