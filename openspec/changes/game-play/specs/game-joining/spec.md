# Spec Delta

## ADDED Requirements

### Requirement: Started game cannot be joined
The system SHALL reject a `join_game` for a game that has started with error code `game_in_progress` and field `gameName`.

#### Scenario: Join a game in progress
- **GIVEN** "Duel" has started
- **WHEN** a client sends `join_game` for "Duel"
- **THEN** the system replies `error` with field `gameName` and code `game_in_progress`, and the game's players do not change

## MODIFIED Requirements

### Requirement: Join error order
When a `join_game` breaks several rules, the system SHALL report only the first one, in this order: `already_in_game`, `invalid_username`, `invalid_color`, `game_not_found`, `game_in_progress`, `game_full`, `username_taken`, `color_taken`. Checking the rules and adding the player SHALL happen as one atomic step, so two concurrent requests can never both take the same name, color or last seat.

#### Scenario: Name and color both taken
- **GIVEN** "Esteban" plays "Partida 1" with color "red" and the game has room
- **WHEN** a client sends `join_game` for "Partida 1" with username "Esteban" and color "red"
- **THEN** the system replies `error` with code `username_taken` only

#### Scenario: Invalid username in an unknown game
- **WHEN** a client sends `join_game` with username "Al" and gameName "Ghost"
- **THEN** the system replies `error` with code `invalid_username`

#### Scenario: Started game reported before name clashes
- **GIVEN** "Duel" has started and "Esteban" plays it
- **WHEN** a client sends `join_game` for "Duel" with username "Esteban"
- **THEN** the system replies `error` with code `game_in_progress` only

### Requirement: Roster updates to everyone in the game
Whenever a player joins or leaves a game that has not started, the system SHALL send `game_updated` with the full game summary to every other connection in that game, host included. The connection that joined receives `game_joined` instead, and the one that left receives `game_left` instead. Once the game has started, players who leave are reported with `game_state` instead.

#### Scenario: Host sees a new player
- **GIVEN** client A hosts "Partida 1" with maxPlayers 3
- **WHEN** client B joins "Partida 1" as "Ana"
- **THEN** client A receives `game_updated` with players "Esteban" and "Ana"

#### Scenario: Players see someone leave
- **GIVEN** client A hosts "Partida 1", and clients B and C have joined it
- **WHEN** client C leaves
- **THEN** clients A and B each receive `game_updated` without C's player

#### Scenario: Rejected join sends no update
- **GIVEN** client A hosts "Partida 1"
- **WHEN** client B sends a `join_game` for "Partida 1" that is rejected
- **THEN** client A receives no `game_updated`

#### Scenario: Leaving a started game sends no roster update
- **GIVEN** clients A, B and C are playing "Partida 1"
- **WHEN** client C leaves
- **THEN** clients A and B receive `game_state` and no `game_updated`

### Requirement: Leave a game
The system SHALL let a joined player leave a game that has not started by sending `leave_game`. Leaving SHALL remove the player from the game, free their name and color in it, and confirm with `game_left`. The connection SHALL stay open. A `leave_game` from a connection that is not in a game, or from the host of a game that has not started, SHALL change nothing and SHALL still be confirmed with `game_left`. Leaving a started game follows the game-play rules.

#### Scenario: Player leaves
- **GIVEN** "Ana" (blue) has joined "Partida 1"
- **WHEN** her client sends `leave_game`
- **THEN** the system replies `game_left` and "Partida 1" no longer lists "Ana"

#### Scenario: Name and color reusable after leaving
- **GIVEN** "Ana" (blue) has left "Partida 1"
- **WHEN** another client joins "Partida 1" as "Ana" with color "blue"
- **THEN** the client joins

#### Scenario: Host sends leave_game
- **GIVEN** a client hosts "Partida 1", which has not started
- **WHEN** the client sends `leave_game`
- **THEN** the system replies `game_left` and "Partida 1" still exists with the host in it

#### Scenario: Can join again after leaving
- **GIVEN** a client has left "Partida 1"
- **WHEN** the same client sends a valid `join_game`
- **THEN** the client joins

### Requirement: Player removed when their connection closes
The system SHALL remove a joined player from a game that has not started, freeing their name and color, when their connection closes for any reason, and SHALL send `game_updated` to the connections still in the game. When the game has started, the connection closing SHALL count as that player leaving it, following the game-play rules.

#### Scenario: Player disconnects
- **GIVEN** "Ana" has joined "Partida 1" hosted by client A
- **WHEN** Ana's connection closes
- **THEN** "Partida 1" no longer lists "Ana" and client A receives `game_updated`

#### Scenario: Player disconnects during play
- **GIVEN** "Ana" is playing "Partida 1" with Esteban and Luis
- **WHEN** Ana's connection closes
- **THEN** Esteban and Luis receive `game_state` showing Ana as left

### Requirement: Game closed for joined players when the host leaves
When the host cancels a game that has not started, or their connection closes before it starts, the system SHALL send `game_closed` to every joined player of that game. Those connections SHALL stay open, and they SHALL no longer be in any game. Once the game has started, the host leaving SHALL NOT close it.

#### Scenario: Host cancels
- **GIVEN** client B has joined "Partida 1" hosted by client A
- **WHEN** client A sends `cancel_game`
- **THEN** client B receives `game_closed` and can then send `join_game` or `create_game`

#### Scenario: Host disconnects
- **GIVEN** client B has joined "Partida 1" hosted by client A
- **WHEN** client A's connection closes
- **THEN** client B receives `game_closed`

#### Scenario: Host disconnects during play
- **GIVEN** clients A, B and C are playing "Partida 1", which client A created
- **WHEN** client A's connection closes
- **THEN** clients B and C do not receive `game_closed` and keep playing

### Requirement: Join form follows the lobby live
The join form SHALL keep following lobby updates. When a color becomes used, it SHALL be disabled, and unselected if it was chosen. When the game starts, or the server replies `game_in_progress`, the user SHALL return to the lobby with the notice "That game has already started". When the server replies `game_full`, the notice SHALL be "That game is full". When the game disappears, or the server replies `game_not_found`, the notice SHALL be "That game is no longer available".

#### Scenario: Chosen color taken meanwhile
- **GIVEN** the user is on the join form for "Partida 1" with "blue" selected
- **WHEN** a `games_list` arrives where "Partida 1" has a player with color "blue"
- **THEN** "blue" is disabled and no color is selected

#### Scenario: Game fills while on the form
- **GIVEN** the user is on the join form for "Duel"
- **WHEN** a `games_list` arrives where "Duel" is full and therefore in progress
- **THEN** the user is on the lobby and sees "That game has already started"

#### Scenario: Server reports the game in progress
- **GIVEN** the user is on the join form for "Duel"
- **WHEN** the server replies `error` with code `game_in_progress`
- **THEN** the user is on the lobby and sees "That game has already started"

#### Scenario: Game disappears while on the form
- **GIVEN** the user is on the join form for "Partida 1"
- **WHEN** a `games_list` arrives without "Partida 1"
- **THEN** the user is on the lobby and sees "That game is no longer available"

#### Scenario: Connection lost on the join form
- **GIVEN** the user is on the join form
- **WHEN** the connection closes
- **THEN** the user returns to the lobby in its disconnected state

### Requirement: Player waiting room
After `game_joined`, the client SHALL show a waiting room with "Waiting for players...", the game name, the player list (each name with its color, the host marked "(host)"), the count as "players / maxPlayers", the board size and a "Leave game" button. It SHALL update on each `game_updated`. When `game_started` arrives, it SHALL be replaced by the game screen. No other menu SHALL be reachable while in the game.

#### Scenario: Waiting room after joining
- **WHEN** the server replies `game_joined` for "Partida 1" with players "Esteban" (red) and "Ana" (blue), maxPlayers 3, board 12 x 10
- **THEN** the user sees "Waiting for players...", "Partida 1", "Esteban (host)", "Ana", "2 / 3", "12 x 10" and a "Leave game" button

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
