# Proposal

## Why

The client still looks like the Vite starter: a light/dark default palette, system fonts and bare native controls. We have mockups for a dark neon look (glass cards, gradient borders, glowing buttons, a tiled board) and want the whole app to match them, under the name "U Cat", before more screens pile up on the old style. The create-game mockup also offers games of up to 5 players, one more than today's limit of 4.

## What Changes

- Maximum players raised from 4 to 5, on the server and in the client's mirrored validation. Six colors still leave a free color for every player.
- New visual theme for the whole client, dark only: color tokens, glass cards with a cyan-to-purple gradient border and glow, glowing primary buttons, a red "danger" button, pill-shaped inputs.
- Self-hosted fonts: Lilita One for headings and buttons, Poppins for body text (`@fontsource` packages, no requests to third-party servers).
- Brand renamed from "Ugato" to "U Cat" in the home heading, the browser tab title and the turn title (`Your turn! - U Cat`).
- Home: each open game is a glass card; a game in progress gets a red-tinted, locked card; a full player count is shown in red; the host has a dot in their color.
- Create and join forms: round color swatches (still radio buttons underneath), max players as segment buttons instead of a drop-down, board width/height with step buttons, timer drop-down styled as a pill with a clock icon.
- Waiting screen: rows with icons, a spinning ring of U's (still when reduced motion is requested), danger-style "Cancel game" / "Leave game".
- Game screen: the beige board is kept but drawn as rounded tiles; taken cells get brighter player colors and a light glow; the turn border around the board becomes a glowing frame in the player's color; glass notice strip, ghost zoom buttons, danger-style "Leave game".
- Game screen, touch confirmation: "Propose ending" is hidden while "Mark" is shown, so it cannot be pressed by accident, and "Mark" pulses to show it is the next step (still when reduced motion is requested).
- Landscape phones: on short landscape screens the game controls move to a side column, so the board takes the full height.
- Winner screen and vote panel reuse the same cards, buttons and fonts.
- Icons are inline SVG, not emoji.

Apart from the player limit and the two "Mark" button changes, no behavior changes, and no message or validation changes besides the limit. Every text the specs require stays in the page; only its styling changes (for example, uppercase via CSS).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `game-creation`: the "Maximum players" requirement accepts 2 to 5 instead of 2 to 4.
- `game-play`: "Propose button" hides "Propose ending" while "Mark" is shown, and a new requirement makes "Mark" draw attention with an animation.

Everything else is visual: all other requirements in `game-creation`, `game-joining`, `game-lobby`, `game-play` and `turn-timer` still hold as written, including the board border in the current player's color on their turn.

## Impact

- `frontend/src/index.css`: mostly rewritten (tokens, components, board cells).
- `frontend/src/screens/*`: markup changes in `HomeScreen`, `CreateGameForm`, `ColorField`, `JoinGameForm`, `WaitingScreen`, `GameScreen`, `GameBoard` (classes only), `WinnerScreen`, `VotePanel`; new small presentational components (icons, stepper, segment buttons, spinner).
- `frontend/src/screens/*.test.tsx`: the tests for the title, the color legend and the max players control change, and `GameScreen` gets tests for hiding "Propose ending".
- `GameScreen` also changes behavior: it does not render "Propose ending" while "Mark" is shown.
- `frontend/src/App.tsx` passes the players to `WinnerScreen` for its color swatches; `PlayerClock` marks the running clock with a class.
- `frontend/index.html`: tab title.
- `frontend/package.json`: new dependencies `@fontsource/lilita-one` and `@fontsource/poppins`.
- `frontend/src/game/validation.ts` and its tests: `MAX_PLAYERS` becomes 5 (the error message and the segment buttons follow it).
- Backend: `app/games/validation.py` (`MAX_PLAYERS` becomes 5) and `tests/games/test_validation.py`, whose invalid examples use 5 today. No message or protocol changes.
