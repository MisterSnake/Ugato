# Design

## Context

Ver `proposal.md` (Why). Las restricciones que dan forma al diseño son estas:

- **El estado vive en memoria del proceso** (`GameRegistry`, timers con `asyncio.create_task` en `ws.py`). Por eso el backend tiene que ser una sola instancia, y cualquier reinicio borra las partidas.
- **El frontend abre el WebSocket hacia el mismo origen** (`App.tsx`, `gameSocketUrl()`), y `App` le pasa esa URL a la `GameSocketFactory` inyectable. Los tests ya pueden ver qué URL se usa.
- **CORS está fijo en el código** (`http://localhost:5173`) y `ws.py` hace `websocket.accept()` sin mirar el `Origin`.
- **El repo es público** (`github.com/MisterSnake/Ugato`) y la suscripción de Azure es Pay-As-You-Go.
- **En la máquina local no hay `az`, `gh` ni `docker`.** Los pasos manuales tienen que poder hacerse sin instalar nada.
- **Costo 0.** En Pay-As-You-Go no hay tope duro de gasto, así que el costo lo controlan la elección de planes y los límites de escala.

## Goals / Non-Goals

**Goals:**
- Que de un merge a `main` salga producción verificada, sin intervención.
- Que los pasos manuales se hagan una sola vez, desde el navegador (Azure Cloud Shell y github.com).
- Que no haya secretos de larga vida en GitHub.

**Non-Goals:**
- Persistir las partidas o hacer despliegues sin cortar las partidas en curso.
- Escalar horizontalmente el backend.
- Tener ambientes de staging o previews por PR (los previews de SWA quedan desactivados).
- Usar un dominio propio. Se usan los dominios `*.azurestaticapps.net` y `*.azurecontainerapps.io`.

## Decisions

### 1. Topología: SWA para el frontend y ACA para el backend, con el WS directo

```
            navegador
           /         \
   https  /           \  wss (directo, Origin = SWA)
         v             v
 +------------------+   +-----------------------------------+
 | Static Web App   |   | Container App  (env Consumption)  |
 | Free, dist/ +    |   | FastAPI :8000, 0..1 réplica       |
 | version.json     |   | ALLOWED_ORIGINS=https://<swa>     |
 +------------------+   | APP_VERSION=<sha>                 |
                        +-----------------------------------+
            rg-ugato  (eastus2)
```

SWA no hace proxy de WebSockets, y su "linked backend" solo existe en el plan Standard, que es pago. Por eso el navegador se conecta directo al FQDN de ACA.

*Alternativa considerada:* un solo contenedor en el que FastAPI sirve `dist/`. Tiene menos piezas y mantiene el mismo origen, pero el usuario prefirió SWA, que además sirve el frontend desde CDN aunque el backend esté dormido.

### 2. IaC: Bicep

Bicep no guarda estado (el estado es ARM), es nativo de Azure y soporta Container Apps desde el primer día. Terraform obligaría a crear y pagar un backend de estado, o a depender de HCP Terraform, y sumaría un paso manual. La plantilla se aplica con `az deployment group create` en modo incremental.

`infra/main.bicep`, con `targetScope = resourceGroup`, recibe estos parámetros: `location` (por defecto `eastus2`), `namePrefix` (por defecto `ugato`), `image` (la referencia completa `ghcr.io/...:<sha>`) y `appVersion` (el SHA). Define estos recursos:

- `Microsoft.Web/staticSites` con sku `Free`, sin `repositoryUrl`. El deploy se hace desde el pipeline, no por la integración automática de SWA con GitHub, porque esa integración crea su propio workflow y su propio secreto.
- `Microsoft.App/managedEnvironments` con plan Consumption y **sin** `appLogsConfiguration`: no hay Log Analytics, y el log stream de la consola sigue disponible.
- `Microsoft.App/containerApps`:
  - `activeRevisionsMode: Single`;
  - ingress `external`, `targetPort: 8000`, `transport: auto` (que admite WebSocket);
  - escala `minReplicas: 0`, `maxReplicas: 1`, con 0.25 vCPU y 0.5 GiB;
  - probes de liveness y readiness sobre `/api/health`;
  - env `APP_VERSION=appVersion` y `ALLOWED_ORIGINS=https://${staticSite.properties.defaultHostname}`.
- Outputs: `backendFqdn`, `frontendHostname` y `staticSiteName`.

El hostname de SWA se conoce dentro de la misma plantilla, así que `ALLOWED_ORIGINS` se arma sin un segundo paso.

### 3. Registro de imágenes: GHCR público

La imagen es `ghcr.io/mistersnake/ugato-backend:<sha>`, en minúsculas como exige el registry. ACR Basic cuesta alrededor de USD 5/mes. GHCR es gratis para paquetes públicos, y como el pull es anónimo ACA no necesita credenciales. Un `GITHUB_TOKEN` tampoco serviría como credencial de pull, porque expira y ACA vuelve a bajar la imagen cada vez que escala desde cero.

GitHub no tiene API para cambiar la visibilidad de un paquete, y un paquete nuevo puede nacer privado. Por eso, antes del despliegue de Bicep, `deploy.yml` verifica que el manifest se pueda bajar en forma anónima (pide un token anónimo a `ghcr.io/token` y hace `HEAD` del manifest). Si falla, corta con un mensaje que apunta a la sección de `docs/DEPLOYMENT.md` que explica cómo hacer pública la imagen. Pasa solo en el primer deploy.

### 4. Autenticación GitHub → Azure: OIDC

- `azure/login` usa `client-id`, `tenant-id` y `subscription-id` guardados como **variables** del repo (no son secretos).
- La federated credential tiene el subject `<prefijo del repo>:ref:refs/heads/main`, así que solo los pushes a `main` pueden desplegar. El prefijo es `repo:MisterSnake/Ugato` en el formato clásico, pero los repos creados, renombrados o transferidos después del 2026-07-15 usan por defecto `repo:OWNER@ID/REPO@ID` ([changelog de GitHub](https://github.blog/changelog/2026-04-23-immutable-subject-claims-for-github-actions-oidc-tokens/)). Por eso el bootstrap no lo fija: usa `sub_claim_prefix` de la API de OIDC del repo cuando `gh` está autenticado y, si no, lo arma con los datos públicos del repo según su fecha de creación. La guía explica cómo corregirlo si el login falla con `AADSTS700213`.
- `deploy.yml` no usa un GitHub `environment`, porque eso cambiaría el subject del token OIDC.
- El rol es `Contributor` acotado al resource group. La plantilla no crea role assignments, así que no hace falta `Owner` ni `User Access Administrator`.

*Alternativa considerada:* un client secret en `AZURE_CREDENTIALS`. Es un secreto de larga vida, que expira y hay que rotar.

### 5. Bootstrap en Cloud Shell, idempotente

`scripts/bootstrap.sh` (bash, porque Cloud Shell ya trae `az` y `gh`) recibe `--repo MisterSnake/Ugato` y `--budget-email <email>`, con `--location eastus2` y `--resource-group rg-ugato` como valores por defecto opcionales. Hace esto:

1. `az provider register` de `Microsoft.App` y `Microsoft.Web`, y espera a que queden registrados.
2. Crea el resource group.
3. Crea la App Registration `ugato-github-deploy` y su service principal, si no existen.
4. Crea la federated credential para `main`, si no existe.
5. Asigna `Contributor` sobre el RG, si no está asignado.
6. Crea el budget `ugato-monthly` de USD 1 sobre el RG, con alertas por email al 80% y al 100% del gasto real.
7. Guarda las variables del repo. Si `gh auth status` está ok, usa `gh variable set AZURE_CLIENT_ID|AZURE_TENANT_ID|AZURE_SUBSCRIPTION_ID|AZURE_RESOURCE_GROUP`. Si no, imprime los valores y el enlace a *Settings → Secrets and variables → Actions → Variables* para pegarlos a mano.

Cada paso consulta antes de crear, así que correrlo dos veces no rompe nada.

El **budget va en el bootstrap y no en Bicep** por dos motivos. `startDate` tiene que ser el primer día de un mes y no se puede cambiar después de crear el budget, así que un `utcNow()` en la plantilla haría fallar los redeploys del mes siguiente. Además, el budget es configuración de la cuenta, no del despliegue.

### 6. Pipelines

`ci.yml` (en `pull_request` a `main`), con jobs en paralelo:
- `backend`: `astral-sh/setup-uv`, `uv sync --frozen` y `uv run pytest -q`. En Linux, `uv run` funciona; el problema del trampoline es solo de la máquina Windows local.
- `frontend`: Node 22, `npm ci`, `npm run lint`, `npm test -- --run` y `npm run build`.
- `image`: `docker build` de `backend/` sin push.

`deploy.yml` (en `push` a `main`, con `concurrency: production` y `cancel-in-progress: false`):

```
 test-backend --+
                +--> image --> infra --> frontend --> smoke
 test-frontend -+     |          |          |            |
                      |          |          |            +- GET https://<fqdn>/api/health
                      |          |          |               .version == sha
                      |          |          |            +- GET https://<swa>/version.json
                      |          |          |               .version == sha
                      |          |          |            (reintenta hasta ~3 min)
                      |          |          +- npm ci && npm run build
                      |          |             con VITE_WS_URL=wss://<fqdn>/api/ws
                      |          |          +- escribe dist/version.json
                      |          |          +- token: az staticwebapp secrets list
                      |          |          +- Azure/static-web-apps-deploy
                      |          |             (app_location dist, skip_app_build)
                      |          +- azure/login (OIDC)
                      |          +- chequeo de pull anónimo de la imagen (decisión 3)
                      |          +- az deployment group create -> outputs
                      +- docker build --build-arg APP_VERSION=sha
                         push :sha (con GITHUB_TOKEN, packages: write)
```

- Permisos: `contents: read`, `packages: write` (solo el job `image`) e `id-token: write` (los jobs que usan Azure).
- Los jobs se pasan el FQDN, el hostname y el nombre de la SWA como outputs.
- El token de deploy de SWA se obtiene en el momento y se enmascara con `::add-mask::`. No hay que guardar ningún secreto.
- El frontend se construye **después** de Bicep porque `VITE_WS_URL` necesita el FQDN de ACA. Ese FQDN es estable mientras no se recree el ambiente.

### 7. Dockerfile del backend

- Una etapa de build con `uv`: copia el binario desde `ghcr.io/astral-sh/uv` y corre `uv sync --frozen --no-dev` sobre `python:3.14-slim`.
- Una etapa final `python:3.14-slim` con el `.venv` y `app/`, usuario sin privilegios y `ARG/ENV APP_VERSION=dev`.
- `CMD uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips=*`, con un solo worker y nunca `--workers`. `--proxy-headers` hace falta porque el Envoy de ACA termina TLS.
- `.dockerignore` excluye `.venv`, `tests`, `.pytest_cache` y `__pycache__`.

### 8. Cambios de código (TDD)

- **Configuración del backend**: un módulo pequeño (por ejemplo `app/settings.py`) lee `APP_VERSION` (por defecto `"dev"`) y `ALLOWED_ORIGINS` (lista separada por comas, recortada y sin vacíos; por defecto `["http://localhost:5173"]`). Lo expone como una dependencia de FastAPI que los tests puedan sobrescribir, igual que `get_registry`. CORS lee la lista al crear la app; los tests de CORS construyen la app con la variable de entorno puesta (con `monkeypatch`) o usan una fábrica de app.
- **Health**: agrega `version` a la respuesta.
- **Origin en el WS**: en `ws.py`, antes de `websocket.accept()`, si `websocket.headers.get("origin")` existe y no está en la lista permitida, `await websocket.close(code=1008)`. Antes del accept, Starlette responde al handshake con HTTP 403. Sin `Origin` se acepta (ver la spec `connection-origin`). Así los tests existentes con `TestClient`, que no mandan `Origin`, siguen pasando.
- **Frontend**: `gameSocketUrl` sale de `App.tsx` a `src/game/socketUrl.ts` como función pura `gameSocketUrl(configuredUrl: string | undefined, location: Pick<Location, 'protocol' | 'host'>)`. `App` la llama con `import.meta.env.VITE_WS_URL` y `window.location`. Se tipa `VITE_WS_URL` en `src/vite-env.d.ts` (aumentando `ImportMetaEnv`). Un string vacío cuenta como "no configurada".
- `version.json` lo escribe el pipeline; no es código de la app.

## Risks / Trade-offs

- **[Cada deploy corta las partidas en curso]**: el modo de revisión `Single` reemplaza el contenedor y la memoria se pierde. → Se acepta y se documenta. Los clientes ven "Can't reach the server." y pueden reintentar.
- **[Arranque en frío de 5 a 15 s]**: el WS espera a que despierte el backend. `gameSocket.ts` no tiene timeout propio, así que solo es lento. → Se acepta. Precalentar con `GET /api/health` al cargar la página queda como mejora futura.
- **[Timeouts de conexiones WS inactivas en el ingress de ACA]**: Envoy puede cerrar conexiones sin tráfico. uvicorn manda pings de WebSocket cada 20 s por defecto, y eso debería mantenerlas vivas. → Se verifica en la tarea de validación manual con una partida abierta más de 5 minutos sin jugadas. Si se cortan, se baja `--ws-ping-interval`.
- **[Pay-As-You-Go no tiene tope duro]**: un error de configuración, como `minReplicas: 1` o más CPU, podría costar. → `maxReplicas: 1`, recursos mínimos y scale-to-zero, todo en Bicep (y revisado en los PR), más el budget de USD 1 con alertas.
- **[Abuso público]**: cualquiera puede abrir conexiones desde un cliente que no sea un navegador, y eso consume el free grant. → Fuera de alcance. El chequeo de `Origin` frena el uso desde otros sitios web, y el budget avisa.
- **[Primer deploy con la imagen privada]**: la corrida falla en el chequeo de pull anónimo. → Mensaje claro, un paso manual documentado y *Re-run failed jobs*.
- **[Cambia el FQDN de ACA si se recrea el ambiente]**: → No pasa en redeploys normales. Si pasa, el mismo pipeline reconstruye el frontend con el FQDN nuevo.
- **[SWA Free sin SLA]**: → Se acepta para un juego sin SLA.

## Migration Plan

1. Mergear este change implementado a `main` **después** de correr el bootstrap. Sin las variables del repo, `deploy.yml` falla en el login de Azure.
2. Primer deploy: si falla el chequeo de visibilidad, hacer pública la imagen y relanzar los jobs fallidos.
3. **Rollback**: hacer revert del commit en `main`. El pipeline despliega el SHA anterior, porque las imágenes `:<sha>` quedan en GHCR. En una urgencia, `az containerapp update --image ghcr.io/mistersnake/ugato-backend:<sha-anterior>` desde Cloud Shell.
4. **Desmontar todo**: `az group delete -n rg-ugato`, y borrar la App Registration y el paquete en GHCR.

## Open Questions

- ¿Hace falta bajar `--ws-ping-interval`? Se resuelve con la validación de la partida inactiva en producción.
