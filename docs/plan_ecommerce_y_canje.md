# Plan de implementacion: E-commerce + Canje de puntos

## 1) Objetivo
Convertir la app actual en una plataforma con:
- compra online con dinero
- canje con puntos
- stock unico compartido para evitar sobreventa
- UX separada: una experiencia para "Tienda" y otra para "Canjes"

Este documento NO implementa codigo. Es un plan funcional y tecnico.

---

## 2) Decision de arquitectura (recomendada)
No crear una segunda tabla `productos`.

Usar un solo catalogo `productos` y agregar campos para soportar ambos modelos:
- `tipo_producto`: `canje` | `venta` | `mixto`
- `precio_dinero`: decimal nullable
- `precio_puntos`: int nullable
- `stock_disponible`: int
- `stock_reservado`: int
- `permite_envio`: bool
- `permite_retiro_local`: bool

Ademas, para multiples locales, manejar stock por sucursal (no solo global).

Regla:
- si el producto es el mismo fisicamente, comparte stock siempre
- si son productos realmente distintos, se crean filas distintas en `productos`

---

## 3) Modelo de datos propuesto

## 3.1 Cambios en tablas existentes
### `productos`
- mantener tabla actual
- agregar columnas:
  - `sku` (varchar unique)
  - `tipo_producto` (enum: canje, venta, mixto)
  - `precio_dinero` (decimal(10,2), null)
  - `precio_puntos` (int, null)
  - `stock_disponible` (int not null default 0)
  - `stock_reservado` (int not null default 0)
  - `track_stock` (bool default 1)
  - `peso_gramos` (opcional para logistica)
  - `updated_at`

Nota: `puntos_requeridos` puede migrarse a `precio_puntos` para unificar nombres.

## 3.2 Tablas nuevas
### `inventario_sucursal`
- `id`, `producto_id`, `sucursal_id`
- `stock_disponible`, `stock_reservado`
- `updated_at`
- unique recomendado: (`producto_id`, `sucursal_id`)

### `carritos`
- `id`, `usuario_id`, `estado` (activo, convertido, abandonado), `created_at`, `updated_at`

### `carrito_items`
- `id`, `carrito_id`, `producto_id`, `cantidad`
- `modo_compra`: `dinero` | `puntos`
- `precio_dinero_unit` snapshot
- `precio_puntos_unit` snapshot
- `subtotal_dinero`, `subtotal_puntos`

### `ordenes`
- `id`, `usuario_id`
- `canal`: web, admin, vendedor
- `estado`: borrador, pendiente_pago, pagada, preparada, entregada, cancelada, expirada
- `total_dinero`, `total_puntos`
- `moneda`
- `direccion_envio_json` (nullable)
- `sucursal_retiro_id` (nullable)
- `created_at`, `updated_at`

### `orden_items`
- `id`, `orden_id`, `producto_id`, `cantidad`
- `modo_compra`: dinero | puntos
- `precio_dinero_unit`, `precio_puntos_unit`
- `subtotal_dinero`, `subtotal_puntos`

### `pagos`
- `id`, `orden_id`, `proveedor` (mp/stripe/etc)
- `estado`: iniciado, aprobado, rechazado, reembolsado
- `monto`, `moneda`
- `provider_payment_id`
- `payload_json`
- `created_at`, `updated_at`

### `movimientos_stock`
- `id`, `producto_id`, `orden_id` nullable
- `sucursal_id` nullable
- `tipo`: ingreso, reserva, liberacion, descuento, ajuste
- `cantidad`
- `origen`: compra, canje, admin, devolucion
- `created_by`, `created_at`

Importante: mantener `movimientos_puntos` como libro contable de puntos (ledger), no solo saldo.

---

## 4) Flujos operativos

## 4.1 Carrito unico (recomendado)
Un solo carrito para ambos mundos.

Cada item define `modo_compra`:
- dinero
- puntos

En checkout se muestran dos totales:
- total dinero
- total puntos

Ventaja:
- menos complejidad tecnica
- checkout mixto en una sola orden

## 4.2 Confirmacion de orden (atomica)
Dentro de transaccion DB:
1. validar stock disponible para todos los items
2. validar saldo de puntos del usuario (si aplica)
3. reservar stock (`stock_disponible - cantidad`, `stock_reservado + cantidad`)
4. crear `orden` y `orden_items`
5. si hay puntos, insertar `movimientos_puntos` con debito
6. si hay dinero, crear `pago` en estado iniciado

Si falla cualquier paso: rollback total.

Regla multi-sucursal:
- canje en local: reservar/descontar en la sucursal elegida para retiro
- compra online con envio: descontar del deposito e-commerce (puede ser una sucursal tecnica)
- compra online retiro en tienda: reservar en la sucursal elegida por el cliente

## 4.3 Pago
- al aprobar pago:
  - pasar reserva a descuento definitivo
  - `stock_reservado - cantidad`
  - registrar `movimientos_stock` tipo `descuento`
  - orden -> `pagada`

- si pago falla o expira:
  - liberar reserva (`stock_disponible + cantidad`, `stock_reservado - cantidad`)
  - revertir puntos si se habian debitado
  - orden -> `cancelada` o `expirada`

## 4.4 Canje sin dinero
- mismo flujo de orden pero sin pasarela de pago
- valida puntos y stock
- descuenta puntos
- deja orden en `preparada` o `pendiente_retiro`
- se mantiene `codigo_retiro` para UX de canje

---

## 5) UX separada del e-commerce (lo que pediste)

## 5.1 Estructura de navegacion
Separar en menu principal:
- `Tienda Online`
- `Canjes con Puntos`
- `Mi cuenta`

Ambas experiencias usan el mismo usuario, catalogo y stock.

## 5.2 Experiencia "Tienda Online"
Pantallas:
1. Home tienda (promos, destacados, categorias)
2. Catalogo de venta (solo `venta` y `mixto`)
3. Ficha producto (precio dinero, stock, envio/retiro)
4. Carrito tienda
5. Checkout pago
6. Confirmacion de compra
7. Mis pedidos

Mensajes clave:
- "Stock disponible"
- "Pago seguro"
- "Seguimiento de pedido"

## 5.3 Experiencia "Canjes con Puntos"
Pantallas:
1. Home canjes (saldo, sugeridos por puntos)
2. Catalogo de canjes (solo `canje` y `mixto`)
3. Ficha producto canje (costo en puntos + stock)
4. Carrito canje
5. Confirmacion de canje
6. Codigo de retiro y vencimiento
7. Mis canjes / historial

Mensajes clave:
- "Tus puntos disponibles"
- "Te faltan X puntos"
- "Retira antes de fecha limite"

## 5.4 Reglas UX importantes
- No mezclar visualmente checkout de dinero con canje puro.
- Si se permite carrito mixto:
  - mostrar resumen dual muy claro (dinero + puntos)
  - boton final: "Confirmar compra y canje"
- Si se busca simplicidad inicial:
  - bloquear carrito mixto en fase 1
  - permitir solo un tipo por checkout

## 5.5 Explicacion para cliente: que significa "stock reservado"
Texto sugerido para ayuda/FAQ en frontend:

"Cuando confirmas una compra o canje, el sistema te guarda esas unidades por unos minutos para que nadie mas te las gane mientras terminas el proceso. A eso le llamamos stock reservado."

"Si completas el pago (o confirmas el canje), la reserva se transforma en compra/canje final. Si cancelas o se vence el tiempo, esas unidades vuelven a estar disponibles para otros clientes."

Mensajes UX recomendados:
- "Te reservamos este producto por 10:00 minutos."
- "Tu reserva vencio. Las unidades volvieron al stock disponible."
- "No te preocupes: si no finalizas, el producto vuelve automaticamente al catalogo."

## 5.6 Perfil de cliente: cuando pedir datos personales
Para reducir friccion de registro:
- En registro normal/Google solo pedir nombre, email y password.
- No forzar `dni`, `fecha_nacimiento`, `localidad`, `provincia` en el alta inicial.

Cuándo se solicitan/validan:
- Al momento de completar perfil para operar checkout.
- Al confirmar compra online (`checkout/preview` y `checkout/confirm`), validar obligatorios:
  - `dni`
  - `fecha_nacimiento` (edad minima: 13)
  - `localidad`
  - `provincia`

Nota de UX:
- Si faltan datos, mostrar mensaje claro y CTA directo a "Mi perfil".

---

## 6) Admin y operacion

## 6.1 Backoffice productos
Agregar en ABM:
- tipo de producto (canje/venta/mixto)
- precio dinero
- precio puntos
- stock actual
- stock reservado
- activo

## 6.2 Backoffice ordenes
Vista unificada con filtros:
- tipo: compra, canje, mixta
- estado
- fecha
- usuario

## 6.3 Backoffice inventario
- kardex por producto (`movimientos_stock`)
- vista por sucursal/local (`inventario_sucursal`)
- alertas de bajo stock
- ajustes manuales auditados

---

## 7) Integracion tecnica (API)
Rutas nuevas sugeridas:
- `POST /carrito/items`
- `PATCH /carrito/items/:id`
- `DELETE /carrito/items/:id`
- `GET /checkout/payment-options`
- `POST /checkout/preview`
- `POST /checkout/confirm`
- `POST /pagos/webhook/:proveedor`
- `GET /ordenes/mias`
- `GET /ordenes/:id`

Regla de oro:
- toda confirmacion de orden/pago/canje en transaccion de DB
- nunca descontar stock sin registrar `movimientos_stock`
- nunca mover puntos sin `movimientos_puntos`

---

## 8) Plan por fases (para bajar riesgo)

## Fase 0 - Preparacion
- definir estados finales de orden y canje
- definir proveedor de pagos
- cerrar reglas de negocio (devoluciones, vencimientos, etc)

## Fase 1 - Base de datos
- migraciones de `productos`
- crear tablas de carrito/ordenes/pagos/movimientos_stock
- indices y constraints de integridad

## Fase 2 - Backend
- servicios de stock (reserva/liberacion/descuento)
- servicio de checkout atomico
- webhooks de pago
- auditoria y logs

## Fase 3 - Frontend UX separada
- modulo Tienda Online
- modulo Canjes
- dashboard "Mis pedidos" + "Mis canjes"

## Fase 4 - Admin operativo
- panel de inventario
- panel de ordenes
- reportes (ventas, canjes, rotacion, puntos)

## Fase 5 - Endurecimiento
- pruebas de concurrencia (evitar sobreventa)
- pruebas de rollback de pago
- pruebas de consistencia stock/puntos

---

## 9) Riesgos y como evitarlos
- Riesgo: sobreventa por concurrencia.
  - Mitigacion: reservas atomicas + locks + transacciones.
- Riesgo: puntos descontados sin orden valida.
  - Mitigacion: ledger + rollback transaccional.
- Riesgo: UX confusa por mezclar compra/canje.
  - Mitigacion: frontend separado por modulo y lenguaje claro.

---

## 10) Recomendacion final para tu caso
Como ya tenes canjes funcionando:
1. conservar `productos` como catalogo unico
2. agregar stock real y modo de producto
3. sumar capa de carrito/orden/pago
4. separar UX en dos modulos visibles:
   - Tienda Online
   - Canjes con Puntos

Con eso no rompes tu sistema actual y evolucionas a e-commerce de forma ordenada.

---

## 11) Configuracion de pagos (MercadoPago + Pagos360)
Estrategia definida:
- `MercadoPago Wallet` para pago rapido.
- `Pagos360 QR` como alternativa.
- `Pagos360 Tarjeta` como alternativa de credito/debito.

Variables recomendadas en `backend/.env`:
- `MERCADOPAGO_ACCESS_TOKEN=...`
- `MERCADOPAGO_API_BASE=https://api.mercadopago.com`
- `MERCADOPAGO_WEBHOOK_URL=https://tu-dominio.com/api/pagos/webhook/mercadopago` (opcional por ahora)
- `PAGOS360_API_KEY=...`
- `PAGOS360_API_BASE=https://api.sandbox.pagos360.com` (sandbox) o `https://api.pagos360.com` (produccion)
- `PAYMENT_RETURN_SUCCESS_URL=https://tu-frontend.com/cliente`
- `PAYMENT_RETURN_PENDING_URL=https://tu-frontend.com/cliente`
- `PAYMENT_RETURN_FAILURE_URL=https://tu-frontend.com/cliente`
