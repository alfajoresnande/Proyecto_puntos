"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toPendingCheckoutRouteId = toPendingCheckoutRouteId;
exports.isPendingCheckoutRouteId = isPendingCheckoutRouteId;
exports.routeIdToPendingCheckoutId = routeIdToPendingCheckoutId;
exports.buildPendingCheckoutExternalReference = buildPendingCheckoutExternalReference;
exports.parsePendingCheckoutIdFromReference = parsePendingCheckoutIdFromReference;
exports.getPendingCheckoutForUser = getPendingCheckoutForUser;
exports.getPendingCheckoutByPaymentReference = getPendingCheckoutByPaymentReference;
exports.createPendingCheckout = createPendingCheckout;
exports.updatePendingCheckoutPayment = updatePendingCheckoutPayment;
exports.cancelOpenPendingCheckoutsForUser = cancelOpenPendingCheckoutsForUser;
exports.approvePendingCheckoutAndCreateOrder = approvePendingCheckoutAndCreateOrder;
exports.rejectOrExpirePendingCheckout = rejectOrExpirePendingCheckout;
const db_1 = require("../db");
const points_1 = require("./points");
const paymentFees_1 = require("./paymentFees");
const stock_1 = require("./stock");
function toMoney(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}
function asObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function parseItemsJson(value) {
    try {
        const parsed = JSON.parse(value);
        if (!Array.isArray(parsed))
            return [];
        return parsed.map((item) => ({
            producto_id: Number(item?.producto_id),
            cantidad: Number(item?.cantidad),
            modo_compra: item?.modo_compra === "puntos" ? "puntos" : "dinero",
            config_hash: String(item?.config_hash ?? ""),
            precio_dinero_unit: item?.precio_dinero_unit === null || item?.precio_dinero_unit === undefined ? null : Number(item.precio_dinero_unit),
            precio_puntos_unit: item?.precio_puntos_unit === null || item?.precio_puntos_unit === undefined ? null : Number(item.precio_puntos_unit),
            subtotal_dinero: Number(item?.subtotal_dinero ?? 0),
            subtotal_puntos: Number(item?.subtotal_puntos ?? 0),
            track_stock: Number(item?.track_stock ?? 0),
            puntaje_al_comprar_unitario: Number(item?.puntaje_al_comprar_unitario ?? 0),
            nombre: String(item?.nombre ?? ""),
            sabores: Array.isArray(item?.sabores)
                ? item.sabores.map((flavor) => ({
                    sabor_id: Number(flavor?.sabor_id),
                    nombre: String(flavor?.nombre ?? ""),
                    cantidad: Number(flavor?.cantidad ?? 0),
                }))
                : [],
        }));
    }
    catch {
        return [];
    }
}
function normalizePendingCheckoutRow(row) {
    if (!row)
        return undefined;
    return {
        ...row,
        id: Number(row.id),
        usuario_id: Number(row.usuario_id),
        carrito_id: Number(row.carrito_id),
        orden_id: row.orden_id === null ? null : Number(row.orden_id),
        sucursal_retiro_id: row.sucursal_retiro_id === null ? null : Number(row.sucursal_retiro_id),
        envio_zona_id: row.envio_zona_id === null ? null : Number(row.envio_zona_id),
        envio_costo: Number(row.envio_costo ?? 0),
        total_dinero: Number(row.total_dinero ?? 0),
        total_puntos: Number(row.total_puntos ?? 0),
        total_puntos_ganados: Number(row.total_puntos_ganados ?? 0),
        comision_porcentaje: row.comision_porcentaje === null ? null : Number(row.comision_porcentaje),
        comision_monto: row.comision_monto === null ? null : Number(row.comision_monto),
        monto_neto: row.monto_neto === null ? null : Number(row.monto_neto),
    };
}
function checkoutStockItems(items, descripcion) {
    return items
        .filter((item) => Number(item.track_stock ?? 0) === 1)
        .map((item) => ({
        producto_id: Number(item.producto_id),
        cantidad: Number(item.cantidad),
        origen: "compra",
        descripcion,
    }));
}
function checkoutFlavorStockItems(items, descripcion) {
    return items.flatMap((item) => item.sabores.map((sabor) => ({
        sabor_id: Number(sabor.sabor_id),
        cantidad: Number(sabor.cantidad),
        origen: "compra",
        descripcion,
    })));
}
function toPendingCheckoutRouteId(checkoutId) {
    return -Math.abs(Number(checkoutId));
}
function isPendingCheckoutRouteId(routeId) {
    return Number(routeId) < 0;
}
function routeIdToPendingCheckoutId(routeId) {
    return Math.abs(Number(routeId));
}
function buildPendingCheckoutExternalReference(checkoutId) {
    return `checkout_${Math.trunc(checkoutId)}`;
}
function parsePendingCheckoutIdFromReference(reference) {
    const normalized = String(reference ?? "").trim();
    if (!normalized)
        return null;
    const direct = Number(normalized);
    if (Number.isInteger(direct) && direct < 0)
        return Math.abs(direct);
    const match = normalized.match(/(?:checkout|pago|payment)[_-]?(\d+)/i);
    if (!match)
        return null;
    const parsed = Number(match[1]);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
async function getPendingCheckoutForUser(conn, checkoutId, usuarioId, { forUpdate = false } = {}) {
    const row = await (0, db_1.qOne)(conn, `SELECT *
     FROM checkout_pendientes
     WHERE id = ? AND usuario_id = ?
     LIMIT 1
     ${forUpdate ? "FOR UPDATE" : ""}`, [checkoutId, usuarioId]);
    return normalizePendingCheckoutRow(row);
}
async function getPendingCheckoutByPaymentReference(conn, providerPaymentId, { forUpdate = false } = {}) {
    const row = await (0, db_1.qOne)(conn, `SELECT *
     FROM checkout_pendientes
     WHERE provider_payment_id = ?
     ORDER BY updated_at DESC, id DESC
     LIMIT 1
     ${forUpdate ? "FOR UPDATE" : ""}`, [providerPaymentId]);
    return normalizePendingCheckoutRow(row);
}
async function createPendingCheckout(conn, input) {
    const created = await (0, db_1.qRun)(conn, `INSERT INTO checkout_pendientes (
       usuario_id, carrito_id, estado, metodo_entrega, sucursal_retiro_id, direccion_envio_json, envio_zona_id,
       envio_costo, envio_cotizacion_json, notas, moneda, total_dinero, total_puntos, total_puntos_ganados,
       proveedor, metodo, items_json
     ) VALUES (?, ?, 'pendiente_pago', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        input.usuarioId,
        input.carritoId,
        input.metodoEntrega,
        input.sucursalRetiroId,
        input.direccionEnvioJson,
        input.envioZonaId,
        toMoney(input.envioCosto),
        input.envioCotizacionJson,
        input.notas,
        input.moneda || "ARS",
        toMoney(input.totalDinero),
        Number(input.totalPuntos ?? 0),
        Number(input.totalPuntosGanados ?? 0),
        input.proveedor,
        input.metodo,
        JSON.stringify(input.items),
    ]);
    return Number(created.insertId);
}
async function updatePendingCheckoutPayment(conn, input) {
    await (0, db_1.qRun)(conn, `UPDATE checkout_pendientes
     SET proveedor = ?,
         metodo = ?,
         pago_estado = ?,
         comision_porcentaje = ?,
         comision_monto = ?,
         monto_neto = ?,
         provider_payment_id = ?,
         checkout_url = ?,
         payload_json = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`, [
        input.proveedor,
        input.metodo,
        input.pagoEstado ?? "iniciado",
        input.comisionPorcentaje ?? null,
        input.comisionMonto ?? null,
        input.montoNeto ?? null,
        input.providerPaymentId ?? null,
        input.checkoutUrl ?? null,
        input.payload === undefined ? null : JSON.stringify(input.payload),
        input.checkoutId,
    ]);
}
async function releasePendingCheckoutReservations(conn, checkout, nextState, creadoPor = null) {
    if (!checkout.sucursal_retiro_id)
        return;
    const items = parseItemsJson(checkout.items_json);
    const stockItems = checkoutStockItems(items, `${nextState} checkout #${checkout.id}`);
    const flavorItems = checkoutFlavorStockItems(items, `${nextState} checkout #${checkout.id}`);
    if (stockItems.length) {
        await (0, stock_1.releaseStockForCheckoutItems)(conn, {
            sucursalId: checkout.sucursal_retiro_id,
            items: stockItems,
            referencia: `checkout #${checkout.id}`,
            creadoPor,
            ordenId: null,
        });
    }
    if (flavorItems.length) {
        await (0, stock_1.releaseFlavorStockForCheckoutItems)(conn, {
            sucursalId: checkout.sucursal_retiro_id,
            items: flavorItems,
            referencia: `checkout #${checkout.id}`,
            creadoPor,
            ordenId: null,
        });
    }
}
async function cancelOpenPendingCheckoutsForUser(conn, usuarioId, { exceptCheckoutId = null } = {}) {
    const params = [usuarioId];
    const exceptSql = exceptCheckoutId ? "AND id <> ?" : "";
    if (exceptCheckoutId)
        params.push(exceptCheckoutId);
    const rows = await (async () => {
        const result = await conn.query(`SELECT *
       FROM checkout_pendientes
       WHERE usuario_id = ?
         AND estado = 'pendiente_pago'
         ${exceptSql}
       ORDER BY id ASC
       FOR UPDATE`, params);
        return result[0];
    })();
    for (const raw of rows) {
        const checkout = normalizePendingCheckoutRow(raw);
        if (!checkout)
            continue;
        await releasePendingCheckoutReservations(conn, checkout, "cancelada");
        await (0, db_1.qRun)(conn, `UPDATE checkout_pendientes
       SET estado = 'cancelada',
           pago_estado = CASE WHEN pago_estado = 'aprobado' THEN pago_estado ELSE 'rechazado' END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`, [checkout.id]);
    }
}
async function decrementCartItemFlavorQuantities(conn, cartItemId, purchasedFlavors) {
    for (const flavor of purchasedFlavors) {
        const existing = await (0, db_1.qOne)(conn, `SELECT id, cantidad
       FROM carrito_item_sabores
       WHERE carrito_item_id = ? AND sabor_id = ?
       LIMIT 1
       FOR UPDATE`, [cartItemId, Number(flavor.sabor_id)]);
        if (!existing)
            continue;
        const nextQty = Number(existing.cantidad ?? 0) - Number(flavor.cantidad ?? 0);
        if (nextQty > 0) {
            await (0, db_1.qRun)(conn, "UPDATE carrito_item_sabores SET cantidad = ? WHERE id = ?", [nextQty, Number(existing.id)]);
        }
        else {
            await (0, db_1.qRun)(conn, "DELETE FROM carrito_item_sabores WHERE id = ?", [Number(existing.id)]);
        }
    }
}
async function removePurchasedItemsFromCart(conn, carritoId, items) {
    for (const item of items) {
        const cartItem = await (0, db_1.qOne)(conn, `SELECT id, cantidad, precio_dinero_unit, precio_puntos_unit, subtotal_dinero, subtotal_puntos
       FROM carrito_items
       WHERE carrito_id = ? AND producto_id = ? AND modo_compra = ? AND config_hash = ?
       LIMIT 1
       FOR UPDATE`, [carritoId, item.producto_id, item.modo_compra, item.config_hash ?? ""]);
        if (!cartItem)
            continue;
        const remainingQty = Number(cartItem.cantidad ?? 0) - Number(item.cantidad ?? 0);
        if (remainingQty <= 0) {
            await (0, db_1.qRun)(conn, "DELETE FROM carrito_items WHERE id = ?", [Number(cartItem.id)]);
            continue;
        }
        const nextSubtotalDinero = item.precio_dinero_unit === null ? 0 : toMoney(Number(cartItem.precio_dinero_unit ?? 0) * remainingQty);
        const nextSubtotalPuntos = item.precio_puntos_unit === null ? 0 : Number(cartItem.precio_puntos_unit ?? 0) * remainingQty;
        await (0, db_1.qRun)(conn, `UPDATE carrito_items
       SET cantidad = ?, subtotal_dinero = ?, subtotal_puntos = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`, [remainingQty, nextSubtotalDinero, nextSubtotalPuntos, Number(cartItem.id)]);
        if (item.sabores.length) {
            await decrementCartItemFlavorQuantities(conn, Number(cartItem.id), item.sabores);
        }
    }
    await (0, db_1.qRun)(conn, "UPDATE carritos SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", [carritoId]);
}
async function approvePendingCheckoutAndCreateOrder(conn, input) {
    const checkout = await (0, db_1.qOne)(conn, `SELECT *
     FROM checkout_pendientes
     WHERE id = ?
     LIMIT 1
     FOR UPDATE`, [input.checkoutId]);
    const pending = normalizePendingCheckoutRow(checkout);
    if (!pending) {
        throw new Error("Checkout pendiente no encontrado.");
    }
    if (pending.orden_id) {
        return { orderId: pending.orden_id, alreadyApproved: true };
    }
    if (pending.estado !== "pendiente_pago") {
        throw new Error(`El checkout pendiente ya no se puede aprobar porque esta en estado '${pending.estado}'.`);
    }
    const items = parseItemsJson(pending.items_json);
    if (!items.length) {
        throw new Error("El checkout pendiente no tiene items validos para crear la orden.");
    }
    const insertedOrder = await (0, db_1.qRun)(conn, `INSERT INTO ordenes
      (usuario_id, carrito_id, canal, tipo_orden, estado, moneda, total_dinero, total_puntos,
       direccion_envio_json, sucursal_retiro_id, envio_zona_id, envio_costo, envio_cotizacion_json, notas)
     VALUES (?, ?, 'web', 'venta', 'pagada', ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        pending.usuario_id,
        pending.carrito_id,
        pending.moneda || "ARS",
        pending.total_dinero,
        pending.total_puntos,
        pending.direccion_envio_json,
        pending.sucursal_retiro_id,
        pending.envio_zona_id,
        pending.envio_costo,
        pending.envio_cotizacion_json,
        pending.notas,
    ]);
    const orderId = Number(insertedOrder.insertId);
    for (const item of items) {
        const insertedItem = await (0, db_1.qRun)(conn, `INSERT INTO orden_items
        (orden_id, producto_id, cantidad, modo_compra, config_hash, precio_dinero_unit, precio_puntos_unit, subtotal_dinero, subtotal_puntos, puntaje_al_comprar_unitario)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
            orderId,
            item.producto_id,
            item.cantidad,
            item.modo_compra,
            item.config_hash ?? "",
            item.precio_dinero_unit,
            item.precio_puntos_unit,
            item.subtotal_dinero,
            item.subtotal_puntos,
            item.puntaje_al_comprar_unitario ?? 0,
        ]);
        for (const sabor of item.sabores) {
            await (0, db_1.qRun)(conn, `INSERT INTO orden_item_sabores (orden_item_id, sabor_id, sabor_nombre, cantidad)
         VALUES (?, ?, ?, ?)`, [insertedItem.insertId, sabor.sabor_id, sabor.nombre, sabor.cantidad]);
        }
    }
    if (pending.sucursal_retiro_id) {
        const stockItems = checkoutStockItems(items, `Pago aprobado checkout #${pending.id}`);
        const flavorItems = checkoutFlavorStockItems(items, `Pago aprobado checkout #${pending.id}`);
        if (stockItems.length) {
            await (0, stock_1.finalizeStockForCheckoutItems)(conn, {
                sucursalId: pending.sucursal_retiro_id,
                items: stockItems,
                referencia: `checkout #${pending.id}`,
                ordenId: orderId,
            });
        }
        if (flavorItems.length) {
            await (0, stock_1.finalizeFlavorStockForCheckoutItems)(conn, {
                sucursalId: pending.sucursal_retiro_id,
                items: flavorItems,
                referencia: `checkout #${pending.id}`,
                ordenId: orderId,
            });
        }
    }
    const comision = pending.comision_porcentaje === null || pending.comision_monto === null || pending.monto_neto === null
        ? await (0, paymentFees_1.resolvePaymentFee)(conn, {
            proveedor: pending.proveedor,
            metodo: pending.metodo,
            monto: pending.total_dinero,
        })
        : {
            porcentaje: Number(pending.comision_porcentaje ?? 0),
            montoComision: Number(pending.comision_monto ?? 0),
            montoNeto: Number(pending.monto_neto ?? pending.total_dinero),
            descripcion: null,
        };
    await (0, db_1.qRun)(conn, `INSERT INTO pagos (
       orden_id, proveedor, metodo, estado, monto, comision_porcentaje, comision_monto, monto_neto,
       moneda, provider_payment_id, checkout_url, payload_json
     ) VALUES (?, ?, ?, 'aprobado', ?, ?, ?, ?, ?, ?, ?, ?)`, [
        orderId,
        pending.proveedor,
        pending.metodo,
        pending.total_dinero,
        comision.porcentaje,
        comision.montoComision,
        comision.montoNeto,
        pending.moneda || "ARS",
        input.providerPaymentId ?? pending.provider_payment_id ?? null,
        pending.checkout_url,
        input.payload === undefined ? pending.payload_json : JSON.stringify(input.payload),
    ]);
    await (0, db_1.qRun)(conn, `UPDATE checkout_pendientes
     SET estado = 'pagada',
         pago_estado = 'aprobado',
         orden_id = ?,
         provider_payment_id = COALESCE(?, provider_payment_id),
         payload_json = COALESCE(?, payload_json),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`, [
        orderId,
        input.providerPaymentId ?? null,
        input.payload === undefined ? null : JSON.stringify(input.payload),
        pending.id,
    ]);
    await (0, points_1.acreditarPuntosPorCompra)(conn, orderId);
    await removePurchasedItemsFromCart(conn, pending.carrito_id, items);
    return { orderId, alreadyApproved: false };
}
async function rejectOrExpirePendingCheckout(conn, { checkoutId, nextState, providerPaymentId = null, payload, }) {
    const checkout = await (0, db_1.qOne)(conn, `SELECT *
     FROM checkout_pendientes
     WHERE id = ?
     LIMIT 1
     FOR UPDATE`, [checkoutId]);
    const pending = normalizePendingCheckoutRow(checkout);
    if (!pending) {
        throw new Error("Checkout pendiente no encontrado.");
    }
    if (pending.orden_id || pending.estado === "pagada") {
        return;
    }
    if (pending.estado !== "pendiente_pago") {
        return;
    }
    await releasePendingCheckoutReservations(conn, pending, nextState);
    await (0, db_1.qRun)(conn, `UPDATE checkout_pendientes
     SET estado = ?,
         pago_estado = 'rechazado',
         provider_payment_id = COALESCE(?, provider_payment_id),
         payload_json = COALESCE(?, payload_json),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`, [
        nextState,
        providerPaymentId,
        payload === undefined ? null : JSON.stringify(payload),
        pending.id,
    ]);
}
