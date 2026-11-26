## ADDED Requirements

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

## MODIFIED Requirements

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
