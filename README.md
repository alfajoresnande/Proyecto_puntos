# Proyecto Puntos — Demo

Sistema de puntos de fidelización con tres roles: **cliente**, **vendedor** y **admin**.
El vendedor carga puntos manualmente usando el DNI del cliente; el sistema calcula cuántos
puntos otorgar según el monto de la compra.

## Stack

- **Backend:** Node.js + Express + TypeScript + SQLite (`better-sqlite3`)
- **Frontend:** Vite + React + TypeScript + Tailwind CSS
- **Auth:** JWT + bcrypt

## Estructura

```
Proyecto_puntos/
├── backend/     API Express (puerto 4000)
└── frontend/    SPA React (puerto 5173, proxy → backend)
```

## Correr la demo

### Primera vez (setup)

Desde la **raíz del proyecto**:

```bash
npm install          # instala concurrently (orquestador)
cp backend/.env.example backend/.env
npm run setup        # instala deps de backend y frontend + corre el seed
```

### Levantar todo junto

```bash
npm run dev
```

Un solo comando levanta backend (`:4000`) y frontend (`:5173`) en paralelo.
Ctrl+C detiene ambos.

Abrí: **http://localhost:5173**

### Alternativa: levantarlos por separado

```bash
npm run dev:backend    # solo API
npm run dev:frontend   # solo frontend
```

## Usuarios de prueba (tras `npm run seed`)

| Rol       | Email                | Password      | DNI       |
|-----------|----------------------|---------------|-----------|
| Admin     | admin@demo.com       | admin123      | —         |
| Vendedor  | vendedor@demo.com    | vendedor123   | —         |
| Cliente   | cliente@demo.com     | cliente123    | 30123456  |
| Cliente   | cliente2@demo.com    | cliente123    | 28456789  |

## Regla de puntos

Configurable en `backend/.env`:

```
PUNTOS_POR_PESO=0.01    # 1 punto cada $100
```

## Flujo

1. **Cliente** se registra desde `/registro` (rol asignado automáticamente).
2. **Vendedor** ingresa con su cuenta → busca cliente por DNI → ingresa monto → el sistema calcula y acredita puntos.
3. **Cliente** ingresa y ve su saldo y movimientos en `/cliente`.
4. **Admin** ve estadísticas, listas de usuarios y transacciones, y puede crear vendedores/admins.

## Deploy (siguiente paso)

- **Backend:** Render / Railway / Fly.io — migrar SQLite → Postgres (Neon / Supabase).
- **Frontend:** Vercel. Setear `VITE_API_URL` apuntando al backend desplegado (o usar rewrites en Vercel).
- **Móvil:** la UI ya es responsive. Opcionalmente convertirla en PWA (agregar manifest + service worker).
