# Spec Delta

## ADDED Requirements

### Requirement: Waiting screen gives way to the game screen
When `game_started` arrives while the host is on the waiting screen, the client SHALL replace it with the game screen. The "Cancel game" action SHALL no longer be shown.

#### Scenario: Game starts
- **GIVEN** the host is on the waiting screen of "Partida 1"
- **WHEN** `game_started` arrives
- **THEN** the user sees the game screen and no "Cancel game" button

## MODIFIED Requirements

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
