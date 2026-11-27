# Despliegue de U Cat en Azure

Cada push a `main` publica la versión nueva con el workflow **Deploy**
(`.github/workflows/deploy.yml`). Esta guía cubre todo lo que hay que hacer a
mano.

- [Requisitos](#requisitos)
- [Paso 1: bootstrap en Cloud Shell](#bootstrap) (una sola vez)
- [Paso 2: merge a `main`](#merge-a-main)
- [Paso 3: hacer pública la imagen](#hacer-publica-la-imagen) (solo si el primer deploy lo pide)
- [Dónde ver la URL del juego](#url-del-juego)
- [Si el despliegue falla](#si-el-despliegue-falla)
- [Logs](#logs)
- [Rollback](#rollback)
- [Desmontar todo](#desmontar)
- [Costos](#costos)
- [Si llega la alerta del budget](#alerta-del-budget)
- [Limitaciones conocidas](#limitaciones)

Los comandos `az` de esta guía se corren en Azure Cloud Shell (Bash). No hace
falta instalar nada en tu máquina. Usan los nombres por defecto: resource group
`rg-ugato`, container app `ugato-backend` y Static Web App `ugato-web`.

<a id="requisitos"></a>

## Requisitos

- Una suscripción de Azure **Pay-As-You-Go**.
- En esa suscripción, el rol **Owner** (el bootstrap asigna un rol), y permiso
  para crear App Registrations en Microsoft Entra ID. En una suscripción propia
  ya tienes ambos.
- Permisos de **admin** en el repositorio `MisterSnake/Ugato`.

<a id="bootstrap"></a>

## Paso 1: bootstrap en Cloud Shell

Se corre **una sola vez y antes del primer merge**: sin las variables que crea,
el workflow falla al iniciar sesión en Azure. Correrlo de nuevo no duplica nada.

1. Abre <https://shell.azure.com> y elige **Bash**.
2. Comprueba que estás en la suscripción correcta y cámbiala si hace falta:

   ```bash
   az account show --query name --output tsv
   az account set --subscription "<nombre o id de la suscripción>"
   ```

3. Recomendado: autentica la CLI de GitHub, para que el script guarde las
   variables del repo:

   ```bash
   gh auth login --hostname github.com --git-protocol https --web
   ```

   - Si pregunta *Authenticate Git with your GitHub credentials?*, responde `Y`.
   - El código lo muestra el propio comando en la terminal de Cloud Shell, en una
     línea como `! First copy your one-time code: XXXX-XXXX`. Cópialo.
   - Pulsa **Enter**. Cloud Shell puede no abrir el navegador y mostrar un aviso:
     en ese caso, abre tú <https://github.com/login/device> en otra pestaña.
   - Inicia sesión con la cuenta que es admin del repo, pega el código y autoriza
     **GitHub CLI**. Deja la terminal abierta: cuando termina, muestra
     `Logged in as <usuario>`.
   - El código caduca a los pocos minutos. Si caduca, vuelve a correr el comando.

4. Descarga el repositorio. Antes del primer merge, el script solo está en la
   rama del pull request, así que reemplaza `<rama>` por su nombre (después del
   merge, usa `main`):

   ```bash
   git clone --branch <rama> https://github.com/MisterSnake/Ugato.git
   cd Ugato
   ```

   Si la carpeta `Ugato` ya existe: `cd Ugato && git fetch && git switch <rama> && git pull`.

5. Corre el script con el email que debe recibir las alertas de gasto:

   ```bash
   bash scripts/bootstrap.sh --repo MisterSnake/Ugato --budget-email <tu-email>
   ```

   Opcionales: `--location` (por defecto `eastus2`) y `--resource-group` (por
   defecto `rg-ugato`). `--location` es la región del resource group; los
   recursos los crea `infra/main.bicep` en `eastus2`.

El script registra los providers `Microsoft.App` y `Microsoft.Web`, y crea el
resource group, la App Registration `ugato-github-deploy` con su service
principal, la federated credential para los pushes a `main`, el rol
`Contributor` sobre el resource group y el budget `ugato-monthly` de USD 1.
Termina con `==> Done`.

<a id="variables"></a>

### Si no autenticaste `gh`

El script imprime cuatro valores. Agrégalos en
<https://github.com/MisterSnake/Ugato/settings/variables/actions>
(*Settings → Secrets and variables → Actions → pestaña **Variables** → New
repository variable*). Son **variables**, no secretos:

| Nombre | Valor |
|---|---|
| `AZURE_CLIENT_ID` | el que imprime el script |
| `AZURE_TENANT_ID` | el que imprime el script |
| `AZURE_SUBSCRIPTION_ID` | el que imprime el script |
| `AZURE_RESOURCE_GROUP` | el que imprime el script (`rg-ugato`) |

No hay que guardar ningún secreto: el login usa OIDC y el token de la Static Web
App se pide en cada despliegue.

<a id="merge-a-main"></a>

## Paso 2: merge a `main`

1. En github.com, abre el pull request y espera a que pasen los checks del
   workflow **CI** (`backend`, `frontend`, `image` e `infra`).
2. Pulsa **Merge pull request**.
3. Sigue el despliegue en
   <https://github.com/MisterSnake/Ugato/actions/workflows/deploy.yml>.

Los jobs corren en este orden: `test-backend` y `test-frontend`, luego `image`,
`infra`, `frontend` y `smoke`. `smoke` comprueba durante unos 3 minutos que el
backend y el frontend publican el commit recién mergeado.

<a id="hacer-publica-la-imagen"></a>

## Paso 3: hacer pública la imagen

Solo hace falta si, en el primer despliegue, el job `infra` falla en el paso
*Check that the image can be pulled anonymously*. GitHub puede crear el paquete
como privado y no permite cambiarlo por API. Container Apps descarga la imagen
sin credenciales, así que tiene que ser pública.

1. Abre
   <https://github.com/users/MisterSnake/packages/container/ugato-backend/settings>
   (o, desde la página del repo, *Packages → ugato-backend → Package settings*).
2. En **Danger Zone**, pulsa **Change visibility**, elige **Public** y confirma
   escribiendo el nombre del paquete. Un paquete público no puede volver a ser
   privado.
3. Abre la corrida fallida en
   <https://github.com/MisterSnake/Ugato/actions/workflows/deploy.yml> y pulsa
   **Re-run jobs → Re-run failed jobs**. Se vuelven a correr `infra` y los jobs
   que dependen de él (`frontend` y `smoke`).

Los despliegues siguientes ya no lo piden.

<a id="url-del-juego"></a>

## Dónde ver la URL del juego

- **Summary del workflow**: abre la corrida de **Deploy** y mira la sección
  **Production** del resumen. El job `smoke` escribe ahí *Game* (la URL del
  juego) y *Backend health*.
- **Desde Cloud Shell**: el despliegue de Bicep expone los outputs
  `frontendHostname`, `backendFqdn` y `staticSiteName`. Cada despliegue se llama
  `ugato-<sha del commit>`:

  ```bash
  az deployment group show --resource-group rg-ugato --name ugato-<sha> \
    --query properties.outputs.frontendHostname.value --output tsv
  ```

  Sin el SHA a mano:

  ```bash
  az staticwebapp show --resource-group rg-ugato --name ugato-web \
    --query defaultHostname --output tsv
  ```

La URL es `https://<frontendHostname>`. Para saber qué commit está publicado,
abre `https://<frontendHostname>/version.json` y
`https://<backendFqdn>/api/health`.

<a id="si-el-despliegue-falla"></a>

## Si el despliegue falla

Mientras `test-backend` o `test-frontend` fallen, no se despliega nada. Corrige
el código con otro pull request. Para un fallo pasajero, usa **Re-run jobs →
Re-run failed jobs**. Si falla `frontend` o `smoke`, el backend nuevo ya puede
estar publicado: el mensaje de `smoke` dice cuál de las dos partes no coincide.

<a id="error-de-login"></a>

### Falla `azure/login`

- Si dice que faltan `client-id` o `tenant-id`, faltan las
  [variables del repo](#variables).
- Si el error es `AADSTS700213` (*No matching federated identity record found*),
  el *subject* de la federated credential no coincide con el que envía GitHub.
  Pasa si el repo se renombró, se transfirió o cambió su formato de OIDC. El
  mensaje de error cita el *subject* recibido; también aparece en el log de
  `azure/login` como `subject claim`. Debe terminar en `:ref:refs/heads/main`.
  Cópialo tal cual y corrige la credential en Cloud Shell:

  ```bash
  SUBJECT='<subject del error>'
  CLIENT_ID=$(az ad app list --filter "displayName eq 'ugato-github-deploy'" \
    --query "[0].appId" --output tsv)
  az ad app federated-credential update --id "$CLIENT_ID" \
    --federated-credential-id ugato-main \
    --parameters "{\"name\":\"ugato-main\",\"issuer\":\"https://token.actions.githubusercontent.com\",\"subject\":\"$SUBJECT\",\"audiences\":[\"api://AzureADTokenExchange\"]}"
  ```

  Después, **Re-run failed jobs**. Volver a correr el bootstrap recalcula el
  *subject* y reemplaza esta corrección, así que comprueba la línea `Subject:`
  que imprime.

<a id="logs"></a>

## Logs

No hay Log Analytics: solo se ve la consola en vivo.

```bash
az containerapp logs show --resource-group rg-ugato --name ugato-backend --follow
```

Si el backend está dormido (0 réplicas), no hay nada que mostrar. Abre el juego
o `/api/health` para despertarlo y vuelve a correr el comando. Para los logs de
arranque y los errores de la plataforma, agrega `--type system`.

<a id="rollback"></a>

## Rollback

**Normal: revert en `main`.** En github.com, abre el pull request mergeado, pulsa
**Revert** y mergea el pull request que se crea. El pipeline despliega el commit
del revert, que tiene el código anterior y un SHA nuevo. Revierte el backend, el
frontend y la infraestructura.

**Urgente: volver el backend a una imagen anterior.** Las imágenes `:<sha>`
quedan en GHCR. `<sha-anterior>` es el SHA completo (40 caracteres) de un commit
de `main` que se haya desplegado bien:

```bash
az containerapp update --resource-group rg-ugato --name ugato-backend \
  --image ghcr.io/mistersnake/ugato-backend:<sha-anterior> \
  --set-env-vars APP_VERSION=<sha-anterior>
```

`--set-env-vars` hace falta para que `/api/health` reporte la versión que
realmente corre. Este comando **no** cambia el frontend, y el siguiente push a
`main` lo reemplaza, así que haz igualmente el revert.

<a id="desmontar"></a>

## Desmontar todo

1. Desactiva el workflow, para que el próximo push no falle: en
   <https://github.com/MisterSnake/Ugato/actions/workflows/deploy.yml>, menú
   **⋯ → Disable workflow**.
2. En Cloud Shell, borra el budget, el resource group (la Static Web App, el
   ambiente y la container app) y la App Registration (con su service principal y
   su federated credential):

   ```bash
   SUBSCRIPTION_ID=$(az account show --query id --output tsv)
   az rest --method delete --url "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/resourceGroups/rg-ugato/providers/Microsoft.Consumption/budgets/ugato-monthly?api-version=2023-11-01"
   az group delete --name rg-ugato --yes
   CLIENT_ID=$(az ad app list --filter "displayName eq 'ugato-github-deploy'" \
     --query "[0].appId" --output tsv)
   az ad app delete --id "$CLIENT_ID"
   ```

3. Borra la imagen: en
   <https://github.com/users/MisterSnake/packages/container/ugato-backend/settings>,
   **Danger Zone → Delete this package**.
4. Borra las cuatro variables `AZURE_*` en
   <https://github.com/MisterSnake/Ugato/settings/variables/actions>.

<a id="costos"></a>

## Costos

Con el uso esperado, el costo es **USD 0**:

| Recurso | Por qué no cuesta |
|---|---|
| Static Web App | Plan **Free** |
| Container Apps | Plan **Consumption**: 0 a 1 réplica de 0.25 vCPU y 0.5 GiB, dentro del free grant mensual |
| Imagen en GHCR | Paquete **público** |
| GitHub Actions | Gratis en repositorios públicos |
| Logs | Sin Log Analytics ni Azure Container Registry |

Lo que **puede** costar:

- Superar el free grant de Container Apps. El grant es por suscripción y se
  comparte con tus otras container apps. Mientras haya conexiones abiertas, la
  réplica sigue encendida: una pestaña olvidada consume grant, y también
  cualquiera que abra conexiones contra el backend.
- Superar los límites del plan Free de Static Web Apps no genera cobro: el plan
  no factura excedentes.
- Cambiar la plantilla: por ejemplo `minReplicas: 1`, más CPU o memoria, un
  workload profile dedicado, Log Analytics o el plan Standard. Revísalo en cada
  pull request que toque `infra/`.

Pay-As-You-Go **no tiene un tope de gasto**. El budget `ugato-monthly` solo
avisa por email al llegar al 80% y al 100% de USD 1 de gasto real en el mes, y
solo mide el resource group `rg-ugato`. No detiene nada, y los datos de costo
pueden tardar un día en aparecer.

<a id="alerta-del-budget"></a>

## Si llega la alerta del budget

1. Mira qué recurso gasta: en <https://portal.azure.com>, abre *Resource groups →
   rg-ugato → Cost Management → Cost analysis*.
2. Comprueba que no haya recursos de más ni cambios de escala:

   ```bash
   az resource list --resource-group rg-ugato --output table
   az containerapp show --resource-group rg-ugato --name ugato-backend \
     --query properties.template.scale
   az containerapp replica list --resource-group rg-ugato --name ugato-backend \
     --output table
   ```

   Lo esperado: una Static Web App, un ambiente y una container app, con
   `maxReplicas` en 1 y `minReplicas` en 0 (o sin valor).
3. Para cortar el consumo del backend mientras investigas, cierra su acceso desde
   internet. Sin tráfico, escala a 0:

   ```bash
   az containerapp ingress disable --resource-group rg-ugato --name ugato-backend
   ```

   El siguiente despliegue vuelve a abrirlo, así que no mergees a `main` hasta
   resolverlo (o desactiva el workflow). Para reactivarlo, relanza el último
   despliegue: **Re-run all jobs**.
4. Si no vas a seguir usando el juego, [desmonta todo](#desmontar).

<a id="limitaciones"></a>

## Limitaciones conocidas

- **Cada despliegue corta las partidas en curso.** Las partidas viven en la
  memoria del backend. También se pierden en un reinicio o al escalar a 0.
- **Arranque en frío.** Después de un rato sin uso, la primera conexión tarda
  unos segundos mientras el backend despierta.
- **Una sola réplica.** No subas `maxReplicas` ni agregues workers: cada
  instancia tendría sus propias partidas.
- Solo la URL de la Static Web App puede abrir el juego contra el backend. No hay
  dominio propio, ambientes de staging ni previews por pull request.
