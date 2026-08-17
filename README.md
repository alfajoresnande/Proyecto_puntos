# Ñandé Alfajores Correntinos

E-commerce con programa de puntos de fidelización. Tienda online con retiro en
sucursal y envío a domicilio, catálogo de canjes por puntos, punto de venta
para el mostrador, caja diaria y panel de administración.

## Stack

- **Backend:** Node.js + Express + TypeScript + **MySQL 8** (`mysql2`)
- **Frontend:** Vite + React 18 + TypeScript
- **Auth:** JWT en cookie httpOnly + bcrypt, con protección CSRF
- **Imágenes:** `sharp` (reencode a WebP + variantes por tamaño)
- **Pagos:** Mercado Pago · **Email:** Resend · **Asistente:** Groq

## Estructura

```
Proyecto_puntos/
├── backend/          API Express (puerto 4000)
│   ├── src/          código fuente
│   ├── dist/         compilado — SE COMMITEA, es lo que corre en producción
│   └── uploads/      imágenes subidas desde el panel
├── frontend/         SPA React (puerto 5173, proxy → backend)
├── database/         schema.sql y migraciones
└── docker-compose.yml   MySQL 8 para desarrollo
```

## Desarrollo local

### 1. Base de datos

```bash
docker compose up -d mysql
```

Levanta MySQL 8 en el puerto **3307** del host y ejecuta `database/schema.sql`
automáticamente la primera vez (crea las tablas y los datos iniciales).

### 2. Variables de entorno

Crear `backend/.env`. Lo mínimo para desarrollo:

```
NODE_ENV=development
PORT=4000
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3307
MYSQL_USER=nande_user
MYSQL_PASSWORD=nande_password
MYSQL_DATABASE=nande_puntos
JWT_SECRET=cambiar-esto
FRONTEND_URL=http://localhost:5173
```

En producción estas variables son obligatorias: el backend se niega a arrancar
sin ellas. Las integraciones externas (Mercado Pago, Resend, Groq, Google
Sign-In) son opcionales y se desactivan solas si faltan sus claves.

### 3. Levantar todo

```bash
npm install
npm run dev
```

Un solo comando levanta backend (`:4000`) y frontend (`:5173`) en paralelo.
Abrí **http://localhost:5173**.

Por separado: `npm run dev:backend` / `npm run dev:frontend`.

## Build

```bash
npm run build --prefix frontend    # incluye check:images como gate
npm run build --prefix backend     # tsc → dist/
```

> **Importante:** `backend/dist` está versionado y es lo que ejecuta el
> servidor en producción. Si tocás algo en `backend/src`, compilá y **commiteá
> el `dist`** o el cambio no llega a producción.

## Imágenes

- `frontend/scripts/optimize-images.mjs` — recomprime los assets de
  `frontend/public` sin cambiar dimensiones, nombres ni extensiones.
- `frontend/scripts/check-images.mjs` — corre dentro de `npm run build` y falla
  si alguna imagen de `public/` supera el umbral de peso.
- Toda imagen subida desde el panel se reencodea a WebP (máx. 1600px) y se
  generan las variantes `-card` (600px) y `-thumb` (300px).
- Si falta una variante o el canónico, se generan al vuelo en el primer pedido
  y quedan guardadas en disco.

`UPLOADS_DIR` permite apuntar la carpeta de subidas a una ruta fuera del
proyecto, útil cuando el deploy reemplaza el directorio de la aplicación.

## Programa de puntos

Se configura desde el panel, no por variables de entorno. Los valores viven en
la tabla `configuracion`:

| Clave | Qué controla |
|---|---|
| `puntos_activo` | Interruptor general del programa |
| `puntos_monto_base` | Monto de compra que habilita un tramo |
| `puntos_por_monto` | Puntos que otorga cada tramo |
| `puntos_vencimiento_meses` | Vigencia de cada lote acreditado |

Con `puntos_activo` en `0` no se acredita ningún punto nuevo por ninguna vía,
se bloquean los canjes, se pausan los vencimientos y la sección desaparece de
la app. Los saldos existentes se conservan intactos.

## Scripts útiles

```bash
npx tsx src/scripts/migrateUploadsToWebp.ts --dry-run   # ver qué imágenes migrarían
npx tsx src/scripts/testPointsToggle.ts                 # test del guard de puntos
npx tsx src/scripts/reconcilePoints.ts                  # reconciliar saldos
npm run seed --prefix backend                           # datos iniciales
```

## Despliegue

- **Frontend:** build estático servido por Apache. `frontend/public/.htaccess`
  define el cacheo de assets y la política de `index.html`.
- **Backend:** proceso Node que arranca desde `backend/dist/src/server.js`.
- La carpeta de subidas debe persistir entre despliegues.
