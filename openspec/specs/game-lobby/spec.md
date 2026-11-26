# game-lobby Specification

## Purpose

Lets a user see every open game other users have created, kept up to date live over the WebSocket connection, so they can find a game before joining one.

## Requirements

### Requirement: Subscribe to the lobby
The system SHALL let a connected client subscribe to the lobby by sending `subscribe_lobby` over `/api/ws`. The system SHALL reply right away with a `games_list` message that contains every game currently in the in-memory list. Subscribing again on the same connection SHALL be harmless and SHALL reply with a fresh `games_list`.

#### Scenario: Snapshot on subscribe
- **GIVEN** games "Partida 1" and "Duel" exist
- **WHEN** a client sends `subscribe_lobby`
- **THEN** the system replies `games_list` containing "Partida 1" and "Duel"

#### Scenario: Empty lobby
- **GIVEN** no games exist
- **WHEN** a client sends `subscribe_lobby`
- **THEN** the system replies `games_list` with an empty list

#### Scenario: Subscribing twice
- **GIVEN** a client has already subscribed
- **WHEN** the client sends `subscribe_lobby` again
- **THEN** the system replies with one `games_list` and the client keeps receiving each later update only once

### Requirement: Game summary in the list
Each game in `games_list` SHALL be described with the same summary fields as `game_created`: `name`, `maxPlayers`, `boardWidth`, `boardHeight`, `players` (each with `name` and `color`) and `status`, which is `waiting` before the game starts and `playing` after. For a game in progress, `players` SHALL list only the players still in it.

#### Scenario: Summary fields
- **GIVEN** "Esteban" created game "Partida 1" with color "red", maxPlayers 2 and board 12 x 10
- **WHEN** a client receives `games_list`
- **THEN** the entry for "Partida 1" has maxPlayers 2, boardWidth 12, boardHeight 10, players `[{name: "Esteban", color: "red"}]` and status `waiting`

#### Scenario: Status of a started game
- **GIVEN** "Duel" has started
- **WHEN** a client receives `games_list`
- **THEN** the entry for "Duel" has status `playing`

### Requirement: Live list updates
The system SHALL send a new full `games_list` to every subscribed connection whenever a game is created, cancelled, removed because its creator disconnected before it started, starts or ends, and whenever a player joins or leaves a game, including by disconnecting and including during play.

#### Scenario: Game created
- **GIVEN** client A is subscribed
- **WHEN** client B creates game "Partida 1"
- **THEN** client A receives a `games_list` containing "Partida 1"

#### Scenario: Game cancelled
- **GIVEN** client A is subscribed and client B owns game "Partida 1"
- **WHEN** client B sends `cancel_game`
- **THEN** client A receives a `games_list` without "Partida 1"

#### Scenario: Creator disconnects
- **GIVEN** client A is subscribed and client B owns game "Partida 1", which has not started
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

#### Scenario: Game starts
- **GIVEN** client A is subscribed and "Duel" has 1 of 2 players
- **WHEN** a second player joins "Duel"
- **THEN** client A receives a `games_list` where "Duel" has status `playing`

#### Scenario: Player leaves during play
- **GIVEN** client A is subscribed and Esteban, Ana and Luis are playing "Partida 1"
- **WHEN** Luis leaves
- **THEN** client A receives a `games_list` where "Partida 1" lists only Esteban and Ana

#### Scenario: Game ends
- **GIVEN** client A is subscribed and "Duel" is in progress
- **WHEN** "Duel" ends
- **THEN** client A receives a `games_list` without "Duel"

### Requirement: Subscription lasts for the connection
A subscription SHALL stay active for the life of the connection, including while that connection owns a game. It SHALL end when the connection closes.

#### Scenario: Creator keeps receiving updates
- **GIVEN** client A is subscribed and has created game "Partida 1"
- **WHEN** client B creates game "Duel"
- **THEN** client A receives a `games_list` containing "Duel" and "Partida 1"

### Requirement: One failed subscriber does not block others
When sending a `games_list` update to one subscriber fails, the system SHALL stop sending to that subscriber and SHALL still deliver the update to every other subscriber.

#### Scenario: A dead subscriber is skipped
- **GIVEN** clients A and C are subscribed and sending to A fails
- **WHEN** a game is created
- **THEN** client C receives the updated `games_list`

### Requirement: Lobby connects when the app loads
The client SHALL open its connection and send `subscribe_lobby` when the app loads. Until the first `games_list` arrives, the lobby SHALL show "Loading games..." and "Create game" SHALL be disabled.

#### Scenario: Loading
- **WHEN** the app loads and no `games_list` has arrived yet
- **THEN** the user sees "Loading games..." and a disabled "Create game" button

#### Scenario: Ready
- **WHEN** the first `games_list` arrives
- **THEN** "Create game" is enabled

### Requirement: Empty lobby message
When the latest `games_list` is empty, the lobby SHALL show "No games yet. Create one!".

#### Scenario: No games
- **WHEN** the client receives an empty `games_list`
- **THEN** the user sees "No games yet. Create one!"

### Requirement: Disconnected lobby with manual retry
When the connection is lost or cannot be opened, the lobby SHALL replace the list with "Can't reach the server." and a "Retry" button, and "Create game" SHALL be disabled. Retry SHALL open a new connection and subscribe again. The client SHALL NOT reconnect automatically.

#### Scenario: Connection lost on the lobby
- **GIVEN** the lobby is showing games
- **WHEN** the connection closes
- **THEN** the user sees "Can't reach the server.", a "Retry" button and a disabled "Create game"

#### Scenario: Connection lost on the form
- **GIVEN** the user is on the create-game form
- **WHEN** the connection closes
- **THEN** the user returns to the lobby in its disconnected state

#### Scenario: Retry succeeds
- **GIVEN** the lobby is disconnected
- **WHEN** the user clicks "Retry" and the new connection receives `games_list`
- **THEN** the list is shown and "Create game" is enabled

#### Scenario: No automatic reconnect
- **GIVEN** the lobby is disconnected
- **WHEN** the user does nothing
- **THEN** the client opens no new connection

### Requirement: Waiting games listed first
The system SHALL list waiting games in `games_list` before games in progress. Within each of those two groups, games SHALL be ordered from most recently created to oldest.

#### Scenario: Order by creation
- **GIVEN** "Partida 1" was created before "Duel" and neither has started
- **WHEN** a client receives `games_list`
- **THEN** "Duel" comes before "Partida 1"

#### Scenario: Games in progress last
- **GIVEN** "Partida 1" was created before "Duel", and "Duel" has started
- **WHEN** a client receives `games_list`
- **THEN** "Partida 1" comes before "Duel"

#### Scenario: Games in progress newest first
- **GIVEN** "Partida 1" was created before "Duel", and both have started
- **WHEN** a client receives `games_list`
- **THEN** "Duel" comes before "Partida 1"

### Requirement: Lobby rows show the game status
The client SHALL show the lobby as its home screen, with a "Create game" button above an "Open games" list. Each row SHALL show the game name, the host's name and color (the first player in `players`), the count as "players / maxPlayers", and the board as "W x H". A waiting game's row SHALL have a "Join" button. A game in progress SHALL show "In progress" and no "Join" button. All UI text SHALL be in English.

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

#### Scenario: Game in progress row
- **WHEN** the client receives `games_list` with "Duel" in status `playing`, hosted by "Esteban" (red), 2 of 2 players, board 8 x 8
- **THEN** the row for "Duel" shows "Duel", "Esteban", "2 / 2", "8 x 8" and "In progress", and has no "Join" button

#### Scenario: Host left a game in progress
- **GIVEN** "Partida 1" is in progress with Esteban (host), Ana and Luis, maxPlayers 3
- **WHEN** Esteban leaves and the client receives the updated `games_list`
- **THEN** the row for "Partida 1" shows "Ana" as host and "2 / 3"

#### Scenario: Join opens the join form
- **WHEN** the user clicks "Join" on the row for "Partida 1"
- **THEN** the join form for "Partida 1" opens and no message is sent to the server
