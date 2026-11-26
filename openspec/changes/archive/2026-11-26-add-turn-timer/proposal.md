# Proposal

## Why

Today a player can think for as long as they like on every turn, so a slow player stalls the whole table and the host has no way to set the pace. Hosts want to choose how fast a game plays, from relaxed to frantic.

## What Changes

- The host picks a timer mode when creating a game: **No timer**, **Slow 60-15**, **Normal 30-10** or **Fast 10-5** (starting seconds - seconds gained per finished turn). `create_game` gets an optional `timer` field (`none`, `slow`, `normal`, `fast`), defaulting to `none`; any other value is rejected with the new error code `invalid_timer`.
- The game summary (`game_created`, `game_joined`, `game_updated`, `games_list`) carries the timer mode, and the lobby rows and both waiting screens show it.
- In a timed game every player has their own clock. It runs only on their turn in the `mark` phase, and every finished turn adds the mode's increment, with no cap.
- When a clock runs out the player loses the turn without marking, gets no increment, their clock resets to the mode's starting value, and the turn passes. Everyone receives a new `turn_timed_out` message and sees a notice.
- When a mark completes several Us, the main clock pauses and a separate choose clock starts, lasting `ceil(increment / 2) * (n - 1)` seconds for `n` candidates. If it runs out the server picks the first candidate. Either way the player scores and gains the increment.
- An end-game vote freezes the proposer's clock; a failed vote resumes it where it was.
- The server waits a hidden 500 ms after any clock reaches 0 before acting, so a move sent just in time still counts.
- `game_started` and `game_state` carry every player's clock and the choose clock; the game screen shows them counting down, with tenths under 10 seconds.
- Games with **No timer** behave exactly as today.

## Capabilities

### New Capabilities
- `turn-timer`: per-player game clocks of a started game — timer modes, how clocks run, pause and freeze, increments, running out of time, the choose clock, the grace window, the clock fields of the game state, and how the clocks and timeout notice are shown.

### Modified Capabilities
- `game-creation`: `create_game` accepts and validates the `timer` field, the summary includes it, the create-game form gets a timer selector, and the host's waiting screen shows the mode.
- `game-joining`: the joining player's waiting room shows the timer mode.
- `game-lobby`: the game summary in `games_list` includes the timer mode and each lobby row shows it.

## Impact

- **Backend**: `app/games/validation.py` (timer rule and `invalid_timer`), `app/games/models.py` (timer mode on `Game`), `app/games/lobby.py` (summary field), `app/games/match.py` (clocks, choose clock, timeout, injected clock already present), `app/games/ws.py` (per-turn timeout tasks, `turn_timed_out` fan-out, grace window), `backend/README.md` (protocol docs).
- **Frontend**: `src/game/validation.ts` (mirror of the timer rule), `src/game/types.ts`, `CreateGameForm`, `HomeScreen`, `WaitingScreen`, `GameScreen` and a new clock-format/countdown helper next to `voteCountdown.ts`.
- **Protocol**: additive — new optional `timer` input field, new summary and game-state fields, new `turn_timed_out` message and `invalid_timer` error code. No breaking change for games without a timer.
- No new dependencies. The server stays a single worker; clocks live in process memory like the rest of the game.
