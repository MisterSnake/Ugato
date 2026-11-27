# Tasks

Every task that changes behavior or markup is a Red-Green-Refactor cycle:
1. **Red**: write or change the failing test and run the suite to see it fail.
2. **Green**: write the minimal English-named code that makes it pass.
3. **Refactor**: clean up with the suite still green.

Pure styling cannot be tested in jsdom (it does not lay out or paint). Those tasks say so and end with a **visual check** in the browser (`npm run dev` with the backend running) against the mockups in `../interfaces/` instead of an invented test (design decision 13).

Frontend commands run from `frontend/`: after every task, `npm test`, `npm run build` and `npm run lint` must pass. Backend tests run from `backend/` with `./.venv/Scripts/python.exe -m pytest -q`.

## 1. Setup and brand

- [x] 1.1 Add the fonts. Install `@fontsource/lilita-one` and `@fontsource/poppins`, and import Lilita One 400 and Poppins 400/600 in `src/main.tsx`. Scaffolding, no test. Verify: `npm run build` passes and `dist/assets/` contains the `woff2` files; the browser's network tab shows no request to a third-party font host.
- [x] 1.2 Rename the brand to "U Cat".
  - Red: in `GameScreen.test.tsx`, the title checks expect "U Cat" and "Your turn! - U Cat"; in `HomeScreen.test.tsx`, a test expects the heading "U Cat".
  - Green: change the `h1` in `HomeScreen.tsx` and the `document.title` values in `GameScreen.tsx`. Change `<title>` in `index.html` to "U Cat" (not tested, check the tab).
  - Refactor.
  - Verify: tests green; the browser tab says "U Cat".

## 2. Maximum players 5

- [x] 2.1 Backend accepts up to 5 players.
  - Red: in `backend/tests/games/test_validation.py`, a test checks that `maxPlayers` 5 is accepted; the invalid examples that use 5 (the `test_invalid_max_players_is_rejected` parameters and the two error-order cases) use 6 instead. A `create_game` test over the WebSocket creates a game with maxPlayers 5.
  - Green: `MAX_PLAYERS = 5` in `backend/app/games/validation.py`.
  - Refactor.
  - Verify: `./.venv/Scripts/python.exe -m pytest -q` green.
- [x] 2.2 Frontend mirror accepts up to 5 players.
  - Red: in `frontend/src/game/validation.test.ts`, 2 to 5 are accepted and 1, 6, 2.5 and NaN rejected; in `errorMessages.test.ts` (or the form test), the max players error reads "Max players must be between 2 and 5."; in `CreateGameForm.test.tsx`, the max players control offers 5.
  - Green: `MAX_PLAYERS = 5` in `frontend/src/game/validation.ts`.
  - Refactor.
  - Verify: `npm test` green; in the browser, a 5-player game can be created and joined by four more players, each with their own color.

## 3. Theme base

- [x] 3.1 Tokens and base styles (styling only, no test). In `index.css`, replace the light/dark palette with dark-only tokens (design decision 1), set `color-scheme: dark`, the navy page background, Poppins for the body and Lilita One for `h1`/`h2` and buttons, with a text glow on `h1`. Choose `--muted` with at least 4.5:1 contrast on `--surface`. Verify: suite, build and lint green; visual check: every screen is dark with the new fonts, and nothing is unreadable.
- [x] 3.2 Component classes (styling only, no test). Add `.card` (glass surface, gradient border via padding-box/border-box, glow; design decision 2), `.btn` (purple glow), `.btn-danger` (red), `.btn-ghost`, the pill style for `input` and `select`, and a visible `:focus-visible` ring. Make `button` default to the `.btn` look so screens are coherent before their own task. Verify: visual check of the home, create and waiting screens: cards and buttons look like the mockups, and Tab shows a focus ring on every control.
- [x] 3.3 Brighter player colors (styling only, no test). Update the six `.color-*` values (design decision 5) and give yellow a darker tile border. Verify: visual check: lobby swatches, turn bar and scores use the new colors.

## 4. Icons

- [x] 4.1 Inline SVG icons.
  - Red: `src/screens/icons.test.tsx` renders each icon (`GamepadIcon`, `LockIcon`, `PaletteIcon`, `UsersIcon`, `GridIcon`, `ClockIcon`, `UserIcon`) and checks it is an `svg` with `aria-hidden="true"`.
  - Green: `src/screens/icons.tsx` with those components, sized in `em` and using `currentColor` or a gradient (design decision 10).
  - Refactor.
  - Verify: tests green; lint shows no `only-export-components` warning.

## 5. Home screen

- [x] 5.1 Status classes on lobby cards.
  - Red: in `HomeScreen.test.tsx`, a playing game's row has the `playing` class and a waiting one does not; a game with `players.length === maxPlayers` shows its count with the `full` class; the host line has a swatch in the host's color (`.swatch.color-red`). The spec texts ("In progress", "Join", "1 / 2", ...) still pass unchanged.
  - Green: add the classes and the host swatch in `GameRow`, plus `GamepadIcon` / `LockIcon` next to the name and the lock after "In progress".
  - Refactor.
  - Verify: tests green.
- [x] 5.2 Style the home screen (styling only, no test). Logo `h1`, large create button, "Open games" heading with `GridIcon` (uppercase via CSS, the text stays "Open games"), cards for each row (`.card`), red tint for `.playing`, red text for `.full`, a two-column label/value grid. Verify: visual check against the home mockup, with one waiting game and one game in progress.

## 6. Create form

- [x] 6.1 Round color swatches.
  - Red: in `CreateGameForm.test.tsx` and `JoinGameForm.test.tsx`, the color group is found by the name "Choose your color"; `getByRole('radio', { name: 'Red' })` and the other five still work; a disabled color's radio is still disabled (join form).
  - Green: in `ColorField.tsx`, change the legend to "Choose your color" with `PaletteIcon`, visually hide each radio (still focusable) and show a round swatch in its label, with the color name in visually hidden text (design decision 8).
  - Refactor.
  - Verify: tests green; visual check: the selected swatch has a ring, a disabled swatch is faded and crossed out, and keyboard arrows move between swatches with a visible focus ring.
- [x] 6.2 Max players as segment buttons.
  - Red: in `CreateGameForm.test.tsx`, a "Max players" group holds radios "2" to "5" (the range from task 2.2), with "2" checked by default; the tests that used `selectOptions` on max players click the radio instead, and the submitted request has the chosen `maxPlayers`.
  - Green: replace the `<select>` with a `fieldset.segments` of radios, keeping the value as a string in form state; show `UsersIcon` in the checked segment.
  - Refactor.
  - Verify: tests green; visual check: it looks like the mockup's segment bar and works with the keyboard.
- [x] 6.3 Board size stepper.
  - Red: a new `src/screens/Stepper.test.tsx` checks that the "Increase board width" / "Decrease board width" buttons change the value by 1; that the value stays within `BOARD_MIN_SIZE..BOARD_MAX_SIZE` and each button is disabled at its limit; that an empty or non-numeric value steps from `BOARD_MIN_SIZE`; and that typing still works. In `CreateGameForm.test.tsx`, clicking "Increase board height" twice from 8 submits `boardHeight` 10, and a typed out-of-range value still shows the board error.
  - Green: a `Stepper` component wrapping the existing number input, used for width and height in `CreateGameForm` (design decision 8).
  - Refactor.
  - Verify: tests green.
- [x] 6.4 Style the create form (styling only, no test). Card around the form, uppercase labels via CSS (the label text stays, so `getByLabelText` keeps working), `UserIcon` in the name pill, the board-size fieldset with `GridIcon` in its legend, the stepper look, the timer `<select>` in a pill with `ClockIcon` and a custom arrow, and the "Create" button overlapping the bottom edge of the card. Check that field errors never sit under the button. Verify: visual check against the create mockup, including with every field showing an error.

## 7. Join form

- [x] 7.1 Style the join form (styling only, no test; it reuses `ColorField` from 6.1). Card, pill inputs, "Back" as `.btn-ghost`, "Join" as `.btn`. Verify: existing `JoinGameForm` tests green; visual check: it matches the create form's look, with used colors disabled.

## 8. Waiting screen

- [x] 8.1 Ring of U's spinner.
  - Red: `src/screens/USpinner.test.tsx` checks that the spinner is `aria-hidden` and renders its U glyphs; `WaitingScreen.test.tsx` checks that the waiting screen shows it.
  - Green: a `USpinner` component (design decision 11) and its CSS animation, stopped under `prefers-reduced-motion: reduce`.
  - Refactor.
  - Verify: tests green; visual check: it spins, and it stops with reduced motion turned on in the OS or devtools.
- [x] 8.2 Waiting card and danger button.
  - Red: in `WaitingScreen.test.tsx`, each player has a swatch in their color, and the "Cancel game" / "Leave game" button has the `btn-danger` class. The spec texts ("Esteban (host)", "1 / 2", ...) still pass.
  - Green: the card with icon rows (`GamepadIcon` for the game, `UsersIcon`, `GridIcon`, `ClockIcon`), the game name highlighted, swatches in the player list, and the danger class on the button.
  - Refactor.
  - Verify: tests green; visual check against the waiting mockup.

## 9. Game screen

- [x] 9.1 Board tiles (styling only, no test; geometry must not change). Draw each cell as a rounded tile inside its 32px box with a transparent border and `background-clip: padding-box` (design decision 4). Keep the beige empty tile with an inner highlight, bright taken tiles with an inset glow only, stripes in a darker shade for disabled, grayscale for players who left, a white ring with glow for selected/candidate, `brightness` for dimmed, and the existing last-move dot (design decision 6). Do not touch `CELL_SIZE`, `viewport.ts` or tap handling. Verify: existing `GameScreen` and viewport tests green; visual check against the board mockup with all six colors, taken and disabled, plus a selected cell, an offered U and a player who left; taps still hit the right cell at several zoom levels and when rotated.
- [x] 9.2 Phone performance check (manual). On a real phone (or devtools CPU throttling at 4x), play a 30 x 30 board with most cells taken; pinch-zoom and pan. Verify: no visible stutter. If it stays smooth, optionally try a small outer glow on taken tiles and check again; keep it only if it is still smooth. Record the result in the PR description.
  - Result (for the PR description): the user checked a 30 x 30 board in the browser's mobile simulation and reported that it looks good. No outer glow was added. Headless Chrome at 4x CPU throttling: median frame 16.7 ms with old and new styles; 1-2 frames of 50-67 ms per run with the new tiles, none with the old.
- [x] 9.3 Turn frame and turn bar.
  - Red: in `GameScreen.test.tsx`, on the user's turn the board area still has the `my-turn` class inside their color class (this guards the spec's turn border); the "Leave game" button has the `btn-danger` class; "Propose ending" and the zoom buttons have `btn-ghost`.
  - Green: add the button classes; style `.board-area.my-turn` as a rounded glowing frame in `var(--player)` (design decision 7); restyle the turn bar without the tinted band (big glowing "Your turn!", swatch and name), the notice as a glass strip, and the scores row with the running clock bold.
  - Refactor.
  - Verify: tests green; visual check against the board mockup on your turn and on someone else's turn, at narrow and wide window sizes, with the turn bar still visible at every zoom.

- [x] 9.4 Landscape phone layout (styling only, no test; design decision 15). On short landscape screens, move the game controls into a side column so the board takes the full height. Verify: headless Chrome at 568 x 320 to 932 x 430 with a 30 x 30 board: cells are at least 9.9px, portrait and desktop sizes are unchanged, the column scrolls without moving the board, and marking, choosing a U and rotating mid-game work.

- [x] 9.5 "Mark" stands alone and pulses (design decision 16).
  - Red: in `GameScreen.test.tsx`, "Propose ending" is gone once a touch selects a cell; it is back after tapping that cell again, after pressing "Mark", and when the selection can no longer be marked; a mouse click never hides it.
  - Green: render "Propose ending" only while "Mark" is not shown.
  - Refactor.
  - Then the pulse (styling only, no test): animate "Mark" with `transform` and `opacity`, and replace the motion with a still ring under `prefers-reduced-motion: reduce`.
  - Verify: tests green; visual check in portrait at 370px and 320px wide and in landscape: the pulse is not clipped, the board does not resize when "Mark" appears, and nothing moves with reduced motion.

## 10. Winner screen and vote panel

- [x] 10.1 Winner and vote styling.
  - Red: in `WinnerScreen.test.tsx`, each final score has a swatch in the player's color, and the close button has the `btn` class. The existing vote panel tests still pass.
  - Green: winner title in Lilita One with glow, scores in a `.card`, swatches, button class; vote panel as a `.card` with "Yes" as `.btn` and "No" as `.btn-ghost`.
  - Refactor.
  - Verify: tests green; visual check of a win, a draw and an active vote.

## 11. Integration checks

- [x] 11.1 Full flow in two browsers (manual). Create a game, join it from a second browser, play to the end with a timer, propose and vote on ending, then return to the lobby. Verify: every screen uses the theme with no light or unstyled leftovers; no console errors; nothing changes in behavior.
- [x] 11.2 Accessibility pass (manual). Keyboard only: complete create and join, and use every game control, including choosing a U and voting, with the mouse cursor out of the way. Marking a cell is left out: the board has no keyboard input (design, Non-Goals). Check text contrast with devtools. Turn on reduced motion. Verify: every control is reachable with a visible focus ring, text contrast is at least 4.5:1, and the spinner, the "Mark" pulse and the glows do not animate.
  - Result: checked with a script driving two players in headless Chrome with real key events; cells were marked with simulated pointer events. Tab reached the controls with a visible focus ring; arrow keys moved through the color and max players radios (a taken color is skipped); "Previous", "Next", "Confirm", the vote and "Mark" worked from the keyboard. Contrast was computed from page styles instead of read in devtools (disabled controls and icons excluded): lowest 5.12:1. With reduced motion, the spinner and the pulse stopped, and nothing animated on the vote and winner screens. No console errors.
- [x] 11.3 Final run. Verify: `npm test`, `npm run build` and `npm run lint` all pass, the backend suite passes, and `openspec validate neon-ui-theme` passes.
