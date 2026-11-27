# Spec Delta

## MODIFIED Requirements

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
