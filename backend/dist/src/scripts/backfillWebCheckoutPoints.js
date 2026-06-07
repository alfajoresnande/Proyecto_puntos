"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = require("../db");
const points_1 = require("../services/points");
const PAID_ORDER_STATES = ["pagada", "preparandose", "preparada", "enviada", "entregando", "entregada"];
function parseOrderIdArg(rawValue) {
    if (!rawValue)
        return null;
    const parsed = Number(rawValue);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error("Si indicas un ID de orden, debe ser un entero positivo.");
    }
    return parsed;
}
async function loadCandidateOrders(orderId) {
    const statePlaceholders = PAID_ORDER_STATES.map(() => "?").join(", ");
    const params = [...PAID_ORDER_STATES];
    let orderFilterSql = "";
    if (orderId) {
        orderFilterSql = "AND o.id = ?";
        params.push(orderId);
    }
    return (0, db_1.qAll)(db_1.pool, `SELECT o.id, o.estado, o.total_dinero
     FROM ordenes o
     LEFT JOIN movimientos_puntos mp
       ON mp.referencia_tipo = 'ordenes'
      AND mp.referencia_id = o.id
      AND mp.tipo = 'acreditacion_compra'
     WHERE o.canal = 'web'
       AND o.total_dinero > 0
       AND o.estado IN (${statePlaceholders})
       AND mp.id IS NULL
       ${orderFilterSql}
     ORDER BY o.id ASC`, params);
}
async function processOrder(orderId) {
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        await (0, points_1.acreditarPuntosPorCompra)(conn, orderId);
        await conn.commit();
        console.log(`[backfill-puntos-web] OK orden #${orderId}`);
    }
    catch (error) {
        await conn.rollback();
        throw error;
    }
    finally {
        conn.release();
    }
}
async function main() {
    const orderId = parseOrderIdArg(process.argv[2]);
    const candidates = await loadCandidateOrders(orderId);
    if (!candidates.length) {
        console.log(orderId
            ? `[backfill-puntos-web] No se encontro la orden web pagada #${orderId} con puntos faltantes.`
            : "[backfill-puntos-web] No hay ordenes web pagadas con puntos faltantes.");
        return;
    }
    console.log(`[backfill-puntos-web] Ordenes a reparar: ${candidates.length}`);
    for (const order of candidates) {
        await processOrder(Number(order.id));
    }
    console.log("[backfill-puntos-web] Finalizado.");
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[backfill-puntos-web] ERROR: ${message}`);
    process.exit(1);
});
