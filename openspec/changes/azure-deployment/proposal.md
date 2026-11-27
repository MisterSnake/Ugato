# Proposal

## Why

Hoy U Cat solo corre en local (`uvicorn` + `npm run dev`). Necesitamos tenerlo en producción en Azure, sin costo, y que cada merge a `main` publique la versión nueva automáticamente, sin pasos a mano. Al exponer el backend en internet, además, hay que impedir que otros sitios abran WebSockets contra él.

## What Changes

- **Infraestructura como código (Bicep)** en `infra/`: Azure Static Web Apps (plan Free) para el frontend y Azure Container Apps (Consumption, 0 a 1 réplica, sin Log Analytics) para el backend, en `eastus2`, dentro de un resource group dedicado.
- **Dockerfile del backend** (`backend/Dockerfile`): imagen `python:3.14-slim` con `uv`, un solo worker de `uvicorn`. La imagen se publica en GitHub Container Registry (público, gratis), así que no hay ACR.
- **CI/CD en GitHub Actions**:
  - `ci.yml` en cada pull request: tests del backend, lint, tests y build del frontend, y build de la imagen sin publicarla.
  - `deploy.yml` en cada push a `main`: tests, publicación de la imagen `:<sha>`, despliegue de Bicep, build del frontend apuntando al backend, despliegue a SWA y un smoke test que falla si producción no sirve el commit recién mergeado.
  - Autenticación con Azure por OIDC (federated credential), sin secretos de larga vida.
- **Script de bootstrap** (`scripts/bootstrap.sh`), para correr una sola vez en Azure Cloud Shell: registra los providers, crea el resource group, la identidad de despliegue con su federated credential y el rol acotado al RG, crea un budget de alerta de USD 1 y guarda las variables del repo.
- **Guía de pasos manuales** (`docs/DEPLOYMENT.md`), reducida al mínimo: correr el bootstrap y, después del primer push, marcar como pública la imagen en ghcr.
- **Backend**:
  - `GET /api/health` devuelve también la versión desplegada: `{"status": "ok", "version": "<sha>"}`, o `"dev"` en local.
  - Los orígenes permitidos se configuran con `ALLOWED_ORIGINS`, que aplica a CORS y al WebSocket.
  - **BREAKING (solo para clientes de otros orígenes)**: el handshake de `/api/ws` se rechaza cuando el header `Origin` está presente y no es un origen permitido.
- **Frontend**: la URL del WebSocket sale de `VITE_WS_URL` cuando está definida en el build. Si no lo está, sigue siendo la del mismo origen, así que el desarrollo local con el proxy de Vite no cambia.

Fuera de alcance: dominio propio, persistencia de partidas (cada deploy, reinicio o scale-to-zero borra las partidas en curso), ambientes de staging o previews por PR, y observabilidad más allá del log stream de Container Apps.

## Capabilities

### New Capabilities

- `deployment`: cómo llega el juego a producción y qué garantiza esa producción. Cubre el despliegue automático al hacer merge a `main`, la versión en `/api/health` y su verificación, el endpoint del WebSocket configurable en el frontend, y los límites de escala y costo (una sola réplica del backend, todo en planes gratuitos).
- `connection-origin`: qué orígenes pueden usar el backend. Cubre la lista de orígenes permitidos por configuración, su aplicación a CORS y el rechazo del handshake WebSocket desde un origen no permitido.

### Modified Capabilities

Ninguna. Los requisitos de `game-creation`, `game-joining`, `game-lobby`, `game-play` y `turn-timer` siguen vigentes tal como están. Un rechazo por origen se ve en el cliente como una conexión fallida, que ya cubre "Disconnected lobby with manual retry".

## Impact

- **Archivos nuevos**: `backend/Dockerfile`, `backend/.dockerignore`, `infra/main.bicep` (y sus parámetros), `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `scripts/bootstrap.sh`, `docs/DEPLOYMENT.md`.
- **Backend**: `app/main.py` (versión en health y CORS desde la configuración), `app/games/ws.py` (chequeo de `Origin` antes de `accept`) y un módulo pequeño de configuración. Se agregan tests en `backend/tests/`.
- **Frontend**: la función que arma la URL del WebSocket sale de `App.tsx` a un módulo testeable que lee `VITE_WS_URL`, junto con la declaración de tipos del env de Vite.
- **Documentación**: `backend/README.md` (respuesta de health y `ALLOWED_ORIGINS`) y `CLAUDE.md` (despliegue y variables).
- **Servicios externos**: una suscripción de Azure Pay-As-You-Go (Static Web Apps Free y Container Apps dentro del free grant mensual), GitHub Actions y GitHub Container Registry (gratis porque el repo es público).
- **Operación**: cada deploy reemplaza la revisión del backend y termina las partidas en curso. La primera visita después de un rato sin uso tarda unos segundos por el arranque en frío.
