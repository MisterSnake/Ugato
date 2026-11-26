# game-creation Specification

## Purpose

Lets a user create a game, configured with their temporary identity and the game's settings, and keeps that game alive only while its creator stays connected and has not cancelled it.

## Requirements

### Requirement: Create a game over a live connection
The system SHALL let a user create a game by sending a `create_game` message containing `username`, `color`, `gameName`, `maxPlayers`, `boardWidth` and `boardHeight` over the tab's shared connection to `/api/ws`, without opening a new one. When the input is valid, the system SHALL store the game in memory, register the user as its only player, and reply with a `game_created` message summarizing the game.

#### Scenario: Valid game is created
- **WHEN** a connected client sends `create_game` with username "Esteban", color "red", gameName "Partida 1", maxPlayers 2, boardWidth 12, boardHeight 10
- **THEN** the system replies `game_created` with the game name "Partida 1", maxPlayers 2, board 12 x 10, and a player list containing only "Esteban" with color "red"

#### Scenario: Created game is in the registry
- **WHEN** a game "Partida 1" has been created
- **THEN** the in-memory game list contains "Partida 1" with all of its submitted data

#### Scenario: Creation reuses the lobby connection
- **GIVEN** the client is connected and subscribed to the lobby
- **WHEN** the user submits the create-game form
- **THEN** the `create_game` message is sent over that same connection and no new connection is opened

### Requirement: Username rules
The system SHALL trim surrounding whitespace from the username and SHALL reject it with error code `invalid_username` when the trimmed value is shorter than 3 or longer than 20 characters, or contains non-printable characters. The username exists only for the lifetime of the game.

#### Scenario: Username is trimmed
- **WHEN** a client creates a game with username "  Esteban  "
- **THEN** the game's player is stored as "Esteban"

#### Scenario: Username too short
- **WHEN** a client sends `create_game` with username "Al"
- **THEN** the system replies `error` with field `username` and code `invalid_username`, and no game is created

#### Scenario: Blank username
- **WHEN** a client sends `create_game` with username "   "
- **THEN** the system replies `error` with field `username` and code `invalid_username`

#### Scenario: Username with accented characters
- **WHEN** a client sends `create_game` with username "Ñandú"
- **THEN** the game is created

### Requirement: Player color
The system SHALL require the color to be one of `red`, `blue`, `yellow`, `green`, `orange`, `purple`, and SHALL reject any other value with error code `invalid_color`.

#### Scenario: Allowed color
- **WHEN** a client sends `create_game` with color "purple"
- **THEN** the game is created with the player's color "purple"

#### Scenario: Unknown color
- **WHEN** a client sends `create_game` with color "pink"
- **THEN** the system replies `error` with field `color` and code `invalid_color`

### Requirement: Game name rules
The system SHALL trim surrounding whitespace from the game name and SHALL reject it with error code `invalid_game_name` when the trimmed value is shorter than 3 or longer than 20 characters, or contains non-printable characters.

#### Scenario: Game name too long
- **WHEN** a client sends `create_game` with a 21-character game name
- **THEN** the system replies `error` with field `gameName` and code `invalid_game_name`

#### Scenario: Game name is trimmed
- **WHEN** a client creates a game with game name " Partida 1 "
- **THEN** the game is stored with name "Partida 1"

### Requirement: Game name uniqueness
The system SHALL reject a game name that matches the name of an existing game, ignoring case and surrounding whitespace, with error code `name_taken`.

#### Scenario: Duplicate name
- **GIVEN** a game named "Partida 1" exists
- **WHEN** another client sends `create_game` with game name "Partida 1"
- **THEN** the system replies `error` with field `gameName` and code `name_taken`, and no new game is created

#### Scenario: Duplicate name with different case
- **GIVEN** a game named "Partida 1" exists
- **WHEN** another client sends `create_game` with game name "  partida 1"
- **THEN** the system replies `error` with field `gameName` and code `name_taken`

### Requirement: Maximum players
The system SHALL accept a maximum player count from 2 to 4 inclusive, SHALL default it to 2 when it is omitted, and SHALL reject any other value with error code `invalid_max_players`.

#### Scenario: Default player count
- **WHEN** a client sends `create_game` without `maxPlayers`
- **THEN** the game is created with maxPlayers 2

#### Scenario: Player count out of range
- **WHEN** a client sends `create_game` with maxPlayers 5
- **THEN** the system replies `error` with field `maxPlayers` and code `invalid_max_players`

### Requirement: Board dimensions
The system SHALL accept integer board dimensions where width and height are each between 8 and 30 inclusive and width is greater than or equal to height, and SHALL reject anything else with error code `invalid_board`.

#### Scenario: Smallest board
- **WHEN** a client sends `create_game` with boardWidth 8 and boardHeight 8
- **THEN** the game is created

#### Scenario: Wide board
- **WHEN** a client sends `create_game` with boardWidth 30 and boardHeight 8
- **THEN** the game is created

#### Scenario: Height greater than width
- **WHEN** a client sends `create_game` with boardWidth 8 and boardHeight 30
- **THEN** the system replies `error` with field `board` and code `invalid_board`

#### Scenario: Dimension out of range
- **WHEN** a client sends `create_game` with boardWidth 31 and boardHeight 10
- **THEN** the system replies `error` with field `board` and code `invalid_board`

### Requirement: One game per connection
The system SHALL link the creator's connection to their game and SHALL reject a further `create_game` on that same connection with error code `already_in_game` while the game exists. A connection that is a joined player in a game SHALL also have `create_game` rejected with `already_in_game` until it leaves that game or the game is closed.

#### Scenario: Second create on the same connection
- **GIVEN** a client has created game "Partida 1" on its connection
- **WHEN** the same client sends another `create_game`
- **THEN** the system replies `error` with code `already_in_game`, and "Partida 1" remains the only game for that connection

#### Scenario: Joined player tries to create a game
- **GIVEN** a client has joined game "Partida 1"
- **WHEN** the same client sends a valid `create_game`
- **THEN** the system replies `error` with code `already_in_game` and no game is created

### Requirement: Cancel a game
The system SHALL let the creator cancel their game by sending `cancel_game`. Cancelling SHALL remove the game from the in-memory list, free its name, and confirm with a `game_cancelled` message. Every joined player of the game SHALL receive `game_closed`. The connection SHALL stay open after cancelling, and the client SHALL NOT close it. A `cancel_game` from a connection that does not host a game, including a joined player, SHALL change nothing and SHALL still be confirmed with `game_cancelled`.

#### Scenario: Creator cancels
- **GIVEN** a client has created game "Partida 1"
- **WHEN** the client sends `cancel_game`
- **THEN** the system replies `game_cancelled` and "Partida 1" is no longer in the game list

#### Scenario: Name reusable after cancel
- **GIVEN** game "Partida 1" was cancelled
- **WHEN** another client sends `create_game` with game name "Partida 1"
- **THEN** the game is created

#### Scenario: Connection stays open after cancel
- **GIVEN** a client has created game "Partida 1"
- **WHEN** the client sends `cancel_game`
- **THEN** the connection stays open and the same client can send `create_game` again

#### Scenario: Joined players are told
- **GIVEN** client B has joined "Partida 1" hosted by client A
- **WHEN** client A sends `cancel_game`
- **THEN** client B receives `game_closed`

#### Scenario: Joined player sends cancel_game
- **GIVEN** client B has joined "Partida 1"
- **WHEN** client B sends `cancel_game`
- **THEN** the system replies `game_cancelled`, "Partida 1" still exists, and B is still one of its players

### Requirement: Game ends when the creator disconnects
The system SHALL remove a game and free its name when the creator's connection closes for any reason, including a page refresh, closing the tab, or a network loss. Every joined player of the game SHALL receive `game_closed`.

#### Scenario: Connection closes while waiting
- **GIVEN** a client has created game "Partida 1"
- **WHEN** the client's connection closes
- **THEN** "Partida 1" is no longer in the game list and its name can be used by a new game

#### Scenario: Joined players are told on disconnect
- **GIVEN** client B has joined "Partida 1" hosted by client A
- **WHEN** client A's connection closes
- **THEN** client B receives `game_closed`

### Requirement: Waiting screen locks the user in the game
After a game is created, the client SHALL show a waiting screen with the game name, the player list, the player count as "players / maxPlayers", the board size, and a "Cancel game" action. No other menu SHALL be reachable while the game exists. When the connection is lost or the page is reloaded while a game is waiting, the client SHALL show the lobby with the notice "Connection lost, the game was removed" once. All UI text SHALL be in English.

#### Scenario: Waiting screen shown after creation
- **WHEN** the server replies `game_created` for "Partida 1" by "Esteban" (red) with maxPlayers 2 and board 12 x 10
- **THEN** the user sees "Waiting for players...", "Partida 1", "Esteban (host)", "1 / 2", "12 x 10" and a "Cancel game" button, and no other navigation

#### Scenario: Cancel returns to home
- **GIVEN** the user is on the waiting screen
- **WHEN** the user clicks "Cancel game"
- **THEN** the game is cancelled and the user returns to the lobby, which shows the current list of open games and an enabled "Create game" button, without opening a new connection

#### Scenario: Connection lost while waiting
- **GIVEN** the user is on the waiting screen
- **WHEN** the connection to the server is lost
- **THEN** the user returns to the lobby, sees the notice "Connection lost, the game was removed", and the lobby is in its disconnected state with a "Retry" button

#### Scenario: Page refreshed while waiting
- **GIVEN** the user is on the waiting screen
- **WHEN** the user refreshes the page
- **THEN** the lobby shows the notice "Connection lost, the game was removed"

#### Scenario: Notice is not repeated
- **GIVEN** the user has already seen the notice, or has cancelled the game
- **WHEN** the user refreshes the page
- **THEN** the lobby shows no notice

### Requirement: Create-game form
The client SHALL offer a create-game form, reached from a home screen "Create game" button. The form SHALL have fields for name, the six colors, game name, max players (2 preselected) and board width/height (8 x 8 preselected). It SHALL block submission while client-side rules fail and SHALL show server errors on the matching field.

#### Scenario: Defaults
- **WHEN** the user opens the create-game form
- **THEN** max players shows 2 and the board shows 8 x 8

#### Scenario: Invalid board blocked client-side
- **WHEN** the user enters width 8 and height 12
- **THEN** a board error is shown and the form cannot be submitted

#### Scenario: Server reports name taken
- **WHEN** the server replies `error` with field `gameName` and code `name_taken`
- **THEN** the form stays open and shows an error on the game name field

### Requirement: Host sees the live player list
The host's waiting screen SHALL list every player in the game, each with their color, in join order, with the creator marked "(host)". The list and the player count SHALL update on each `game_updated`.

#### Scenario: Host sees players join live
- **GIVEN** the host is on the waiting screen of "Partida 1" with 1 of 3 players
- **WHEN** a `game_updated` arrives with "Ana" (blue) added
- **THEN** the list shows "Esteban (host)" and "Ana", and the count shows "2 / 3"

#### Scenario: Host sees a player leave
- **GIVEN** the host's waiting screen lists "Esteban (host)" and "Ana"
- **WHEN** a `game_updated` arrives without "Ana"
- **THEN** the list shows only "Esteban (host)" and the count shows "1 / 3"
