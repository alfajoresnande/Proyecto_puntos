"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrderForLifecycle = getOrderForLifecycle;
exports.approvePaidOrder = approvePaidOrder;
exports.rejectOrExpirePendingOrder = rejectOrExpirePendingOrder;
const db_1 = require("../db");
const paymentFees_1 = require("./paymentFees");
const stock_1 = require("./stock");
const points_1 = require("./points");
function checkoutStockItems(items, descripcion) {
    return items
        .filter((item) => Number(item.track_stock ?? 0) === 1)
        .map((item) => ({
        producto_id: Number(item.producto_id),
        cantidad: Number(item.cantidad),
        origen: item.modo_compra === "dinero" ? "compra" : "canje",
        descripcion,
    }));
}
function checkoutFlavorStockItems(items, descripcion) {
    return items.map((item) => ({
        sabor_id: Number(item.sabor_id),
        cantidad: Number(item.cantidad),
        origen: item.modo_compra === "dinero" ? "compra" : "canje",
        descripcion,
    }));
}
async function getOrderForLifecycle(conn, orderId) {
    const order = await (0, db_1.qOne)(conn, `SELECT id, usuario_id, estado, total_puntos, total_dinero, sucursal_retiro_id
     FROM ordenes
     WHERE id = ?
     LIMIT 1
     FOR UPDATE`, [orderId]);
    if (!order)
        return undefined;
    return {
        ...order,
        id: Number(order.id),
        usuario_id: Number(order.usuario_id),
        total_puntos: Number(order.total_puntos ?? 0),
        total_dinero: Number(order.total_dinero ?? 0),
        sucursal_retiro_id: order.sucursal_retiro_id === null ? null : Number(order.sucursal_retiro_id),
    };
}
async function getOrderStockItems(conn, orderId) {
    const rows = await (0, db_1.qAll)(conn, `SELECT oi.producto_id, oi.cantidad, oi.modo_compra, p.track_stock
     FROM orden_items oi
     JOIN productos p ON p.id = oi.producto_id
     WHERE oi.orden_id = ?
     ORDER BY oi.id ASC`, [orderId]);
    return rows.map((row) => ({
        ...row,
        producto_id: Number(row.producto_id),
        cantidad: Number(row.cantidad),
        track_stock: Number(row.track_stock ?? 0),
    }));
}
async function getOrderFlavorStockItems(conn, orderId) {
    const rows = await (0, db_1.qAll)(conn, `SELECT ois.sabor_id, ois.cantidad, oi.modo_compra
     FROM orden_item_sabores ois
     JOIN orden_items oi ON oi.id = ois.orden_item_id
     WHERE oi.orden_id = ?
     ORDER BY oi.id ASC, ois.id ASC`, [orderId]);
    return rows.map((row) => ({
        sabor_id: Number(row.sabor_id),
        cantidad: Number(row.cantidad),
        modo_compra: row.modo_compra,
    }));
}
async function updatePaymentRows(conn, { orderId, provider, providerPaymentId, estado, payload, }) {
    const isManualApproval = provider === "admin" || provider === "vendedor";
    const payloadJson = payload === undefined ? null : JSON.stringify(payload);
    const params = [estado];
    const setParts = ["estado = ?"];
    if (providerPaymentId) {
        setParts.push("provider_payment_id = ?");
        params.push(providerPaymentId);
    }
    if (payloadJson) {
        setParts.push("payload_json = ?");
        params.push(payloadJson);
    }
    params.push(orderId);
    const whereParts = ["orden_id = ?"];
    // Si no es aprobación manual, restringimos por el proveedor específico (ej. mercadopago)
    if (provider && !isManualApproval) {
        whereParts.push("proveedor = ?");
        params.push(provider);
    }
    const result = await (0, db_1.qRun)(conn, `UPDATE pagos
     SET ${setParts.join(", ")}
     WHERE ${whereParts.join(" AND ")}
       AND estado = 'iniciado'`, params);
    if (result.affectedRows === 0 && provider) {
        // Si es aprobación manual y no hay fila iniciada, creamos una de efectivo
        const effectiveProvider = isManualApproval ? "efectivo" : provider;
        const effectiveMethod = isManualApproval ? "cash" : null;
        const effectivePaymentId = providerPaymentId || (isManualApproval ? `manual_${orderId}_${Date.now()}` : null);
        if (effectivePaymentId) {
            const yaExiste = await (0, db_1.qOne)(conn, "SELECT id FROM pagos WHERE orden_id = ? AND provider_payment_id = ? AND estado = 'aprobado' LIMIT 1", [orderId, effectivePaymentId]);
            if (!yaExiste) {
                const orderAmount = await (0, db_1.qOne)(conn, "SELECT total_dinero, moneda FROM ordenes WHERE id = ? LIMIT 1", [orderId]);
                const paymentFee = await (0, paymentFees_1.resolvePaymentFee)(conn, {
                    proveedor: effectiveProvider,
                    metodo: effectiveMethod,
                    monto: Number(orderAmount?.total_dinero ?? 0),
                });
                await (0, db_1.qRun)(conn, `INSERT INTO pagos (
             orden_id, proveedor, metodo, estado, monto, comision_porcentaje, comision_monto, monto_neto,
             moneda, provider_payment_id, payload_json
           )
           SELECT id, ?, ?, ?, total_dinero, ?, ?, ?, moneda, ?, ?
           FROM ordenes
           WHERE id = ?`, [
                    effectiveProvider,
                    effectiveMethod,
                    estado,
                    paymentFee.porcentaje,
                    paymentFee.montoComision,
                    paymentFee.montoNeto,
                    effectivePaymentId,
                    payloadJson,
                    orderId,
                ]);
            }
        }
    }
}
async function refundOrderPointsIfReserved(conn, order, descripcion, creadoPor) {
    if (Number(order.total_puntos ?? 0) <= 0)
        return;
    if (!(order.estado === "pendiente_pago" || order.estado === "preparada"))
        return;
    await (0, points_1.registrarMovimientoPuntos)(conn, {
        usuarioId: order.usuario_id,
        tipo: 'devolucion_canje',
        puntos: order.total_puntos,
        descripcion,
        referenciaId: order.id,
        referenciaTipo: 'ordenes',
        creadoPor: creadoPor ?? undefined
    });
}
async function approvePaidOrder(conn, { orderId, provider, providerPaymentId, payload, creadoPor = null, }) {
    console.log("[approvePaidOrder] ejecutado", { orderId });
    const order = await getOrderForLifecycle(conn, orderId);
    if (!order) {
        throw new Error("Orden no encontrada.");
    }
    if (order.estado !== "pendiente_pago") {
        await updatePaymentRows(conn, { orderId, provider, providerPaymentId, estado: "aprobado", payload });
        console.log("[approvePaidOrder] Orden ya no estaba en pendiente_pago, verificando puntos igualmente", {
            orderId,
            estado: order.estado,
        });
        // Intentar acreditar puntos igualmente por si el proceso anterior falló (idempotente)
        await (0, points_1.acreditarPuntosPorCompra)(conn, orderId);
        return { ok: true, orderId, previousState: order.estado, state: order.estado, changed: false };
    }
    if (order.sucursal_retiro_id) {
        const items = checkoutStockItems(await getOrderStockItems(conn, orderId), `Pago aprobado orden #${orderId}`);
        const flavorItems = checkoutFlavorStockItems(await getOrderFlavorStockItems(conn, orderId), `Pago aprobado orden #${orderId}`);
        if (items.length) {
            await (0, stock_1.finalizeStockForCheckoutItems)(conn, {
                sucursalId: order.sucursal_retiro_id,
                items,
                referencia: `orden #${orderId}`,
                ordenId: orderId,
                creadoPor,
            });
        }
        if (flavorItems.length) {
            await (0, stock_1.finalizeFlavorStockForCheckoutItems)(conn, {
                sucursalId: order.sucursal_retiro_id,
                items: flavorItems,
                referencia: `orden #${orderId}`,
                ordenId: orderId,
                creadoPor,
            });
        }
    }
    await updatePaymentRows(conn, { orderId, provider, providerPaymentId, estado: "aprobado", payload });
    await (0, db_1.qRun)(conn, "UPDATE ordenes SET estado = 'pagada' WHERE id = ?", [orderId]);
    // Acreditación automática de puntos
    await (0, points_1.acreditarPuntosPorCompra)(conn, orderId);
    return { ok: true, orderId, previousState: order.estado, state: "pagada", changed: true };
}
async function rejectOrExpirePendingOrder(conn, { orderId, nextState, provider, providerPaymentId, payload, creadoPor = null, }) {
    const order = await getOrderForLifecycle(conn, orderId);
    if (!order) {
        throw new Error("Orden no encontrada.");
    }
    if (!(order.estado === "pendiente_pago" || order.estado === "preparada")) {
        await updatePaymentRows(conn, { orderId, provider, providerPaymentId, estado: "rechazado", payload });
        return { ok: true, orderId, previousState: order.estado, state: order.estado, changed: false };
    }
    if (order.sucursal_retiro_id) {
        const items = checkoutStockItems(await getOrderStockItems(conn, orderId), `${nextState} orden #${orderId}`);
        const flavorItems = checkoutFlavorStockItems(await getOrderFlavorStockItems(conn, orderId), `${nextState} orden #${orderId}`);
        if (items.length) {
            await (0, stock_1.releaseStockForCheckoutItems)(conn, {
                sucursalId: order.sucursal_retiro_id,
                items,
                referencia: `${nextState} orden #${orderId}`,
                creadoPor,
                ordenId: orderId,
            });
        }
        if (flavorItems.length) {
            await (0, stock_1.releaseFlavorStockForCheckoutItems)(conn, {
                sucursalId: order.sucursal_retiro_id,
                items: flavorItems,
                referencia: `${nextState} orden #${orderId}`,
                creadoPor,
                ordenId: orderId,
            });
        }
    }
    await refundOrderPointsIfReserved(conn, order, `Devolucion puntos por ${nextState} orden #${orderId}`, creadoPor);
    await updatePaymentRows(conn, { orderId, provider, providerPaymentId, estado: "rechazado", payload });
    await (0, db_1.qRun)(conn, "UPDATE ordenes SET estado = ? WHERE id = ?", [nextState, orderId]);
    return { ok: true, orderId, previousState: order.estado, state: nextState, changed: true };
}
