# Proyecto Puntos — contexto para agentes

E-commerce de alfajores (Ñandé, Corrientes) con programa de puntos.
Roles: `cliente`, `vendedor`, `admin`, `superAdmin`.

## Stack real

- **Backend:** Express + TypeScript + **MySQL** (`mysql2`), puerto 4000
- **Frontend:** Vite + React 18 + TypeScript, puerto 5173
- **Producción:** frontend estático servido por **Apache** (ver `frontend/public/.htaccess`); backend Node aparte

> El `README.md` dice SQLite / `better-sqlite3`. **Está desactualizado** — es MySQL. No te guíes por él.

## Trampas que cuestan tiempo si no las sabés

**1. `backend/dist` está commiteado y es lo que corre en producción.**
El `server.js` de la raíz arranca `backend/dist/src/server.js`. Si tocás algo
en `backend/src/`, tenés que correr `npm run build --prefix backend` y
**commitear el `dist`**, o el cambio no llega a producción.

**2. Los archivos del `dist` aparecen como modificados sin estarlo.**
Es ruido de CRLF vs LF. Verificá con `git diff --numstat` antes de asumir
que hay cambios reales.

**3. Levantar la app localmente requiere MySQL corriendo.**
Si no está, el backend queda colgado sin error claro y `curl` a `:4000` da
connection refused. **No pierdas tiempo depurándolo**: verificá con
typecheck, tests y tests unitarios de los servicios. La verificación real
se hace en producción.

**4. No hay CI ni husky.** El único punto de control es `npm run build`.

## Comandos

```bash
npm run dev                        # back + front juntos (necesita MySQL)
npm run build --prefix frontend    # incluye check:images como gate
npm run build --prefix backend     # tsc -> dist (commitear el resultado)
npm test --prefix frontend         # vitest
```

## Patrones del código

**Config global:** tabla `configuracion` (clave/valor/descripcion), sembrada
en `backend/src/db.ts` (`ensureGlobalConfigurationSchema`). Se edita con
`PUT /api/admin/configuracion/:clave`. Para exponer un flag al frontend, el
patrón existente es un endpoint público chico: ver `chatbot_activo` →
`GET /api/ai/status` → `App.tsx`. Toggle de admin solo-superAdmin: ver el
card del chatbot en `Admin.tsx` dentro del bloque `isSuperAdmin`.

**Puntos:** toda acreditación pasa por `registrarMovimientoPuntos()` en
`backend/src/services/points.ts`. La acreditación por compra tiene un único
punto de entrada: `acreditarPuntosPorCompra()`, que llaman checkout web,
ventas locales, `orderLifecycle`, `pendingCheckout` y los backfills.

**Subida de imágenes:** un solo endpoint, `POST /api/admin/productos/upload`
en `admin.ts`. Orden obligatorio: multer → `verifyUploadedImageFile()`
(magic bytes, es una propiedad de seguridad) → recién ahí `sharp`.

## Imágenes (ya optimizado, rama `optimize-images`)

- `frontend/public` pasó de 41.6MB a 9.4MB por recompresión in-place.
- `frontend/scripts/optimize-images.mjs` — recomprime sin cambiar
  dimensiones, nombres ni extensiones. Idempotente.
- `frontend/scripts/check-images.mjs` — falla el build si una imagen de
  `public/` supera 900KB. Corre dentro de `npm run build`.
- `backend/src/services/imageVariants.ts` — toda subida se reencodea a WebP
  canónico (tope 1600px) + variantes `-card` (600px) y `-thumb` (300px).
  **Nunca recorta**: el CSS ya encuadra con `object-fit` y el encuadre
  cambia por breakpoint (16/9 desktop, 1/1 mobile).
- `backend/src/scripts/generateUploadVariants.ts` — backfill idempotente.

Anchos de render reales de una card de producto (medidos en `catalog.css`,
no los recalcules): 5 col ~323px · 4 col ~330px · **2 col ~490px (el máximo)**
· 1 col 340px.

## Convenciones

- **Todo lo visible al usuario va en español** (mensajes de error incluidos).
- Los mensajes de commit van en inglés.
- No borres archivos de `backend/uploads/` ni de `frontend/public/` sin
  chequear la base: hay `imagen_url` guardadas en `productos`, `categorias`,
  `paginas_contenido` y `layout_timeline_eventos` que un `grep` no ve.

## Pendiente

Toggle de puntos para superAdmin: flag `puntos_activo` que apague el
programa en backend (bloquear sumas en `registrarMovimientoPuntos`,
permitiendo `ajuste`/`vencimiento_puntos`/`devolucion_canje` para que las
devoluciones sigan cuadrando) y lo oculte en frontend (navbar, rutas
`/catalogo` `/mis-canjes` `/carrito-canjes`, saldo, productos de canje).
