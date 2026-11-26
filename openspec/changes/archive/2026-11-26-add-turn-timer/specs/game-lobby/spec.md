## MODIFIED Requirements

### Requirement: Game summary in the list
Each game in `games_list` SHALL be described with the same summary fields as `game_created`: `name`, `maxPlayers`, `boardWidth`, `boardHeight`, `timer`, `players` (each with `name` and `color`) and `status`, which is `waiting` before the game starts and `playing` after. For a game in progress, `players` SHALL list only the players still in it.

#### Scenario: Summary fields
- **GIVEN** "Esteban" created game "Partida 1" with color "red", maxPlayers 2, board 12 x 10 and timer `normal`
- **WHEN** a client receives `games_list`
- **THEN** the entry for "Partida 1" has maxPlayers 2, boardWidth 12, boardHeight 10, timer `normal`, players `[{name: "Esteban", color: "red"}]` and status `waiting`

#### Scenario: Status of a started game
- **GIVEN** "Duel" has started
- **WHEN** a client receives `games_list`
- **THEN** the entry for "Duel" has status `playing`

### Requirement: Lobby rows show the game status
The client SHALL show the lobby as its home screen, with a "Create game" button above an "Open games" list. Each row SHALL show the game name, the host's name and color (the first player in `players`), the count as "players / maxPlayers", the board as "W x H", and the timer mode as "No timer", "Slow 60-15", "Normal 30-10" or "Fast 10-5". A waiting game's row SHALL have a "Join" button. A game in progress SHALL show "In progress" and no "Join" button. All UI text SHALL be in English.

#### Scenario: Games are listed
- **GIVEN** the lobby is connected
- **WHEN** the client receives `games_list` with "Partida 1" hosted by "Esteban" (red), 1 of 2 players, board 12 x 10, timer `fast`
- **THEN** the user sees "Create game" above the "Open games" list, and a row with "Partida 1", "Esteban", "1 / 2", "12 x 10", "Fast 10-5" and a "Join" button

#### Scenario: List updates live
- **GIVEN** the lobby shows "Partida 1"
- **WHEN** the client receives a `games_list` without "Partida 1"
- **THEN** the row for "Partida 1" disappears without any user action

#### Scenario: Rows are not interactive
- **WHEN** the user clicks a game row anywhere outside its "Join" button
- **THEN** nothing happens and the user stays on the lobby

#### Scenario: Game in progress row
- **WHEN** the client receives `games_list` with "Duel" in status `playing`, hosted by "Esteban" (red), 2 of 2 players, board 8 x 8, timer `none`
- **THEN** the row for "Duel" shows "Duel", "Esteban", "2 / 2", "8 x 8", "No timer" and "In progress", and has no "Join" button

#### Scenario: Host left a game in progress
- **GIVEN** "Partida 1" is in progress with Esteban (host), Ana and Luis, maxPlayers 3
- **WHEN** Esteban leaves and the client receives the updated `games_list`
- **THEN** the row for "Partida 1" shows "Ana" as host and "2 / 3"

#### Scenario: Join opens the join form
- **WHEN** the user clicks "Join" on the row for "Partida 1"
- **THEN** the join form for "Partida 1" opens and no message is sent to the server
