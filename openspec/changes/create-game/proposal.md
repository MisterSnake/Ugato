# Proposal

## Why

Ugato has no gameplay yet. The backend exposes only a health check, and the frontend is still the Vite starter page. The first vertical slice from Jira lets a user create a game, wait in a locked waiting screen, and cancel it. That gives later stories, like joining and starting a game, a game registry and a live connection to build on.

## What Changes

- New WebSocket endpoint `WS /api/ws`. A user creates a game by sending a `create_game` message containing a username, a color, a game name, a maximum player count, and board dimensions.
- Server-side validation:
  - Names are trimmed, required, and 3–20 printable characters long.
  - Game names are unique, ignoring case.
  - The color must be one of `red`, `blue`, `yellow`, `green`, `orange`, `purple`.
  - Max players must be between 2 and 4.
  - Board width and height must each be between 8 and 30, with width ≥ height.
- Created games are kept in an in-memory registry on the server. There is no database.
- A game exists only while its creator's WebSocket is open. Explicit cancellation or a lost connection (refresh, tab close, network drop) removes the game and frees its name.
- New frontend flow, with all UI text in English:
  - Home screen with a "Create game" button.
  - Create-game form with client-side validation.
  - Waiting screen that shows the game summary and a "Cancel game" button, and blocks access to the rest of the app.
  - "Connection lost" notice when the socket drops.
- Tooling:
  - `uvicorn[standard]`, so the real server can accept WebSocket connections.
  - Vite proxy for `/api` with WebSocket support.
  - Vitest + React Testing Library + jsdom for frontend TDD.

## Capabilities

### New Capabilities
- `game-creation`: creating a game (input rules and name uniqueness), the creator's waiting state, and the game's lifetime tied to the creator's connection (cancel, disconnect, name release).

### Modified Capabilities
- None.

## Impact

- **Backend**:
  - New WebSocket route and game registry module under `backend/app/`.
  - `pyproject.toml` switches the dependency to `uvicorn[standard]`.
  - The server must run as a single worker, because the registry is process memory.
- **Frontend**:
  - `App.tsx` is replaced by the new screens.
  - New `gameSocket.ts` client.
  - `vite.config.ts` gains the `/api` proxy (`ws: true`) and the Vitest config.
  - New dev dependencies (`vitest`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `jsdom`) and a `test` script.
- **APIs**: first real API surface. It is a WebSocket message protocol, not REST.
- **Out of scope**:
  - Joining a game.
  - Listing games.
  - Starting a game.
  - Username uniqueness within a game.
  - Running on multiple workers or servers.
