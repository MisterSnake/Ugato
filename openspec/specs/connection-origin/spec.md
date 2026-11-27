# connection-origin Specification

## Purpose

Controls which web origins may use the backend, so that only the game's own frontend can open WebSocket connections and make cross-origin HTTP calls from a browser.

## Requirements

### Requirement: Configured allowed origins
The backend SHALL read its allowed origins from configuration as a comma-separated list of origins (scheme, host and optional port). When none are configured, the allowed origins SHALL be `http://localhost:5173` only.

#### Scenario: Configured list
- **GIVEN** the allowed origins are configured as `https://a.example,https://b.example`
- **WHEN** the backend starts
- **THEN** both `https://a.example` and `https://b.example` are allowed, and `http://localhost:5173` is not

#### Scenario: Default for local development
- **GIVEN** no allowed origins are configured
- **WHEN** the backend starts
- **THEN** only `http://localhost:5173` is allowed

### Requirement: WebSocket handshake rejects foreign origins
When a client opens `/api/ws` with an `Origin` header that is not an allowed origin, the backend SHALL reject the handshake without accepting the connection. No game message SHALL be exchanged on it.

#### Scenario: Foreign origin
- **GIVEN** the allowed origins are `https://game.example`
- **WHEN** a client opens `/api/ws` with `Origin: https://evil.example`
- **THEN** the handshake is rejected and the connection is never accepted

#### Scenario: Allowed origin
- **GIVEN** the allowed origins are `https://game.example`
- **WHEN** a client opens `/api/ws` with `Origin: https://game.example`
- **THEN** the connection is accepted and works as before

### Requirement: Clients without an Origin header
When a client opens `/api/ws` without an `Origin` header, the backend SHALL accept the connection. Browsers always send `Origin` on WebSocket handshakes, so this only concerns non-browser clients, which could forge the header anyway.

#### Scenario: No Origin header
- **WHEN** a client opens `/api/ws` without an `Origin` header
- **THEN** the connection is accepted

### Requirement: CORS follows the allowed origins
Cross-origin HTTP requests to `/api` SHALL be allowed for exactly the allowed origins: a response to a request from an allowed origin SHALL carry that origin in `Access-Control-Allow-Origin`, and a response to a request from any other origin SHALL NOT carry that header.

#### Scenario: Allowed origin
- **GIVEN** the allowed origins are `https://game.example`
- **WHEN** a browser calls `GET /api/health` with `Origin: https://game.example`
- **THEN** the response includes `Access-Control-Allow-Origin: https://game.example`

#### Scenario: Foreign origin
- **GIVEN** the allowed origins are `https://game.example`
- **WHEN** a browser calls `GET /api/health` with `Origin: https://evil.example`
- **THEN** the response has no `Access-Control-Allow-Origin` header
