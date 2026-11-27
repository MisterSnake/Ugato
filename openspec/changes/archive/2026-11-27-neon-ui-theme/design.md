# Design

## Context

See proposal.md for why. Current state that shapes the approach:

- All styling is one plain CSS file, `frontend/src/index.css`, with no framework or CSS modules. Player colors are `.color-<name>` classes that set `--player`, so anything inside them can use `var(--player)`.
- The board (`GameBoard.tsx`) lays cells out at `CELL_SIZE = 32` and zooms and pans the whole grid with one `transform`. `viewport.ts` (fit, zoom, reveal, rotation) and tap handling (`closest('[data-row]')`) assume cells sit exactly 32 layout pixels apart with no gaps. `--hairline` (one screen pixel at the current zoom) is set by the board. `.cell::after` already draws the last-move dot.
- Boards go up to 30 x 30 (`BOARD_MAX_SIZE`), so up to 900 cells are scaled at once.
- Tests query by accessible name: `getByRole('radio', { name: 'Red' })`, `getByRole('group', { name: 'Color' })`, `getByLabelText('Max players')` with `selectOptions`, and `document.title` checks for "Ugato".
- The mockups live outside the repo, in `../interfaces/` (five Gemini-generated images: home, create, waiting, game board). They are a style reference, not pixel specs; some details (host avatar photo, funnel icon, three different heading fonts) are deliberately not copied.

## Goals / Non-Goals

**Goals:**
- One shared set of tokens and component classes that every screen uses, so the screens without mockups (join, winner, vote panel) get the theme for free.
- Keep every accessible name and spec-required text, so behavior tests keep passing unless the test is about something that really changes.
- Keep the board's layout geometry exactly as it is.

**Non-Goals:**
- A light theme or a theme switch.
- A CSS framework, CSS-in-JS or CSS modules.
- Visual regression testing (screenshot diffs). Visual results are checked by hand, in the tasks.
- Player avatars or any new data in the game summary.
- Marking cells with the keyboard. The board only takes mouse, touch and pen input, as it did before this change, so a keyboard-only player cannot take a turn. This is a known limitation, left for a separate change.

## Decisions

### 1. Plain CSS with custom properties, kept in `index.css`

Tokens on `:root` (`--bg`, `--surface`, `--text`, `--text-h`, `--muted`, `--accent`, `--accent-2`, `--danger`, `--glow`, the gradient), then component classes (`.card`, `.btn`, `.btn-danger`, `.btn-ghost`, `.pill`, `.segments`, `.stepper`, ...). The `prefers-color-scheme` block and `color-scheme: light dark` go; `color-scheme: dark` makes native controls (number spinners, the select pop-up, scrollbars) dark too.

*Alternatives:* Tailwind or CSS modules. Rejected: a new build dependency and a rewrite of every class for a small app; the current single file is not yet hard to work with. If it grows past comfort, it can be split into `@import`ed files later without changing classes.

### 2. Gradient border with a padding-box / border-box background

```css
.card {
  border: 2px solid transparent;
  border-radius: 1.5rem;
  background:
    linear-gradient(var(--surface), var(--surface)) padding-box,
    linear-gradient(135deg, var(--accent-2), var(--accent)) border-box;
  box-shadow: 0 0 24px var(--glow);
}
```

*Alternatives:* `border-image` (does not work with `border-radius`), or a masked `::before` (more code, and it takes a pseudo-element). The background trick needs a solid-ish surface color, which the glass look already uses (a translucent tint over the page background).

### 3. Fonts via `@fontsource`

`@fontsource/lilita-one` (400) and `@fontsource/poppins` (400, 600) are imported in `main.tsx`. Vite bundles the `woff2` files, which are served from our own origin. `font-display: swap` (the default in these packages) shows text right away in the fallback font.

*Alternative:* a Google Fonts `<link>`. Rejected: every visitor's browser would call Google, it breaks offline/LAN play, and it adds a render-blocking stylesheet.

### 4. Board tiles drawn inside the 32px cell

Each cell stays a 32 x 32 box. The tile look comes from a transparent border plus `background-clip: padding-box` and `border-radius`, so the gap between tiles is the transparent border and the page shows through. No grid `gap`, no change to `CELL_SIZE`, `viewport.ts` or tap handling. A tap that lands in the visual gap still hits the cell's box, which is more forgiving than today.

The empty tile stays beige (`--empty-cell`), with a subtle inner highlight for the raised look. Taken tiles use `var(--player)`. The existing `::after` last-move dot stays.

*Alternative:* CSS grid `gap`. Rejected: it changes the cell pitch that the viewport math and tap targets depend on.

### 5. Brighter player colors, shared everywhere

The six `.color-*` values become brighter, closer to the mockup (for example blue `#1e9bff`, orange `#ff8a00`). They are used by the board, the swatches, the turn bar and the scores, so everything stays consistent. Yellow must still stand out against beige: it gets a darker tile border, and contrast is checked by eye on the board.

### 6. A cheap glow on the board, real glow elsewhere

Outside the board, glows are normal blurred `box-shadow` / `text-shadow`. On board cells, the glow is an `inset` shadow plus a lighter edge (no outer blur), because 900 cells redrawn on every zoom and pan with blurred outer shadows can stutter on phones. If a phone test of a full 30 x 30 board stays smooth, a small outer glow may be added; if not, it stays inset only.

Cell states:

| State | Today | New |
|---|---|---|
| taken | flat color | bright color, inset glow |
| disabled | black 45deg stripes | stripes kept, as a darker version of the player color |
| left / left-disabled | `opacity: 0.35` | `grayscale` + reduced saturation and slight fade; opacity alone would show the navy background through and look like holes |
| selected / candidate | black + white double ring | white ring with a white glow; it shows on every player color and on beige |
| dimmed | `brightness(0.55)` | unchanged |

### 7. Turn border becomes a glowing frame

`.board-area.my-turn` keeps `border-color: var(--player)` and adds `box-shadow: 0 0 16px var(--player)` plus a rounded radius. This keeps the `game-play` requirement as written. The glow sits on the area, which does not scale, so it costs nothing while zooming.

### 8. Form controls keep native inputs underneath

- **Color swatches:** the radio `input` stays in the DOM, visually hidden but still focusable; the `label` shows a round swatch and keeps the color name as its accessible text (visually hidden). `getByRole('radio', { name: 'Red' })` still works, and so do keyboard arrows. The selected swatch gets a ring; disabled swatches (join form) are faded and crossed out. The legend becomes "Choose your color", so the group's accessible name changes and its tests change with it.
- **Max players:** a `fieldset` with legend "Max players" holding one radio per count from `MIN_PLAYERS` to `MAX_PLAYERS` (2 to 5 after decision 14), styled as segment buttons. `getByRole('radio', { name: '3' })` replaces `selectOptions`. The value stays a string in form state, so validation is unchanged.
- **Board size stepper:** a new `Stepper` component: a decrease button, the existing number input, an increase button. The buttons are labelled "Decrease board width" / "Increase board width" and so on. Clicking them changes the value by 1 within `BOARD_MIN_SIZE..BOARD_MAX_SIZE`; an empty or non-numeric value steps from `BOARD_MIN_SIZE`. Each button is disabled at its limit. Typing still works, and out-of-range typed values still show the existing validation error.
- **Timer:** the native `<select>` is kept (best for accessibility and mobile), wrapped in a pill with a clock icon and a custom arrow (`appearance: none`). Where the browser supports customizable selects (`appearance: base-select`), the open list is themed too; elsewhere it stays the native list, dark through `color-scheme`.

*Alternative:* custom drop-downs and listboxes. Rejected: a lot of ARIA work for no gain.

### 9. Lobby card status

`GameRow`'s `li` gets a `playing` class when `game.status === 'playing'` (red tint, lock icon, "In progress" with a lock), and the count gets a `full` class when `players.length >= maxPlayers` (red text). The host line gets a `.swatch` in the host's color. The text stays as the spec requires.

### 10. Icons as tiny inline SVG components

A single `icons.tsx` exports `GamepadIcon`, `LockIcon`, `PaletteIcon`, `UsersIcon`, `GridIcon`, `ClockIcon`, `UserIcon`, each `aria-hidden` and sized in `em`. No icon library. Emoji are not used because they look very different across Windows, Android and iOS. Since `react/only-export-components` only warns for files that also export non-components, a file with only components is fine.

### 11. U ring spinner

A `USpinner` component renders about 16 "U" glyphs placed around a circle with CSS `rotate()` and a gradient color, and the ring rotates slowly. It is `aria-hidden`; the heading "Waiting for players..." already says what is going on. `@media (prefers-reduced-motion: reduce)` stops the animation.

### 12. Brand

"U Cat" in `HomeScreen`'s `h1`, `index.html`'s `<title>`, and the `document.title` values in `GameScreen` ("U Cat" and "Your turn! - U Cat"). The logo is the `h1` in Lilita One with a text glow. Repo, package and backend names stay "Ugato".

### 13. How TDD applies

Behavior gets a failing test first: the title strings, swatch accessible names and legend, the max players radios, the stepper (step, clamp, disabled at limits, empty value), hiding "Propose ending" while "Mark" is shown, and the lobby card `playing` / `full` classes. Pure styling has no meaningful unit test in jsdom (it does not lay out or paint), so those tasks end with an explicit visual check in the browser against the mockups instead of an invented test. The whole suite (`npm test`), `npm run build` and `npm run lint` must stay green after every task.

### 14. Maximum players 5, server and mirror together

`MAX_PLAYERS` goes from 4 to 5 in `backend/app/games/validation.py` and in its mirror `frontend/src/game/validation.ts`, in the same task group, as `CLAUDE.md` asks. Nothing else hardcodes 4: the error message (`errorMessages.ts`) and the segment buttons read the constant, and joining already compares against each game's own `maxPlayers`. Six colors leave a free color for a fifth player. This step comes before the theme work, so the segment bar is built against the final range.

*Alternative:* keep 4 and show three segments. Rejected: the mockup and the user want 5.

### 15. Side column on short landscape screens

Stacked around the board, the turn bar, zoom buttons, scores and "Leave game" leave a phone on its side only a thin strip for the board (about 4px per cell on a 30 x 30 board at 844 x 390). Under `(orientation: landscape) and (max-height: 500px)`, those controls move to a 15rem column on the right and the board takes the full height. The board area is `position: fixed`, so only the column scrolls when a vote and notices do not fit. It is CSS only: the markup, `CELL_SIZE`, `viewport.ts` and tap handling are unchanged.


### 16. "Mark" stands alone and pulses

"Propose ending" is not rendered while "Mark" is shown. On a phone the two sat side by side, so a tap meant for "Mark" could open a vote. It returns when the selection goes away, so a player who wants to propose with a cell selected taps that cell again first. Mouse play never shows "Mark" and does not change.

"Mark" has a slow, repeating pulse: a slight growth and a ring that expands and fades. Only `transform` and `opacity` are animated, which are cheap to redraw. Under `prefers-reduced-motion: reduce` nothing moves, and a still ring keeps the button standing out.

*Alternative:* disable "Propose ending" instead of hiding it. Rejected: it would still take the space next to "Mark".

## Risks / Trade-offs

- [Board rendering cost on large boards] → inset-only glow on cells (decision 6) and a hand test on a phone with a full 30 x 30 board, zoomed and panned, before considering an outer glow.
- [Yellow and orange tiles are hard to tell apart on beige] → darker tile border for yellow, and a side-by-side check of all six colors, including in hatched (disabled) form.
- [Contrast of muted gray text on navy] → `--muted` chosen for at least 4.5:1 against `--surface`.
- [Glow and gradients look washed out on low-end screens] → the gradient border and solid colors carry the look on their own; glow is decoration only.
- [Visually hidden radios lose their focus ring] → `:focus-visible` on the input styles the swatch / segment next to it with a clear ring.
- [Font flash on first load] → `font-display: swap`; Lilita One is small, and the fallback stack (`system-ui`, bold) is similar enough.
- [The dark-only theme ignores users who prefer light] → accepted; it is the game's identity, and the mockups are dark only.

- [A 5-player game on an 8 x 8 board is crowded] → accepted; the host chooses the board size, and it stays playable.

## Migration Plan

No data or protocol changes; the only backend change is the wider player limit, and games live in memory, so nothing needs migrating. It ships in one deployment; rollback is reverting the commit(s). The work can land screen by screen, because the theme base makes unfinished screens look coherent.
