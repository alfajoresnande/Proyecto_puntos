---
name: Stack del Proyecto_puntos
description: Stack y arquitectura elegidos para el sistema de puntos de fidelización
type: project
---

Proyecto_puntos es un sistema de puntos de fidelización con 3 roles: cliente, vendedor, admin.
El vendedor carga puntos manualmente usando el DNI del cliente; el cálculo lo hace el sistema.

**Stack elegido (confirmado por el usuario el 2026-04-18):**
- Backend: Node.js + Express + TypeScript + SQLite (better-sqlite3) para la demo
- Frontend: Vite + React + TypeScript + Tailwind CSS + React Router
- Auth: JWT + bcrypt
- Estilo: minimalista

**Estructura del repo:**
```
Proyecto_puntos/
├── backend/
└── frontend/
```

**Plan de deploy post-demo:** host + Vercel. Al pasar a prod se migrará SQLite → Postgres
(Supabase/Neon) por compatibilidad con serverless.

**Why:** el usuario pidió primero una demo mostrable localmente, luego deploy.
**How to apply:** mantener el código portable a Postgres (queries SQL estándar, nada de
features exclusivas de SQLite). No sumar dependencias de más — minimalismo pedido explícitamente.
