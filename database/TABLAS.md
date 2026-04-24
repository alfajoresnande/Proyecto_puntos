# Base de datos — Documentación de tablas
**Sistema:** Ñandé Puntos Premium  
**Motor:** MySQL 8.0  

---

## Índice
1. [usuarios](#1-usuarios)
2. [productos](#2-productos)
3. [codigos_puntos](#3-codigos_puntos)
4. [usos_codigos](#4-usos_codigos)
5. [referidos](#5-referidos)
6. [canjes](#6-canjes)
7. [movimientos_puntos](#7-movimientos_puntos)
8. [configuracion](#8-configuracion)
9. [Relaciones entre tablas](#relaciones)
10. [Flujos principales](#flujos)

---

## 1. `usuarios`

Almacena **todos** los usuarios del sistema: admins y clientes.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | INT PK | No | AUTO | Identificador único |
| `nombre` | VARCHAR(100) | No | — | Nombre completo |
| `email` | VARCHAR(150) | No | — | Email único. Se usa para iniciar sesión |
| `google_id` | VARCHAR(255) | **Sí** | NULL | ID estable de Google para cuentas vinculadas con login social |
| `password_hash` | VARCHAR(255) | No | — | Contraseña encriptada con bcrypt. **Nunca se devuelve al frontend** |
| `rol` | ENUM | No | `'cliente'` | `'admin'` o `'cliente'`. Define qué puede hacer el usuario |
| `dni` | VARCHAR(20) | **Sí** | NULL | Solo para clientes. Los admins no tienen DNI |
| `telefono` | VARCHAR(25) | **Sí** | NULL | Teléfono opcional del usuario |
| `puntos_saldo` | INT | No | `0` | Saldo actual de puntos. Se actualiza **siempre** junto con `movimientos_puntos` |
| `codigo_invitacion` | VARCHAR(20) | **Sí** | NULL | Código único que cada cliente puede compartir para invitar amigos. Se genera automáticamente al registrarse. Los admins no tienen uno |
| `referido_por` | INT FK | **Sí** | NULL | ID del cliente que lo invitó. Solo se setea **una vez** al registrarse. Un usuario solo puede ser invitado por una persona |
| `activo` | TINYINT(1) | No | `1` | `1` = activo, `0` = deshabilitado. Un admin puede deshabilitar cuentas |
| `created_at` | DATETIME | No | NOW() | Fecha de registro |

**Reglas importantes:**
- `puntos_saldo` no se modifica directamente: primero se inserta en `movimientos_puntos` y luego se actualiza aquí.
- `codigo_invitacion` es único a nivel de tabla: no pueden existir dos usuarios con el mismo código.
- `referido_por` → si el usuario que lo invitó se elimina, este campo se pone en NULL (ON DELETE SET NULL).

---

## 2. `productos`

Catálogo de productos disponibles para canjear con puntos. **Sin stock**: la disponibilidad se gestiona en cada canje individualmente.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | INT PK | No | AUTO | Identificador único |
| `nombre` | VARCHAR(150) | No | — | Nombre del producto |
| `descripcion` | TEXT | **Sí** | NULL | Descripción larga. Si es NULL, el frontend muestra un texto genérico |
| `imagen_url` | VARCHAR(255) | **Sí** | NULL | URL de la imagen. Si es NULL, el frontend muestra un placeholder |
| `puntos_requeridos` | INT | No | — | Cuántos puntos necesita gastar el cliente para canjear este producto |
| `puntos_acumulables` | INT | **Sí** | NULL | Cuántos puntos gana el cliente si **compra** este producto en el local (informativo). NULL = no se muestra |
| `activo` | TINYINT(1) | No | `1` | `0` = el producto no aparece en el catálogo. Se usa en vez de borrarlo para no romper el historial de canjes |
| `created_at` | DATETIME | No | NOW() | Fecha de creación |

**¿Por qué no hay stock?**  
Si el producto no está disponible cuando el cliente va a retirarlo, el admin cambia el estado del canje a `no_disponible` y los puntos se devuelven automáticamente.

---

## 3. `codigos_puntos`

Códigos generados por los admins que los clientes pueden ingresar para ganar puntos.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | INT PK | No | AUTO | Identificador único |
| `codigo` | VARCHAR(50) UNIQUE | No | — | El código en sí (ej: `VERANO25`). Único en toda la tabla |
| `puntos_valor` | INT | No | — | Cuántos puntos otorga este código cuando se usa |
| `usos_maximos` | INT | No | `1` | Cantidad máxima de veces que puede ser usado. `0` = ilimitado |
| `usos_actuales` | INT | No | `0` | Cuántas veces fue usado ya. Se incrementa en cada uso |
| `fecha_expiracion` | DATETIME | **Sí** | NULL | Fecha límite para usar el código. NULL = sin vencimiento. La elige el admin al crearlo |
| `creado_por` | INT FK → usuarios | No | — | Qué admin generó este código |
| `activo` | TINYINT(1) | No | `1` | `0` = código deshabilitado manualmente por un admin |
| `created_at` | DATETIME | No | NOW() | Cuándo fue creado |

**Validaciones al usar un código:**
1. ¿Existe el código? → 404
2. ¿Está activo? → 400
3. ¿Expiró? (`fecha_expiracion < NOW()`) → 400
4. ¿Se alcanzó `usos_maximos`? (`usos_actuales >= usos_maximos && usos_maximos != 0`) → 400
5. ¿Ya lo usó este usuario? (check en `usos_codigos`) → 400

---

## 4. `usos_codigos`

Registro de qué usuario usó qué código y cuándo. Sirve para el historial y para evitar usos duplicados.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | INT PK | No | AUTO | Identificador único |
| `codigo_id` | INT FK → codigos_puntos | No | — | Qué código se usó |
| `usuario_id` | INT FK → usuarios | No | — | Quién lo usó |
| `created_at` | DATETIME | No | NOW() | Cuándo lo usó |

**Constraint clave:**  
`UNIQUE (codigo_id, usuario_id)` → Un usuario no puede usar el mismo código dos veces. MySQL rechaza el INSERT a nivel de base de datos.

**Uso típico para el admin:**  
```sql
-- Ver todos los usos de un código específico
SELECT u.nombre, u.email, uc.created_at
FROM usos_codigos uc
JOIN usuarios u ON uc.usuario_id = u.id
WHERE uc.codigo_id = ?
ORDER BY uc.created_at DESC;
```

---

## 5. `referidos`

Registra cada relación invitador → invitado. Se crea cuando un nuevo usuario se registra usando el código de invitación de otro.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | INT PK | No | AUTO | Identificador único |
| `invitador_id` | INT FK → usuarios | No | — | El cliente dueño del código de invitación |
| `invitado_id` | INT FK → usuarios UNIQUE | No | — | El nuevo usuario. **UNIQUE** porque una persona solo puede haber sido invitada una vez en su vida |
| `puntos_invitador` | INT | No | — | Snapshot de cuántos puntos se le dieron al invitador (valor al momento del registro, puede cambiar la config después) |
| `puntos_invitado` | INT | No | — | Snapshot de cuántos puntos se le dieron al invitado |
| `created_at` | DATETIME | No | NOW() | Cuándo ocurrió la invitación |

**¿Por qué guardar los puntos como snapshot?**  
El admin puede cambiar el valor de `puntos_referido_invitador` en `configuracion` después. Guardando el valor histórico sabemos exactamente qué se dio en cada momento.

**Lógica al registrarse con código de invitación:**
1. El nuevo usuario ingresa el `codigo_invitacion` de otro cliente.
2. Se busca el usuario dueño de ese código.
3. Se crea la fila en `referidos`.
4. Se crean **2 filas** en `movimientos_puntos` (una para cada uno).
5. Se actualiza `puntos_saldo` en ambos usuarios.
6. Se setea `referido_por` en el nuevo usuario (solo se hace una vez).

---

## 6. `canjes`

Solicitudes de canje de puntos por productos. Representa el ciclo de vida completo de un canje: desde que el cliente lo pide hasta que lo retira (o se cancela/expira).

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | INT PK | No | AUTO | Identificador único |
| `usuario_id` | INT FK → usuarios | No | — | Qué cliente hizo el canje |
| `producto_id` | INT FK → productos | No | — | Qué producto se canjeó |
| `codigo_retiro` | VARCHAR(9) UNIQUE | No | — | Código alfanumérico único de retiro (9 caracteres), generado una sola vez por canje |
| `puntos_usados` | INT | No | — | Snapshot del costo en puntos al momento del canje (por si cambia el precio del producto después) |
| `estado` | ENUM | No | `'pendiente'` | Ver estados abajo |
| `fecha_limite_retiro` | DATETIME | No | — | Calculado: `created_at + dias_limite_retiro` (de `configuracion`). Después de esta fecha el canje expira |
| `notas` | TEXT | **Sí** | NULL | Observaciones del admin: razón de cancelación, aclaraciones, etc. |
| `created_at` | DATETIME | No | NOW() | Cuándo se solicitó |
| `updated_at` | DATETIME | No | NOW() | Última modificación (actualizado automáticamente por MySQL) |

**Estados del canje:**

| Estado | Significado | ¿Devuelve puntos? |
|---|---|---|
| `pendiente` | Solicitado, esperando retiro en el local | No |
| `entregado` | El cliente retiró el producto exitosamente | No |
| `no_disponible` | El producto no estaba disponible al ir a retirarlo | **Sí** |
| `expirado` | Venció `fecha_limite_retiro` sin que el cliente retire | **No** |
| `cancelado` | Cancelado (razón opcional en `notas`) | **Sí** |

**Flujo de puntos en canjes:**
- Al crear el canje: se descuentan los puntos (`canje_producto`, puntos negativos en `movimientos_puntos`).
- Al pasar a `no_disponible` o `cancelado`: se devuelven los puntos (`devolucion_canje`, puntos positivos).
- `expirado` y `entregado`: los puntos **no** se devuelven.

---

## 7. `movimientos_puntos`

**El corazón del sistema de auditoría.** Registro inmutable de **todos** los cambios de puntos en el sistema. Nunca se borran filas. Siempre se inserta aquí antes de tocar `usuarios.puntos_saldo`.

| Columna | Tipo | Nulo | Default | Descripción |
|---|---|---|---|---|
| `id` | INT PK | No | AUTO | Identificador único |
| `usuario_id` | INT FK → usuarios | No | — | A qué usuario afecta este movimiento |
| `tipo` | ENUM | No | — | Categoría del movimiento. Ver tipos abajo |
| `puntos` | INT | No | — | Positivo = suma puntos / Negativo = resta puntos |
| `descripcion` | VARCHAR(255) | **Sí** | NULL | Nota libre: motivo del ajuste, nombre del código, etc. |
| `referencia_id` | INT | **Sí** | NULL | ID del objeto relacionado. Puede ser NULL si no hay objeto asociado (ej: asignación manual) |
| `referencia_tipo` | VARCHAR(50) | **Sí** | NULL | Indica a qué tabla apunta `referencia_id`: `'codigos_puntos'`, `'referidos'`, `'canjes'` |
| `creado_por` | INT FK → usuarios | **Sí** | NULL | Admin que ejecutó la acción. NULL si fue automático (ej: código canjeado por el propio cliente) |
| `created_at` | DATETIME | No | NOW() | Cuándo ocurrió |

**¿Por qué `referencia_id` puede ser NULL?**  
No todos los movimientos tienen un objeto asociado. Una asignación manual de puntos no tiene ningún código, canje o referido ligado — simplemente el admin decidió sumarle puntos.

**Tipos de movimiento:**

| Tipo | Puntos | Cuándo | `referencia_tipo` |
|---|---|---|---|
| `asignacion_manual` | +/- | Admin suma/resta puntos directamente | NULL |
| `codigo_canje` | + | Cliente usó un código de puntos | `'codigos_puntos'` |
| `referido_invitador` | + | Alguien se registró con tu código | `'referidos'` |
| `referido_invitado` | + | Te registraste con el código de alguien | `'referidos'` |
| `canje_producto` | − | Cliente canjeó un producto (puntos descontados) | `'canjes'` |
| `devolucion_canje` | + | Puntos devueltos por canje cancelado/no disponible | `'canjes'` |
| `ajuste` | +/- | Corrección sin categoría específica | NULL |

**Consulta típica (historial de un usuario):**
```sql
SELECT tipo, puntos, descripcion, created_at
FROM movimientos_puntos
WHERE usuario_id = ?
ORDER BY created_at DESC
LIMIT 50;
```

---

## 8. `configuracion`

Parámetros globales del sistema que el admin puede editar desde el panel sin necesidad de cambiar código.

| Clave | Valor ejemplo | Descripción |
|---|---|---|
| `puntos_referido_invitador` | `50` | Puntos que gana quien compartió su código cuando alguien lo usa |
| `puntos_referido_invitado` | `30` | Puntos que gana el nuevo usuario al registrarse con un código |
| `dias_limite_retiro` | `7` | Días que tiene el cliente para retirar un producto canjeado antes de que el canje expire |
| `longitud_codigo_invitacion` | `9` | Longitud del código de invitación generado automáticamente (alfanumérico) |

**Estructura:**

| Columna | Tipo | Descripción |
|---|---|---|
| `clave` | VARCHAR(100) PK | Nombre único del parámetro |
| `valor` | VARCHAR(255) | Valor almacenado como texto. El backend lo convierte al tipo necesario (INT, Boolean, etc.) |
| `descripcion` | TEXT | Descripción del parámetro (para mostrar en el panel) |

---

## Relaciones

```
usuarios ◄──────────────────────── referidos.referido_por (quien lo invitó)
   │
   ├──► movimientos_puntos (historial de TODOS los cambios de puntos)
   │
   ├──► usos_codigos ──────────────► codigos_puntos (creado por admin)
   │
   ├──► canjes ─────────────────────► productos
   │
   └──► referidos (como invitador o como invitado)
```

---

## Flujos

### Registro con código de invitación
```
1. Cliente ingresa codigo_invitacion de otro usuario
2. Backend busca usuario con ese codigo_invitacion
3. Lee puntos_referido_invitador y puntos_referido_invitado de configuracion
4. Crea el nuevo usuario (referido_por = id del invitador)
5. INSERT INTO referidos (invitador_id, invitado_id, puntos_invitador, puntos_invitado)
6. INSERT INTO movimientos_puntos × 2 (uno para cada usuario)
7. UPDATE usuarios SET puntos_saldo = puntos_saldo + X WHERE id IN (invitador, invitado)
```

### Cliente canjea un código de puntos
```
1. Cliente ingresa el código
2. Validar: existe, activo, no expirado, no agotado, no usado por este cliente
3. INSERT INTO usos_codigos
4. UPDATE codigos_puntos SET usos_actuales = usos_actuales + 1
5. INSERT INTO movimientos_puntos (tipo='codigo_canje', puntos=+X)
6. UPDATE usuarios SET puntos_saldo = puntos_saldo + X
```

### Cliente canjea un producto
```
1. Verificar puntos_saldo >= puntos_requeridos
2. Calcular fecha_limite_retiro = NOW() + dias_limite_retiro (de configuracion)
3. Generar `codigo_retiro` (alfanumérico de 9 caracteres, único e irrepetible)
4. INSERT INTO canjes (estado='pendiente', puntos_usados=snapshot, codigo_retiro)
5. INSERT INTO movimientos_puntos (tipo='canje_producto', puntos=-X)
6. UPDATE usuarios SET puntos_saldo = puntos_saldo - X
```

### Admin marca canje como no disponible o cancelado (devuelve puntos)
```
1. UPDATE canjes SET estado='no_disponible' (o 'cancelado'), notas=?
2. INSERT INTO movimientos_puntos (tipo='devolucion_canje', puntos=+puntos_usados)
3. UPDATE usuarios SET puntos_saldo = puntos_saldo + puntos_usados
```

### Admin asigna puntos manualmente
```
1. Admin elige cliente y cantidad (+/-)
2. INSERT INTO movimientos_puntos (tipo='asignacion_manual', creado_por=admin_id)
3. UPDATE usuarios SET puntos_saldo = puntos_saldo + cantidad
   (si cantidad es negativa, no puede quedar saldo < 0)
```
