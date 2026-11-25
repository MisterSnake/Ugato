# Spec Delta

## MODIFIED Requirements

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

### Requirement: Cancel a game
The system SHALL let the creator cancel their game by sending `cancel_game`. Cancelling SHALL remove the game from the in-memory list, free its name, and confirm with a `game_cancelled` message. The connection SHALL stay open after cancelling, and the client SHALL NOT close it.

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

### Requirement: Waiting screen locks the user in the game
After a game is created, the client SHALL show a waiting screen with the game name, the creator's name and color, the player count as "1 / maxPlayers", the board size, and a "Cancel game" action. No other menu SHALL be reachable while the game exists. When the connection is lost or the page is reloaded while a game is waiting, the client SHALL show the lobby with the notice "Connection lost, the game was removed" once. All UI text SHALL be in English.

#### Scenario: Waiting screen shown after creation
- **WHEN** the server replies `game_created` for "Partida 1" with maxPlayers 2 and board 12 x 10
- **THEN** the user sees "Waiting for players...", "Partida 1", "1 / 2", "12 x 10" and a "Cancel game" button, and no other navigation

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
