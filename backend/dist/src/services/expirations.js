"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.expireStalePendingOrders = expireStalePendingOrders;
exports.expireOverdueCanjes = expireOverdueCanjes;
exports.runReservationExpirations = runReservationExpirations;
exports.startReservationExpirationWorker = startReservationExpirationWorker;
const db_1 = require("../db");
const stock_1 = require("./stock");
const orderLifecycle_1 = require("./orderLifecycle");
const DEFAULT_CHECKOUT_RESERVATION_MINUTES = 30;
function checkoutReservationMinutes() {
    const raw = Number(process.env.CHECKOUT_RESERVATION_MINUTES ?? DEFAULT_CHECKOUT_RESERVATION_MINUTES);
    if (!Number.isFinite(raw))
        return DEFAULT_CHECKOUT_RESERVATION_MINUTES;
    return Math.max(5, Math.min(24 * 60, Math.floor(raw)));
}
async function expireStalePendingOrders() {
    const minutes = checkoutReservationMinutes();
    const rows = await (0, db_1.qAll)(db_1.pool, `SELECT id
     FROM ordenes
     WHERE estado = 'pendiente_pago'
       AND created_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)
     ORDER BY created_at ASC
     LIMIT 50`, [minutes]);
    let expired = 0;
    for (const row of rows) {
        const conn = await db_1.pool.getConnection();
        try {
            await conn.beginTransaction();
            const result = await (0, orderLifecycle_1.rejectOrExpirePendingOrder)(conn, {
                orderId: Number(row.id),
                nextState: "expirada",
            });
            await conn.commit();
            if (result.changed)
                expired += 1;
        }
        catch (err) {
            await conn.rollback();
            console.error("No se pudo expirar orden pendiente:", err instanceof Error ? err.message : err);
        }
        finally {
            conn.release();
        }
    }
    return expired;
}
async function expireOverdueCanjes() {
    const rows = await (0, db_1.qAll)(db_1.pool, `SELECT id
     FROM canjes
     WHERE estado = 'pendiente'
       AND fecha_limite_retiro < NOW()
     ORDER BY fecha_limite_retiro ASC
     LIMIT 50`);
    let expired = 0;
    for (const row of rows) {
        const conn = await db_1.pool.getConnection();
        try {
            await conn.beginTransaction();
            const canje = await (0, db_1.qOne)(conn, "SELECT id, estado, sucursal_id, producto_id FROM canjes WHERE id = ? FOR UPDATE", [Number(row.id)]);
            if (!canje || canje.estado !== "pendiente") {
                await conn.rollback();
                continue;
            }
            const items = await (0, stock_1.getCanjeItemsStock)(conn, Number(canje.id));
            const itemsForStock = items.length ? items : [{ producto_id: Number(canje.producto_id), cantidad: 1 }];
            if (Number(canje.sucursal_id) > 0) {
                await (0, stock_1.releaseReservedStockForCanje)(conn, {
                    sucursalId: Number(canje.sucursal_id),
                    items: itemsForStock,
                    canjeId: Number(canje.id),
                    strict: false,
                });
            }
            await (0, db_1.qRun)(conn, "UPDATE canjes SET estado = 'expirado', notas = COALESCE(notas, 'Canje expirado automaticamente') WHERE id = ?", [
                Number(canje.id),
            ]);
            await conn.commit();
            expired += 1;
        }
        catch (err) {
            await conn.rollback();
            console.error("No se pudo expirar canje:", err instanceof Error ? err.message : err);
        }
        finally {
            conn.release();
        }
    }
    return expired;
}
async function runReservationExpirations() {
    const [ordenesExpiradas, canjesExpirados] = await Promise.all([
        expireStalePendingOrders(),
        expireOverdueCanjes(),
    ]);
    return {
        ordenes_expiradas: ordenesExpiradas,
        canjes_expirados: canjesExpirados,
    };
}
function startReservationExpirationWorker() {
    const intervalMs = Math.max(60_000, Number(process.env.RESERVATION_EXPIRATION_INTERVAL_MS ?? 300_000));
    let running = false;
    const tick = async () => {
        if (running)
            return;
        running = true;
        try {
            await runReservationExpirations();
        }
        catch (err) {
            console.error("Expiracion de reservas:", err instanceof Error ? err.message : err);
        }
        finally {
            running = false;
        }
    };
    void tick();
    return setInterval(tick, intervalMs);
}
