# Sesión por cookie — qué cambió y qué hay que configurar (SEC-03, SEC-04, SEC-07)

## Resumen del cambio

Antes: el backend devolvía el JWT en el JSON de login, el frontend lo guardaba
en `localStorage`, lo mandaba como `Authorization: Bearer` y lo pegaba en la URL
del WebSocket. La cookie `HttpOnly` existía, pero el mismo token estaba además
al alcance de cualquier JavaScript de la página.

Ahora: **la sesión vive únicamente en la cookie**.

| | Antes | Ahora |
|---|---|---|
| Nombre | `auth_token` | `__Host-auth_token` (o `auth_token` en dev sobre http) |
| Atributos | HttpOnly, SameSite=Lax, Secure según entorno | HttpOnly, Secure (obligatorio en prod), SameSite configurable, Path=/, sin Domain |
| JWT en JSON | sí, en 5 endpoints | no |
| JWT en localStorage | sí | no |
| Header Bearer | sí | no se acepta |
| JWT en la URL del WS | sí (`?token=`) | no |
| Claims | `id`, `rol`, `email` | + `tv`, `jti`, `iss`, `aud`, `alg` fijado |
| Revocación | ninguna | `token_version` + `jti` revocados |
| CSRF | largo >= 16 | double-submit firmado con HMAC y atado a la sesión |

## ⚠️ Lo que hay que configurar ANTES de desplegar

### El problema del despliegue cross-site

Según `docs/despliegue.md`, el frontend está en `alfajorescorrentinos.com`
(Apache) y la API en `nandengineer.shop`. Son **dominios registrables
distintos**, o sea **cross-site**.

Una cookie `SameSite=Lax` **no se envía** en peticiones `fetch` cross-site. Con
el header Bearer eliminado, dejar `Lax` en esa topología significa que
**nadie puede autenticarse en producción**.

Hay dos salidas. Elegir una antes de desplegar:

**Opción A — la recomendada: poner la API en el mismo sitio.**
Servir la API bajo `api.alfajorescorrentinos.com` (o proxear `/api` desde
Apache hacia el backend). Pasa a ser same-site, `SameSite=Lax` funciona y la
protección CSRF del navegador queda al máximo. Es un cambio de infraestructura;
no está hecho.

> `frontend/vercel.json` ya define un rewrite `/api/:path*` →
> `https://nandengineer.shop/api/:path*`. **Si el frontend se sirve desde
> Vercel**, la API queda same-origin y ya estás en el caso A: dejar `lax`.
> El despliegue por Apache descrito en `docs/despliegue.md` **no** tiene ese
> proxy, y ahí sí aplica la opción B.

**Opción B — cross-site explícito.** En las variables de entorno del backend:

```
AUTH_COOKIE_SECURE=true
AUTH_COOKIE_SAMESITE=none
```

`SameSite=None` requiere `Secure` (el arranque aborta si falta). Con `None`, el
navegador ya no aporta protección CSRF; lo que la aporta es el token CSRF
firmado y la validación estricta de `Origin`, ambos implementados.

### Chequeos de arranque

El backend **no arranca** si:

- `NODE_ENV=production` y `AUTH_COOKIE_SECURE=false` → la cookie de sesión
  viajaría en claro.
- `AUTH_COOKIE_SAMESITE=none` sin `AUTH_COOKIE_SECURE=true` → el navegador
  descartaría la cookie.
- El nombre de cookie empieza con `__Host-` y no es `Secure`.

El error dice exactamente qué variable corregir.

## Efectos del despliegue

1. **Todas las sesiones actuales se cierran.** Los JWT viejos no tienen `iss`,
   `aud` ni `tv`, así que la verificación los rechaza. Es intencional: dado
   SEC-02, cerrar todo es lo correcto. Los usuarios vuelven a iniciar sesión.
2. **La cookie `device_id` se regenera** una vez, porque su clave de firma pasó
   a derivarse por separado de `JWT_SECRET`. Único efecto: se reinician los
   contadores de rate limiting por dispositivo.
3. **Migración del cliente**: al abrir la app, `purgeLegacyBrowserTokens()`
   (en `main.tsx`) borra `nande.csrf.token` y el campo `token` de
   `nande-auth` en `localStorage`. Se ejecuta antes de restaurar la sesión.
4. **La cookie vieja `auth_token` se sigue leyendo** durante la transición y se
   borra en el logout, así que nadie queda con dos cookies peleando.

## Variables nuevas

| Variable | Default | Para qué |
|---|---|---|
| `JWT_ISSUER` | `nande-puntos-api` | Claim `iss`, verificado |
| `JWT_AUDIENCE` | `nande-puntos-web` | Claim `aud`, verificado |
| `AUTH_COOKIE_SAMESITE` | `lax` | `none` en despliegue cross-site |
| `AUTH_COOKIE_SECURE` | `true` en producción | Abortar si es false en prod |
| `DEVICE_COOKIE_SECRET` | derivada de `JWT_SECRET` | Clave separada para `device_id` |
| `CSRF_SECRET` | `JWT_SECRET` | Clave para firmar el token CSRF |
| `READINESS_DB_TIMEOUT_MS` | `1500` | Timeout de `/api/ready` |

Cambiar `JWT_ISSUER` o `JWT_AUDIENCE` invalida todos los JWT existentes.

## Revocación de sesiones — por qué la alternativa A

Se eligió **JWT corto + `token_version` consultado en base**, no la sesión
opaca con hash SHA-256.

La sesión opaca es más fuerte en abstracto: si se filtra la base, los hashes no
permiten reutilizar sesiones. Pero acá el JWT está cableado en ~20 routers, en
`realtime.ts`, en el rate limiting y en el frontend; cambiarlo era reescribir la
autenticación entera, que es justo lo que había que evitar. Con `token_version`
alcanzan una columna y una consulta —que casi toda ruta autenticada ya hacía—
para cubrir los cuatro disparadores exigidos.

Cómo queda:

- `usuarios.token_version` — se incrementa al **cambiar contraseña**, **cambiar
  rol** o **desactivar la cuenta**. Invalida *todas* las sesiones del usuario.
- `sesiones_revocadas(jti)` — el **logout** revoca sólo el token de ese
  dispositivo, para no cerrar la sesión en el resto.
- En cada petición autenticada se leen de la base `rol`, `activo` y
  `token_version`. **El rol que se aplica es el de la base, nunca el del JWT**:
  un token viejo de una cuenta degradada no sigue actuando como admin.

Costo: una consulta a `usuarios` por petición autenticada (índice de clave
primaria). Si algún día molesta, se puede cachear unos segundos, a cambio de
que la revocación tarde eso en propagarse.

### Limpieza de `sesiones_revocadas`

Las filas se pueden borrar cuando su `expires_at` ya pasó —un JWT vencido no
sirve igual. Está `purgarSesionesRevocadasVencidas()` en
`backend/src/services/sessionRevocation.ts`; hoy no hay un worker que la llame.
La tabla crece un registro por logout, así que no urge, pero conviene
programarlo.

## CSRF

El token lo emite el servidor en `GET /api/csrf` y en cualquier GET a `/api`
donde falte. Formato `<nonce>.<exp>.<hmac>`, firmado con `CSRF_SECRET` y atado
a un binding derivado de la cookie de sesión.

El cliente lo lee de la cookie `csrf_token` (no HttpOnly, a propósito: tiene que
poder reenviarlo) y lo manda en `X-CSRF-Token`. El servidor verifica que header
y cookie coincidan, que la firma sea suya, que el binding corresponda a la
sesión actual y que no haya vencido.

Como el binding cambia al iniciar o cerrar sesión, `api.ts` y `authStore.ts`
reintentan **una sola vez** tras pedir un token nuevo cuando reciben un 403 de
CSRF.

Se mantienen, como capas independientes: validación estricta de `Origin`, CORS
con allowlist y `Sec-Fetch-Site`.

La excepción de `/pagos/webhook/*` sigue, y **sólo** se sostiene porque esa ruta
se autentica con la firma HMAC del propio proveedor (ver `routes/pagos.ts`).
