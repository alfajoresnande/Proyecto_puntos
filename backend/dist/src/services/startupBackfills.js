"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runOneTimeWebCheckoutPointsBackfill = runOneTimeWebCheckoutPointsBackfill;
exports.previewMissingWebCheckoutPointOrders = previewMissingWebCheckoutPointOrders;
const db_1 = require("../db");
const points_1 = require("./points");
const WEB_CHECKOUT_POINTS_BACKFILL_KEY = "backfill_puntos_checkout_web_20260606";
const WEB_CHECKOUT_POINTS_BACKFILL_DESCRIPTION = "Marca si ya se ejecuto el backfill unico para acreditar puntos faltantes en compras web pagadas.";
const PAID_ORDER_STATES = ["pagada", "preparandose", "preparada", "enviada", "entregando", "entregada"];
async function ensureBackfillFlagRow() {
    await (0, db_1.qRun)(db_1.pool, `INSERT INTO configuracion (clave, valor, descripcion)
     VALUES (?, '0', ?)
     ON DUPLICATE KEY UPDATE
       descripcion = COALESCE(NULLIF(VALUES(descripcion), ''), configuracion.descripcion)`, [WEB_CHECKOUT_POINTS_BACKFILL_KEY, WEB_CHECKOUT_POINTS_BACKFILL_DESCRIPTION]);
}
async function loadMissingWebCheckoutPointOrders() {
    const placeholders = PAID_ORDER_STATES.map(() => "?").join(", ");
    return (0, db_1.qAll)(db_1.pool, `SELECT o.id
     FROM ordenes o
     LEFT JOIN movimientos_puntos mp
       ON mp.referencia_tipo = 'ordenes'
      AND mp.referencia_id = o.id
      AND mp.tipo = 'acreditacion_compra'
     WHERE o.canal = 'web'
       AND o.total_dinero > 0
       AND o.estado IN (${placeholders})
       AND mp.id IS NULL
     ORDER BY o.id ASC`, [...PAID_ORDER_STATES]);
}
async function runOneTimeWebCheckoutPointsBackfill() {
    await ensureBackfillFlagRow();
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        const flag = await (0, db_1.qOne)(conn, `SELECT valor
       FROM configuracion
       WHERE clave = ?
       LIMIT 1
       FOR UPDATE`, [WEB_CHECKOUT_POINTS_BACKFILL_KEY]);
        if ((flag?.valor || "").trim() === "1") {
            await conn.rollback();
            console.log("[startup-backfill] backfill de puntos web ya ejecutado anteriormente.");
            return;
        }
        const placeholders = PAID_ORDER_STATES.map(() => "?").join(", ");
        const orders = await (0, db_1.qAll)(conn, `SELECT o.id
       FROM ordenes o
       LEFT JOIN movimientos_puntos mp
         ON mp.referencia_tipo = 'ordenes'
        AND mp.referencia_id = o.id
        AND mp.tipo = 'acreditacion_compra'
       WHERE o.canal = 'web'
         AND o.total_dinero > 0
         AND o.estado IN (${placeholders})
         AND mp.id IS NULL
       ORDER BY o.id ASC
       FOR UPDATE`, [...PAID_ORDER_STATES]);
        console.log(`[startup-backfill] ordenes web con puntos faltantes detectadas: ${orders.length}`);
        for (const order of orders) {
            await (0, points_1.acreditarPuntosPorCompra)(conn, Number(order.id));
        }
        await (0, db_1.qRun)(conn, "UPDATE configuracion SET valor = '1' WHERE clave = ?", [WEB_CHECKOUT_POINTS_BACKFILL_KEY]);
        await conn.commit();
        console.log("[startup-backfill] backfill unico de puntos web completado.");
    }
    catch (error) {
        await conn.rollback();
        throw error;
    }
    finally {
        conn.release();
    }
}
async function previewMissingWebCheckoutPointOrders() {
    const rows = await loadMissingWebCheckoutPointOrders();
    return rows.map((row) => Number(row.id));
}
