# Guia operativa de stock y sabores

Esta guia explica como administrar el stock de productos, sabores y cajas armadas por el cliente. Esta pensada para administradores y vendedores que necesitan entender que pasa cuando cargan inventario, reciben compras, entregan pedidos o corrigen cantidades.

## Conceptos principales

### Stock disponible

Es la cantidad que todavia se puede vender, canjear o reservar en una sucursal.

Ejemplo:

- Stock disponible: `40`
- El cliente intenta comprar `60`
- El sistema permite como maximo `40`

Si el producto controla stock y llega a `0`, deja de mostrarse en el catalogo o tienda para esa sucursal.

### Stock reservado

Es stock que ya fue apartado para una operacion pendiente.

Ejemplo:

- Habia `40` disponibles.
- Un cliente confirma un pedido de `6` en efectivo o pendiente de pago.
- Quedan `34` disponibles y `6` reservados.

El reservado todavia no desaparecio definitivamente del inventario: esta esperando que la compra se apruebe, se entregue, se cancele o expire.

### Stock sin control

Cuando un producto figura como `Stock sin control`, el sistema no descuenta ni reserva unidades de ese producto.

En la practica funciona como stock infinito para ese producto. Se usa para casos donde no se quiere administrar inventario unidad por unidad.

Importante:

- Un producto sin control se muestra aunque el stock numerico sea `0`.
- No se puede ajustar stock desde inventario para ese producto, porque justamente no usa control de stock.
- Si hay limite de compra por perfil, ese limite sigue aplicando aunque el stock sea sin control.

## Tipos de producto

### Producto simple

Es un producto que se compra o canjea como unidad directa.

Ejemplos:

- Agua con gas
- Alfajor individual
- Caja cerrada sin eleccion de sabores

Si tiene control de stock, el sistema usa el inventario del producto por sucursal.

### Caja de sabores

Es una caja que el cliente arma eligiendo sabores.

Ejemplo:

- Caja Premium x 6
- Capacidad: `6`
- Sabores disponibles: chocolate, coco, guayaba, etc.

En este caso el producto caja aparece como `Stock sin control`, porque el stock real no esta en la caja sino en cada sabor.

La caja se puede comprar si hay suficientes unidades de sabores para completar la capacidad de la caja.

Ejemplo:

- Caja x 6
- Chocolate disponible: `2`
- Coco disponible: `3`
- Guayaba disponible: `1`
- Total seleccionable: `6`
- La caja se puede comprar si el cliente selecciona exactamente `6` sabores respetando el stock de cada sabor.

## Visibilidad en catalogo y tienda

### Producto simple con control de stock

Se muestra si tiene stock disponible mayor a `0` en la sucursal seleccionada.

No se muestra si:

- El producto esta inactivo.
- No tiene stock disponible.
- No corresponde al modo del catalogo: venta, canje o mixto.

### Producto simple sin control de stock

Se muestra aunque el stock numerico sea `0`, siempre que este activo y corresponda al modo del catalogo.

### Caja de sabores

No depende del stock general de la caja. Depende de los sabores.

Se muestra si:

- La caja esta activa.
- Tiene capacidad configurada.
- Tiene sabores activos asignados.
- Hay stock suficiente de sabores para completar una caja.

No se muestra si:

- La capacidad no esta configurada.
- No hay sabores suficientes para completar la caja.
- Los sabores asignados estan inactivos o sin stock.

## Limites de compra

El sistema puede tener limites por perfil comercial:

- Cliente comun
- Mayorista
- Empleado

El limite define cuantas unidades puede comprar o canjear un usuario por producto.

Si el producto controla stock, manda el menor valor entre:

- Stock disponible
- Limite del perfil

Ejemplos:

| Stock disponible | Limite perfil | Maximo comprable |
| --- | --- | --- |
| 40 | 100 | 40 |
| 300 | 100 | 100 |
| 300 | 0, sin tope comercial | 300 |

Si el producto no controla stock, no hay stock real que limite la compra. En ese caso manda el limite del perfil.

## Que pasa durante una compra online

### 1. El cliente agrega al carrito

Agregar al carrito no descuenta stock definitivamente.

Para productos simples con control de stock:

- El sistema valida que haya stock disponible en la sucursal elegida.
- Si el cliente intenta superar el stock, el input baja al maximo permitido.
- Si el recorte fue por stock, se muestra un aviso indicando el stock maximo disponible en ese momento.

Para cajas de sabores:

- El cliente debe elegir exactamente la cantidad de sabores que pide la caja.
- Cada sabor no puede superar su stock disponible.

### 2. El cliente confirma el pedido

Cuando el pedido queda pendiente de pago o pendiente de retiro, el sistema reserva stock.

Producto simple:

- Baja `stock_disponible`.
- Sube `stock_reservado`.

Caja de sabores:

- Baja el `stock_disponible` de cada sabor elegido.
- Sube el `stock_reservado` de cada sabor elegido.

### 3. El pago se aprueba o el pedido se marca como pagado

El stock reservado se descuenta definitivamente.

Producto simple:

- Baja `stock_reservado`.
- El disponible ya habia bajado al reservar.

Caja de sabores:

- Baja `stock_reservado` de cada sabor elegido.

### 4. El pedido se cancela o expira antes de concretarse

El sistema libera la reserva.

Producto simple:

- Sube `stock_disponible`.
- Baja `stock_reservado`.

Caja de sabores:

- Sube `stock_disponible` del sabor.
- Baja `stock_reservado` del sabor.

### 5. El pedido se cancela despues de estar pagado

El sistema restaura stock como devolucion.

Producto simple:

- Sube `stock_disponible`.

Caja de sabores:

- Sube `stock_disponible` de cada sabor que estaba en la caja.

## Que pasa durante un canje

El canje usa una logica similar a la compra, pero con puntos.

Cuando el cliente confirma el canje:

- Se validan puntos.
- Se valida stock.
- Se reserva stock.
- Se descuentan los puntos.

Si el canje se entrega:

- El stock reservado se descuenta definitivamente.

Si el canje se cancela, expira o se marca como no disponible:

- Se libera la reserva.
- Se devuelven los puntos cuando corresponde.

## Ventas locales desde admin o vendedor

Las ventas locales descuentan stock al registrar/finalizar la venta.

Para productos simples:

- Si el producto controla stock, se descuenta del inventario de la sucursal.
- Si el producto no controla stock, no se descuenta.

Para cajas de sabores:

- Se descuentan los sabores elegidos.
- La caja en si no descuenta stock general.

Si se cancela una venta local, el sistema restaura stock cuando corresponde.

## Administracion de productos

### Crear producto simple con stock

Usar esta opcion para productos que se controlan unidad por unidad.

Checklist:

- Producto activo.
- Tipo correcto: venta, canje o mixto.
- Controlar stock activado.
- Stock cargado por sucursal.
- Precio o puntos segun corresponda.

### Crear producto simple sin control de stock

Usar esta opcion para productos que no necesitan inventario.

Checklist:

- Producto activo.
- Controlar stock desactivado.
- No depender del stock numerico para mostrarlo.

### Crear caja de sabores

Usar esta opcion cuando el cliente debe elegir sabores.

Checklist:

- Marcar el producto como caja de sabores.
- Definir capacidad: por ejemplo `6`, `12`, `24`.
- Asignar sabores activos.
- Cargar stock de cada sabor por sucursal.
- Verificar que los sabores sumen suficiente stock para completar una caja.

Nota importante:

Una caja de sabores queda con stock del producto sin control porque el control real esta en los sabores.

## Administracion de sabores

Cada sabor tiene inventario propio por sucursal.

Ejemplo:

| Sabor | Sucursal | Disponible | Reservado |
| --- | --- | ---: | ---: |
| Chocolate | Centro | 30 | 6 |
| Coco | Centro | 12 | 0 |
| Guayaba | Centro | 0 | 0 |

Si un sabor esta en `0`, el cliente no puede elegir unidades de ese sabor.

Si no hay combinacion suficiente de sabores para completar la caja, la caja no se muestra como comprable.

## Ajustes manuales de inventario

Cuando se ajusta stock desde el panel, el valor que se carga es el nuevo stock disponible.

Ejemplo:

- Antes: disponible `20`, reservado `5`.
- Admin carga nuevo disponible `40`.
- Despues: disponible `40`, reservado `5`.

Regla importante:

No se puede dejar el disponible por debajo del reservado.

Ejemplo:

- Disponible actual: `20`
- Reservado actual: `5`
- Nuevo disponible permitido: `5` o mas
- Nuevo disponible no permitido: `4`

Esto evita que el sistema quede prometiendo mas productos de los que puede cumplir.

## Movimientos de stock

El sistema registra movimientos para trazabilidad.

Tipos comunes:

| Tipo | Que significa |
| --- | --- |
| ingreso | Se agrego stock por devolucion o carga |
| ajuste | Cambio manual desde administracion |
| reserva | Stock apartado para pedido o canje |
| liberacion | Reserva cancelada o expirada |
| descuento | Stock consumido definitivamente |

Origenes comunes:

| Origen | Uso |
| --- | --- |
| compra | Compra en dinero |
| canje | Canje por puntos |
| admin | Ajuste manual |
| devolucion | Cancelacion o devolucion |

## Casos frecuentes

### "El producto tiene stock 0 y no aparece"

Si controla stock, esto es correcto. Cargar stock en la sucursal o desactivar control de stock si corresponde.

### "El producto tiene stock 0 y aparece igual"

Revisar si esta marcado como `Stock sin control`. En ese caso es correcto.

### "La caja aparece sin control de stock"

Es correcto. La caja no descuenta stock general: descuenta sabores.

### "La caja no aparece aunque esta activa"

Revisar:

- Capacidad configurada.
- Sabores asignados.
- Sabores activos.
- Stock de sabores por sucursal.
- Sucursal seleccionada en tienda/catalogo.

### "No puedo bajar el stock disponible"

Probablemente hay stock reservado. No se puede bajar disponible por debajo del reservado.

### "Un cliente escribe 60 y el sistema lo cambia a 40"

Eso pasa cuando el stock maximo disponible en ese momento es `40`. El sistema muestra un aviso indicando el maximo disponible por stock.

### "El cliente no puede comprar mas aunque haya stock"

Revisar limites por perfil en Configuracion:

- Cliente comun
- Mayorista
- Empleado

Si el limite esta en `0`, no hay tope comercial. Si tiene un numero, ese numero limita aunque haya mas stock.

## Recomendaciones operativas

- Cargar stock por sucursal antes de activar productos con control de stock.
- Para cajas, cargar primero sabores y despues verificar que la capacidad pueda completarse.
- Usar `Stock sin control` solo cuando realmente no se quiera administrar inventario.
- Revisar stock reservado antes de hacer ajustes grandes.
- No borrar o desactivar sabores usados historicamente sin revisar cajas activas.
- Si una caja deja de venderse de golpe, revisar primero el stock de sabores.
- Si hay diferencias entre stock fisico y sistema, usar ajuste manual con descripcion clara.

## Resumen rapido

- Producto simple con control: descuenta stock del producto.
- Producto simple sin control: no descuenta stock, se trata como ilimitado.
- Caja de sabores: descuenta stock de sabores, no de la caja.
- Disponible: se puede usar.
- Reservado: apartado para una operacion pendiente.
- Cancelacion o expiracion: libera o restaura stock.
- Entrega o pago aprobado: consume stock definitivamente.
- Stock 0 con control: no se muestra.
- Stock 0 sin control: se muestra.

