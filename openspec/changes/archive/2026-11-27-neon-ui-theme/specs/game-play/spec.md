# Spec Delta

## ADDED Requirements

### Requirement: Mark button draws attention
While the "Mark" button is shown, the client SHALL animate it to show that pressing it is the next step. When reduced motion is requested, the button SHALL NOT animate.

#### Scenario: Animated while waiting for confirmation
- **WHEN** the user selects an empty cell with a finger on their turn
- **THEN** the "Mark" button appears with a repeating animation

#### Scenario: Reduced motion
- **GIVEN** reduced motion is requested
- **WHEN** the "Mark" button appears
- **THEN** it does not animate

## MODIFIED Requirements

### Requirement: Propose button
The turn bar SHALL show a "Propose ending (n left)" button, where n is the user's attempts left, except while the "Mark" button is shown. It SHALL be enabled only on the user's own turn, in the `mark` phase, with no vote open and at least 1 attempt left. Pressing it SHALL send `propose_end`.

#### Scenario: Proposing from the turn bar
- **GIVEN** it is the user's turn in the `mark` phase and they have 2 attempts left
- **WHEN** the user presses "Propose ending (2 left)"
- **THEN** the client sends `propose_end`

#### Scenario: Button disabled out of turn
- **GIVEN** it is not the user's turn
- **WHEN** the game screen is shown
- **THEN** the "Propose ending" button is disabled

#### Scenario: Hidden while a cell is selected
- **GIVEN** it is the user's turn
- **WHEN** the user taps an empty cell with a finger
- **THEN** the "Mark" button is shown and the "Propose ending" button is not

#### Scenario: Back when the selection is cleared
- **GIVEN** a cell is selected
- **WHEN** the user taps that cell again
- **THEN** the "Mark" button is gone and the "Propose ending" button is shown
