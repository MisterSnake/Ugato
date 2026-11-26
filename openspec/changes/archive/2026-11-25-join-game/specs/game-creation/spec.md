# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
