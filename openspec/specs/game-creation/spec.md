# game-creation Specification

## Purpose

Lets a user create a game, configured with their temporary identity and the game's settings, and keeps that game alive only while its creator stays connected and has not cancelled it.

## Requirements

### Requirement: Create a game over a live connection
The system SHALL let a user create a game by sending a `create_game` message containing `username`, `color`, `gameName`, `maxPlayers`, `boardWidth`, `boardHeight` and, optionally, `timer` over the tab's shared connection to `/api/ws`, without opening a new one. When the input is valid, the system SHALL store the game in memory, register the user as its only player, and reply with a `game_created` message summarizing the game, including its `timer`.

#### Scenario: Valid game is created
- **WHEN** a connected client sends `create_game` with username "Esteban", color "red", gameName "Partida 1", maxPlayers 2, boardWidth 12, boardHeight 10, timer `normal`
- **THEN** the system replies `game_created` with the game name "Partida 1", maxPlayers 2, board 12 x 10, timer `normal`, and a player list containing only "Esteban" with color "red"

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
The system SHALL accept a maximum player count from 2 to 5 inclusive, SHALL default it to 2 when it is omitted, and SHALL reject any other value with error code `invalid_max_players`.

#### Scenario: Default player count
- **WHEN** a client sends `create_game` without `maxPlayers`
- **THEN** the game is created with maxPlayers 2

#### Scenario: Five players allowed
- **WHEN** a client sends `create_game` with maxPlayers 5
- **THEN** the game is created with maxPlayers 5

#### Scenario: Player count out of range
- **WHEN** a client sends `create_game` with maxPlayers 6
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
The system SHALL link the creator's connection to their game and SHALL reject a further `create_game` on that same connection with error code `already_in_game` while the game exists. A connection that is a joined player in a game SHALL also have `create_game` rejected with `already_in_game` until it leaves that game or the game is closed. A connection that left a started game, or whose game ended, SHALL no longer be in any game.

#### Scenario: Second create on the same connection
- **GIVEN** a client has created game "Partida 1" on its connection
- **WHEN** the same client sends another `create_game`
- **THEN** the system replies `error` with code `already_in_game`, and "Partida 1" remains the only game for that connection

#### Scenario: Joined player tries to create a game
- **GIVEN** a client has joined game "Partida 1"
- **WHEN** the same client sends a valid `create_game`
- **THEN** the system replies `error` with code `already_in_game` and no game is created

#### Scenario: Host creates again after leaving a started game
- **GIVEN** a client created "Partida 1", the game started, and the client sent `leave_game`
- **WHEN** the same client sends a valid `create_game` for "Duel"
- **THEN** "Duel" is created, and "Partida 1" goes on without that client

#### Scenario: Creating again after the game ended
- **GIVEN** a client received `game_over` for "Partida 1"
- **WHEN** the same client sends a valid `create_game`
- **THEN** the game is created

### Requirement: Cancel a game
The system SHALL let the creator cancel their game before it starts by sending `cancel_game`. Cancelling SHALL remove the game from the in-memory list, free its name, and confirm with a `game_cancelled` message. Every joined player of the game SHALL receive `game_closed`. The connection SHALL stay open after cancelling, and the client SHALL NOT close it. A `cancel_game` from a connection that does not host a waiting game, including a joined player, SHALL change nothing and SHALL still be confirmed with `game_cancelled`.

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

#### Scenario: Creator sends cancel_game after the start
- **GIVEN** client A created "Partida 1" and the game has started
- **WHEN** client A sends `cancel_game`
- **THEN** the system replies `game_cancelled`, the game goes on, A is still playing in it, and no player receives `game_closed`

### Requirement: Game ends when the creator disconnects
While a game has not started, the system SHALL remove it and free its name when the creator's connection closes for any reason, including a page refresh, closing the tab, or a network loss. Every joined player of the game SHALL receive `game_closed`. Once the game has started, the creator's connection closing SHALL count as that player leaving the game, and the game SHALL go on.

#### Scenario: Connection closes while waiting
- **GIVEN** a client has created game "Partida 1"
- **WHEN** the client's connection closes
- **THEN** "Partida 1" is no longer in the game list and its name can be used by a new game

#### Scenario: Joined players are told on disconnect
- **GIVEN** client B has joined "Partida 1" hosted by client A
- **WHEN** client A's connection closes
- **THEN** client B receives `game_closed`

#### Scenario: Creator disconnects after the start
- **GIVEN** client A created "Partida 1", and clients B and C are playing it with A
- **WHEN** client A's connection closes
- **THEN** "Partida 1" is still in the game list, B and C receive `game_state` showing A as left, and neither receives `game_closed`

### Requirement: Waiting screen locks the user in the game
After a game is created, the client SHALL show a waiting screen with the game name, the player list, the player count as "players / maxPlayers", the board size, the timer mode, and a "Cancel game" action. No other menu SHALL be reachable while the game exists. When the connection is lost or the page is reloaded while a game is waiting, the client SHALL show the lobby with the notice "Connection lost, the game was removed" once. All UI text SHALL be in English.

#### Scenario: Waiting screen shown after creation
- **WHEN** the server replies `game_created` for "Partida 1" by "Esteban" (red) with maxPlayers 2, board 12 x 10 and timer `normal`
- **THEN** the user sees "Waiting for players...", "Partida 1", "Esteban (host)", "1 / 2", "12 x 10", "Normal 30-10" and a "Cancel game" button, and no other navigation

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
The client SHALL offer a create-game form, reached from a home screen "Create game" button. The form SHALL have fields for name, the six colors, game name, max players (2 preselected), board width/height (8 x 8 preselected) and timer, offering "No timer" (preselected), "Slow 60-15", "Normal 30-10" and "Fast 10-5". It SHALL block submission while client-side rules fail and SHALL show server errors on the matching field.

#### Scenario: Defaults
- **WHEN** the user opens the create-game form
- **THEN** max players shows 2, the board shows 8 x 8 and the timer shows "No timer"

#### Scenario: Timer is sent
- **GIVEN** the rest of the form is valid
- **WHEN** the user selects "Fast 10-5" and submits the form
- **THEN** the client sends `create_game` with timer `fast`

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

### Requirement: Waiting screen gives way to the game screen
When `game_started` arrives while the host is on the waiting screen, the client SHALL replace it with the game screen. The "Cancel game" action SHALL no longer be shown.

#### Scenario: Game starts
- **GIVEN** the host is on the waiting screen of "Partida 1"
- **WHEN** `game_started` arrives
- **THEN** the user sees the game screen and no "Cancel game" button

### Requirement: Cancel that arrives after the start
The server can start a game before it reads the host's `cancel_game`. If `game_started` arrives after the host cancelled, the client SHALL send `leave_game` and keep the user where they are.

#### Scenario: Cancel crosses the start
- **GIVEN** the host clicked "Cancel game" and is on the lobby
- **WHEN** `game_started` arrives for the cancelled game
- **THEN** the client sends `leave_game` once, and the user stays on the lobby with no notice

### Requirement: Timer mode
The system SHALL accept a timer mode of `none`, `slow`, `normal` or `fast`, SHALL default it to `none` when it is omitted, and SHALL reject any other value with error code `invalid_timer`.

#### Scenario: Timer omitted
- **WHEN** a client sends a valid `create_game` without `timer`
- **THEN** the game is created with timer `none`

#### Scenario: Valid timer
- **WHEN** a client sends a valid `create_game` with timer `fast`
- **THEN** the game is created with timer `fast`

#### Scenario: Unknown timer
- **WHEN** a client sends `create_game` with timer `blitz`
- **THEN** the system replies `error` with field `timer` and code `invalid_timer`, and no game is created

### Requirement: Guidance limits the creator lifetime rule to unstarted games
The comment in `game_socket` (`backend/app/games/ws.py`) and the project guide (`CLAUDE.md`) SHALL state that a game depends on its creator's connection only until it starts. After the start the host is an ordinary player, so their leaving or disconnecting SHALL NOT be described as removing the game. The project guide SHALL list the join, playing and finished screens along with the home, form and waiting screens. This corrects outdated documentation and changes no runtime behavior.

#### Scenario: Lifetime rule in the code comment and the project guide
- **WHEN** a developer or agent reads the comment in `game_socket` or the description of `WS /api/ws` in `CLAUDE.md`
- **THEN** the rule that a game lives only as long as its creator's connection is limited to games that have not started

#### Scenario: Screens in the project guide
- **WHEN** a developer or agent reads the description of `frontend/src/App.tsx` in `CLAUDE.md`
- **THEN** it lists the home, form, join, waiting, playing and finished screens
