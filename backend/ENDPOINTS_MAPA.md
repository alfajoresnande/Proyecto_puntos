# Mapa de Endpoints (Backend)

## Base
- API base: `/api`
- Salud: `GET /api/health`
- Diagnostico publico:
  - `GET /diagnostico` (estado API + DB)
  - `GET /diagnostico/db` (solo DB)
  - `GET /api/diagnostico` (alias)
  - `GET /api/diagnostico/db` (alias)
- Archivos estaticos:
  - `GET /uploads/:archivo`
  - `GET /api/uploads/:archivo`

## Reglas globales
- Metodos mutables (`POST`, `PUT`, `PATCH`, `DELETE`) requieren header `X-CSRF-Token`.
- En produccion, autenticacion por cookie `HttpOnly`.
- En rutas protegidas, si no hay sesion valida responde `401`.

## Auth (`/api/auth`)
| Metodo | Endpoint | Acceso | Descripcion |
|---|---|---|---|
| POST | `/api/auth/register` | Publico | Registro de cliente |
| POST | `/api/auth/login` | Publico | Login con email/password |
| POST | `/api/auth/google` | Publico | Login con Google |
| GET | `/api/auth/me` | Requiere sesion | Devuelve usuario autenticado |
| POST | `/api/auth/logout` | Sesion opcional | Cierra sesion (limpia cookie) |
| POST | `/api/auth/forgot-password` | Publico | Solicita recuperacion de contrasena |
| POST | `/api/auth/reset-password` | Publico | Cambia contrasena con token |

## Productos publicos (`/api/productos`)
| Metodo | Endpoint | Acceso | Descripcion |
|---|---|---|---|
| GET | `/api/productos` | Publico | Catalogo de productos |
| GET | `/api/productos/categorias` | Publico | Categorias disponibles |

## Paginas publicas (`/api/paginas`)
| Metodo | Endpoint | Acceso | Descripcion |
|---|---|---|---|
| GET | `/api/paginas` | Publico | Lista de paginas de contenido |
| GET | `/api/paginas/:slug` | Publico | Contenido de una pagina |

## Cliente (`/api/cliente`)
Acceso: requiere sesion + rol `cliente`.

| Metodo | Endpoint | Descripcion |
|---|---|---|
| GET | `/api/cliente/me` | Perfil del cliente |
| PATCH | `/api/cliente/perfil` | Actualizar perfil |
| POST | `/api/cliente/usar-codigo-invitacion` | Vincular codigo de invitacion |
| GET | `/api/cliente/mi-codigo` | Obtener codigo de invitacion propio |
| GET | `/api/cliente/movimientos` | Historial de puntos |
| GET | `/api/cliente/canjes` | Historial de canjes |
| GET | `/api/cliente/sucursales` | Sucursales activas para retiro |
| POST | `/api/cliente/canjear-codigo` | Canjear codigo promocional |
| POST | `/api/cliente/canjear-producto` | Canjear producto por puntos |

## Vendedor (`/api/vendedor`)
Acceso: requiere sesion + rol `vendedor` o `admin`.

| Metodo | Endpoint | Descripcion |
|---|---|---|
| GET | `/api/vendedor/cliente/:dni` | Buscar cliente por DNI |
| GET | `/api/vendedor/clientes/buscar` | Busqueda de clientes por nombre/DNI |
| POST | `/api/vendedor/cargar` | Cargar puntos por items |
| GET | `/api/vendedor/canje/:codigo` | Consultar canje por codigo |
| PATCH | `/api/vendedor/canje/:codigo` | Confirmar/actualizar estado de canje |

## Admin (`/api/admin`)
Acceso: requiere sesion + rol `admin`.

| Metodo | Endpoint | Descripcion |
|---|---|---|
| GET | `/api/admin/stats` | Estadisticas del panel |
| GET | `/api/admin/security/monitor` | Monitor de seguridad (memoria + persistidos) |
| POST | `/api/admin/backup/full` | Generar y descargar backup completo (DB + uploads) |
| GET | `/api/admin/usuarios` | Listar usuarios |
| POST | `/api/admin/usuarios` | Crear usuario |
| PUT | `/api/admin/usuarios/:id` | Editar usuario |
| PATCH | `/api/admin/usuarios/:id/activo` | Activar/desactivar usuario |
| POST | `/api/admin/puntos` | Ajuste manual de puntos |
| GET | `/api/admin/codigos` | Listar codigos de puntos |
| GET | `/api/admin/codigos/:id/usos` | Ver usos de un codigo |
| POST | `/api/admin/codigos` | Crear codigo de puntos |
| PATCH | `/api/admin/codigos/:id` | Activar/desactivar codigo |
| GET | `/api/admin/canjes` | Listar canjes |
| PATCH | `/api/admin/canjes/:id` | Actualizar estado de canje |
| GET | `/api/admin/movimientos` | Historial global de movimientos |
| GET | `/api/admin/productos` | Listar productos |
| POST | `/api/admin/productos/upload` | Subir imagen de producto |
| POST | `/api/admin/productos` | Crear producto |
| PUT | `/api/admin/productos/:id` | Editar producto |
| PATCH | `/api/admin/productos/:id/activo` | Activar/desactivar producto |
| GET | `/api/admin/categorias` | Listar categorias |
| POST | `/api/admin/categorias` | Crear categoria |
| PUT | `/api/admin/categorias/:id` | Editar categoria |
| GET | `/api/admin/sucursales` | Listar sucursales |
| POST | `/api/admin/sucursales` | Crear sucursal |
| PUT | `/api/admin/sucursales/:id` | Editar sucursal |
| PATCH | `/api/admin/sucursales/:id/activo` | Activar/desactivar sucursal |
| GET | `/api/admin/configuracion` | Ver configuracion |
| PUT | `/api/admin/configuracion/:clave` | Actualizar configuracion |
| GET | `/api/admin/paginas` | Listar paginas editables |
| GET | `/api/admin/paginas/:slug` | Ver pagina editable |
| PUT | `/api/admin/paginas/:slug` | Guardar pagina editable |

## Nota
Este mapa refleja las rutas montadas actualmente en `backend/src/server.ts` y `backend/src/routes/*.ts`.
