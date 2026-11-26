# Spec Delta

## MODIFIED Requirements

### Requirement: Newest games first
The system SHALL list games in `games_list` that still have room before full games, where a full game is one whose player count equals its `maxPlayers`. Within each of those two groups, games SHALL be ordered from most recently created to oldest. A full game that loses a player SHALL return to its creation-order place among the games with room.

#### Scenario: Order by creation
- **GIVEN** "Partida 1" was created before "Duel" and neither is full
- **WHEN** a client receives `games_list`
- **THEN** "Duel" comes before "Partida 1"

#### Scenario: Full games last
- **GIVEN** "Partida 1" was created before "Duel", and "Duel" is full
- **WHEN** a client receives `games_list`
- **THEN** "Partida 1" comes before "Duel"

#### Scenario: Full games newest first
- **GIVEN** "Partida 1" was created before "Duel", and both are full
- **WHEN** a client receives `games_list`
- **THEN** "Duel" comes before "Partida 1"

#### Scenario: Game with room again
- **GIVEN** "Partida 1" was created before "Duel", "Duel" is full and listed last
- **WHEN** a player leaves "Duel"
- **THEN** the next `games_list` lists "Duel" before "Partida 1"

### Requirement: Live list updates
The system SHALL send a new full `games_list` to every subscribed connection whenever a game is created, cancelled, or removed because its creator disconnected, and whenever a player joins or leaves a game, including by disconnecting.

#### Scenario: Game created
- **GIVEN** client A is subscribed
- **WHEN** client B creates game "Partida 1"
- **THEN** client A receives a `games_list` containing "Partida 1"

#### Scenario: Game cancelled
- **GIVEN** client A is subscribed and client B owns game "Partida 1"
- **WHEN** client B sends `cancel_game`
- **THEN** client A receives a `games_list` without "Partida 1"

#### Scenario: Creator disconnects
- **GIVEN** client A is subscribed and client B owns game "Partida 1"
- **WHEN** client B's connection closes
- **THEN** client A receives a `games_list` without "Partida 1"

#### Scenario: Rejected creation sends no update
- **GIVEN** client A is subscribed
- **WHEN** client B sends an invalid `create_game`
- **THEN** client A receives no new `games_list`

#### Scenario: Player joins
- **GIVEN** client A is subscribed and "Partida 1" has 1 of 3 players
- **WHEN** client C joins "Partida 1"
- **THEN** client A receives a `games_list` where "Partida 1" has 2 players

#### Scenario: Player leaves or disconnects
- **GIVEN** client A is subscribed and client C has joined "Partida 1"
- **WHEN** client C sends `leave_game` or its connection closes
- **THEN** client A receives a `games_list` where "Partida 1" no longer lists C's player

#### Scenario: Rejected join sends no update
- **GIVEN** client A is subscribed
- **WHEN** client C sends a `join_game` that is rejected
- **THEN** client A receives no new `games_list`

### Requirement: Lobby screen layout
The client SHALL show the lobby as its home screen. It SHALL have a "Create game" button at the top, above an "Open games" list. Each row SHALL show the game name, the host's name and color, the player count as "players / maxPlayers", and the board as "W x H". A row for a game with room SHALL have a "Join" button. A row for a full game SHALL show "Full" and no "Join" button. All UI text SHALL be in English.

#### Scenario: Games are listed
- **GIVEN** the lobby is connected
- **WHEN** the client receives `games_list` with "Partida 1" hosted by "Esteban" (red), 1 of 2 players, board 12 x 10
- **THEN** the user sees "Create game" above the "Open games" list, and a row with "Partida 1", "Esteban", "1 / 2", "12 x 10" and a "Join" button

#### Scenario: List updates live
- **GIVEN** the lobby shows "Partida 1"
- **WHEN** the client receives a `games_list` without "Partida 1"
- **THEN** the row for "Partida 1" disappears without any user action

#### Scenario: Rows are not interactive
- **WHEN** the user clicks a game row anywhere outside its "Join" button
- **THEN** nothing happens and the user stays on the lobby

#### Scenario: Full game row
- **WHEN** the client receives `games_list` with "Duel" at 2 of 2 players
- **THEN** the row for "Duel" shows "Full" and has no "Join" button

#### Scenario: Join opens the join form
- **WHEN** the user clicks "Join" on the row for "Partida 1"
- **THEN** the join form for "Partida 1" opens and no message is sent to the server
