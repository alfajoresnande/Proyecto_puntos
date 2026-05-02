# Explicacion simple: producto + stock por sucursal

## Idea principal
No duplicamos productos por cada local.

- `productos` guarda el catalogo unico (nombre, precios, tipo, etc).
- `inventario_sucursal` guarda cuantas unidades hay de ese producto en cada sucursal.

Eso evita tener 700 productos repetidos con el mismo nombre/precio.

## Como se ve en la base

## Tabla `productos`
Una sola fila por producto logico.

Ejemplo:
- `id=1, nombre='Alfajor 70%', tipo_producto='mixto', precio_dinero=2500, puntos_para_canjear=1200`

## Tabla `sucursales`
Una fila por sucursal fisica.

Ejemplo:
- `id=1, nombre='Sucursal Centro', localidad='Corrientes', provincia='Corrientes'`
- `id=2, nombre='Sucursal Norte', localidad='Resistencia', provincia='Chaco'`

## Tabla `inventario_sucursal`
Una fila por combinacion `(producto_id, sucursal_id)`.

Ejemplo:
- `producto_id=1, sucursal_id=1, stock_disponible=5, stock_reservado=1`
- `producto_id=1, sucursal_id=2, stock_disponible=8, stock_reservado=0`

## Equivalencia con la idea de "700 productos"
Tu idea de crear muchas filas (producto por sucursal) se transforma asi:

- No se crean 700 filas en `productos`.
- Se crean 700 filas en `inventario_sucursal`.

Ventaja: catalogo limpio y stock distribuido por local.

## Por que no conviene duplicar producto por sucursal
Si duplicas productos:
- cambias nombre/precio en muchas filas
- mayor riesgo de inconsistencias
- reportes y mantenimiento mas complejos

Con tabla intermedia:
- nombre/precio se actualiza 1 sola vez
- stock se controla por sucursal
- reportes de inventario salen directos por local

## Reglas clave de negocio
1. `stock_disponible`: unidades libres para vender/canjear.
2. `stock_reservado`: unidades apartadas temporalmente (checkout/canje pendiente).
3. Al confirmar pedido/canje: reservado pasa a descuento final.
4. Si se cancela/expira: reservado vuelve a disponible.

## Campos de producto definidos para este proyecto
- `puntos_para_canjear` (nombre claro para canje)
- `puntaje_al_comprar` (puntos que gana el cliente al comprar)
- `precio_dinero` (compra online)
- `tipo_producto` (`canje`, `venta`, `mixto`)

## Usuarios
Se agregaron estos datos al usuario:
- `fecha_nacimiento` (validacion minima: 13 anos)
- `localidad`
- `provincia`

Regla UX/negocio aplicada:
- En registro normal o Google, estos campos pueden quedar vacios.
- Se solicitan/completan junto con `dni` en "Mi perfil".
- Se validan como obligatorios recien al confirmar compra online (`checkout`).
