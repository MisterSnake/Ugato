# Tasks

Toda tarea que cambia código de producción es un ciclo Red-Green-Refactor:
1. **Red**: escribir el test que falla y correr la suite para verlo fallar.
2. **Green**: escribir el código mínimo, con nombres en inglés, que lo hace pasar.
3. **Refactor**: limpiar con la suite en verde.

Los archivos de infraestructura y CI (Dockerfile, Bicep, workflows, bootstrap) no son código de la app y no se prueban con tests unitarios. Esas tareas lo dicen y terminan con una verificación concreta: un job de CI que los compila o analiza, o una comprobación en producción.

Comandos del backend, desde `backend/`: `./.venv/Scripts/python.exe -m pytest -q`. Comandos del frontend, desde `frontend/`: después de cada tarea tienen que pasar `npm test`, `npm run build` y `npm run lint`.

## 1. Backend: configuración, versión y orígenes

- [x] 1.1 La configuración lee `APP_VERSION` y `ALLOWED_ORIGINS`.
  - Red: en `backend/tests/test_settings.py`, tests de que sin variables la versión es `"dev"` y los orígenes son `["http://localhost:5173"]`; de que `ALLOWED_ORIGINS=" https://a.example, https://b.example ,"` da `["https://a.example", "https://b.example"]`; y de que `APP_VERSION=abc` da `"abc"` (con `monkeypatch.setenv`).
  - Green: un módulo `app/settings.py` con la lectura y una dependencia `get_settings` que los tests puedan sobrescribir.
  - Refactor.
  - Verificar: pytest en verde.
- [x] 1.2 Health devuelve la versión (spec `deployment`: "Health reports the deployed version").
  - Red: en `backend/tests/test_health.py`, `GET /api/health` responde `{"status": "ok", "version": "dev"}` por defecto, y `{"status": "ok", "version": "abc123"}` con la configuración sobrescrita.
  - Green: `health()` en `app/main.py` usa `get_settings`.
  - Refactor.
  - Verificar: pytest en verde.
- [x] 1.3 CORS sigue la lista de orígenes (spec `connection-origin`: "CORS follows the allowed origins").
  - Red: tests de que, con `ALLOWED_ORIGINS=https://game.example`, `GET /api/health` con `Origin: https://game.example` lleva `Access-Control-Allow-Origin: https://game.example`, y con `Origin: https://evil.example` no lleva ese header. La app se construye con la variable puesta, a través de una fábrica de app o recargando el módulo; elegir la opción más simple que no rompa los tests existentes.
  - Green: `CORSMiddleware` toma `allow_origins` de la configuración.
  - Refactor.
  - Verificar: pytest en verde.
- [x] 1.4 El handshake WS rechaza orígenes ajenos (spec `connection-origin`: "WebSocket handshake rejects foreign origins" y "Clients without an Origin header").
  - Red: en `backend/tests/games/test_ws.py` (o un archivo nuevo `test_ws_origin.py`), con orígenes permitidos `https://game.example`:
    - abrir `/api/ws` con `Origin: https://evil.example` lanza `WebSocketDisconnect`, o falla el handshake, sin recibir mensajes;
    - con `Origin: https://game.example` se puede mandar `subscribe_lobby` y recibir `games_list`;
    - sin `Origin`, también.
  - Green: en `ws.py`, antes de `websocket.accept()`, cerrar con código 1008 cuando hay `Origin` y no está permitido.
  - Refactor.
  - Verificar: toda la suite del backend en verde, incluidos los tests existentes del WS.
- [x] 1.5 Documentar en `backend/README.md` la respuesta nueva de health, `APP_VERSION`, `ALLOWED_ORIGINS` y el rechazo por `Origin`. Verificar: el README describe las dos variables con sus valores por defecto, y el ejemplo de health coincide con lo que devuelve el test de 1.2.

## 2. Frontend: endpoint del WebSocket configurable

- [x] 2.1 Una función pura arma la URL del WS (spec `deployment`: "Configurable WebSocket endpoint").
  - Red: en `src/game/socketUrl.test.ts`, que:
    - una URL configurada `wss://backend.example/api/ws` se devuelve tal cual;
    - si no está configurada (`undefined` o `''`), con `https:` y host `game.example` da `wss://game.example/api/ws`;
    - con `http:` y host `localhost:5173` da `ws://localhost:5173/api/ws`.
  - Green: `src/game/socketUrl.ts` exporta `gameSocketUrl(configuredUrl, location)`.
  - Refactor.
  - Verificar: `npm test` en verde.
- [x] 2.2 `App` usa `VITE_WS_URL`.
  - Red: en `App.test.tsx`, un test que fija `VITE_WS_URL` (con `vi.stubEnv`) y comprueba que la `createSocket` inyectada recibe esa URL, y otro que sin la variable recibe la URL del mismo origen de jsdom.
  - Green: `App.tsx` reemplaza su `gameSocketUrl()` local por `gameSocketUrl(import.meta.env.VITE_WS_URL, window.location)`, y `src/vite-env.d.ts` declara `VITE_WS_URL?: string` en `ImportMetaEnv`.
  - Refactor: borrar la función local y su comentario.
  - Verificar: `npm test`, `npm run build` y `npm run lint` en verde; `npm run dev` con el backend local sigue conectando por el proxy.

## 3. Imagen del backend

- [ ] 3.1 Crear `backend/Dockerfile` y `backend/.dockerignore` como dice el design (decisión 7): multi-etapa con `uv`, `python:3.14-slim`, usuario sin privilegios, `ARG/ENV APP_VERSION`, un solo worker de uvicorn con `--proxy-headers`. Es infraestructura, sin test unitario. Verificar: el job `image` de `ci.yml` (tarea 4.1) construye la imagen. Si hay Docker disponible en algún entorno, `docker run -e APP_VERSION=x -p 8000:8000` responde `{"status":"ok","version":"x"}` en `/api/health`.

## 4. Integración continua en pull requests

- [ ] 4.1 Crear `.github/workflows/ci.yml` (decisión 6) con los jobs `backend` (uv + pytest), `frontend` (Node 22: `npm ci`, lint, `npm test -- --run`, build), `image` (`docker build backend/` sin push) e `infra` (`az bicep build --file infra/main.bicep` y `shellcheck scripts/bootstrap.sh`, una vez que existan). Sin acceso a Azure. Verificar: al abrir el PR de este change, todos los jobs pasan en GitHub, y un test roto a propósito en una rama de prueba hace fallar el job correspondiente.

## 5. Infraestructura (Bicep)

- [ ] 5.1 Crear `infra/main.bicep` (decisión 2):
  - Static Web App con sku Free;
  - ambiente de Container Apps Consumption sin Log Analytics;
  - container app con min 0 / max 1 réplica, 0.25 vCPU / 0.5 GiB, ingress externo en el puerto 8000, probes en `/api/health`, y env `APP_VERSION` y `ALLOWED_ORIGINS` armado desde el hostname de la SWA;
  - parámetros `location`, `namePrefix`, `image` y `appVersion`;
  - outputs `backendFqdn`, `frontendHostname` y `staticSiteName`.

  Es infraestructura, sin test unitario. Verificar: `az bicep build` pasa en el job `infra` de CI, y la plantilla no declara ningún recurso de Log Analytics, ACR ni workload profile dedicado.

## 6. Bootstrap y guía de pasos manuales

- [ ] 6.1 Crear `scripts/bootstrap.sh` (decisión 5): idempotente, con `set -euo pipefail` y los parámetros `--repo`, `--budget-email`, `--location` y `--resource-group`. Registra providers, crea el RG, la App Registration, el service principal, la federated credential de `main`, el rol `Contributor` sobre el RG y el budget de USD 1, y guarda las variables con `gh` o las imprime. Es infraestructura, sin test unitario. Verificar: `shellcheck` pasa en el job `infra` de CI, y correrlo dos veces seguidas en Cloud Shell termina sin errores y sin duplicar recursos (ver 8.1).
- [x] 6.2 Escribir `docs/DEPLOYMENT.md`, en español, con:
  - requisitos (suscripción Pay-As-You-Go, permisos de admin del repo);
  - paso 1, el bootstrap en Cloud Shell, con el comando exacto y cómo autenticar `gh` ahí o pegar las variables a mano;
  - paso 2, el merge a `main`;
  - paso 3, hacer pública la imagen en GHCR si el primer deploy lo pide, con la ruta exacta en github.com y cómo relanzar los jobs fallidos;
  - dónde ver la URL del juego (el summary del workflow y el output `frontendHostname`);
  - cómo ver los logs (`az containerapp logs show --follow`);
  - rollback y cómo desmontar todo;
  - qué cuesta y qué no, y qué hacer si llega la alerta del budget;
  - limitaciones conocidas (las partidas se cortan en cada deploy, arranque en frío).

  Cada paso manual lleva su comando exacto o su ruta exacta en el portal o en github.com, y cada sección tiene un ancla estable que puedan citar los mensajes de error del pipeline (por ejemplo `#hacer-publica-la-imagen`). Verificar, según la spec `deployment` ("Deployment guide documents every manual step"):
  - recorrer el bootstrap, `deploy.yml` y el *Migration Plan* del design, listar toda acción que requiera intervención humana y confirmar que cada una tiene su sección en la guía;
  - cada comando coincide con los nombres y parámetros reales del script;
  - una persona que no participó del change, o una relectura en frío, puede seguir la guía de principio a fin sin consultar otro archivo.

  La validación real es la 8.1.
- [x] 6.3 Actualizar `CLAUDE.md`: agregar `infra/`, `.github/workflows/`, `scripts/` y `docs/` al layout, `VITE_WS_URL`, `APP_VERSION` y `ALLOWED_ORIGINS`, y que producción corre como una sola réplica. Verificar: la sección de arquitectura menciona que el WS va directo a ACA en producción y por el proxy de Vite en dev.

## 7. Despliegue continuo

- [ ] 7.1 Crear `.github/workflows/deploy.yml` (decisión 6) para `push` a `main`, con `concurrency: production`. Los jobs son:
  - `test-backend` y `test-frontend`;
  - `image`: build con `APP_VERSION=${{ github.sha }}` y push a `ghcr.io/mistersnake/ugato-backend:<sha>`;
  - `infra`: login por OIDC con las variables del repo, chequeo de pull anónimo de la imagen con un mensaje que apunte a `docs/DEPLOYMENT.md`, `az deployment group create` y exportar los outputs;
  - `frontend`: build con `VITE_WS_URL=wss://<fqdn>/api/ws`, escribir `dist/version.json`, obtener y enmascarar el token de SWA, y `Azure/static-web-apps-deploy` con `skip_app_build`;
  - `smoke`: reintentos de hasta unos 3 minutos comparando `/api/health.version` y `/version.json.version` con el SHA, y escribir las URLs en el job summary.

  Permisos mínimos por job. Es infraestructura, sin test unitario. Verificar con el primer merge (ver 8.1).
- [x] 7.2 Alinear `docs/DEPLOYMENT.md` con `deploy.yml` (spec `deployment`: "Guide matches the automation" y "Pipeline points to the guide"): actualizar en la guía los nombres finales de los jobs que hay que relanzar, dónde aparecen las URLs en el job summary y los nombres de los outputs. Confirmar que el mensaje de error del chequeo de visibilidad cita el ancla exacta de la sección correspondiente. Verificar: cada nombre de job, output o ancla que menciona la guía existe en `deploy.yml`, y cada ancla citada en `deploy.yml` existe en la guía.

## 8. Verificación de punta a punta

- [ ] 8.1 Primer despliegue real:
  1. correr el bootstrap en Cloud Shell siguiendo solo `docs/DEPLOYMENT.md`, y otra vez para confirmar que es idempotente;
  2. mergear a `main`;
  3. resolver la visibilidad de la imagen si lo pide;
  4. comprobar que `deploy.yml` termina en verde con el smoke test.

  Verificar: el job summary muestra las dos URLs, y ambas reportan el SHA mergeado. Además, no hizo falta ninguna acción fuera de la guía; si hizo falta, se agrega a `docs/DEPLOYMENT.md` antes de cerrar la tarea.
- [ ] 8.2 Validación funcional en producción:
  - abrir la URL de la SWA en dos navegadores, crear una partida, unirse y jugar varias jugadas;
  - dejar la partida inactiva más de 5 minutos y comprobar que sigue conectada (resuelve la open question del design sobre `--ws-ping-interval`);
  - desde la consola del navegador en otro sitio, `new WebSocket('wss://<fqdn>/api/ws')` falla.

  Verificar: todo se comporta como se describe. Si la conexión inactiva se corta, ajustar el ping en el Dockerfile y volver a desplegar.
- [ ] 8.3 Verificar el costo: en el portal, que el resource group tiene solo la Static Web App (Free), el ambiente y la container app; que la container app escala a 0 réplicas después de un rato sin tráfico; y que el budget `ugato-monthly` existe. Verificar: con capturas o la salida de `az resource list -g rg-ugato -o table` y `az containerapp replica list`.
- [ ] 8.4 Confirmar el flujo pedido: un cambio visible chico, mergeado a `main` por PR, aparece en producción sin intervención manual. Verificar: `/version.json` y `/api/health` muestran el SHA nuevo y el cambio se ve en el sitio.

## Workflow follow-up

- Archivar el change cuando el despliegue esté verificado.
- Confirmar que el archivo crea las specs principales `deployment` y `connection-origin` con su Purpose.
