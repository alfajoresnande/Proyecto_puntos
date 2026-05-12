"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = require("../db");
/**
 * Script de reconciliación global de saldos de puntos.
 * Ejecuta este script para sincronizar usuarios.puntos_saldo con la suma de movimientos_puntos.
 */
async function reconcileAllUsers() {
    console.log("Starting global points reconciliation...");
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        // Query de reconciliación masiva
        const [result] = await conn.query(`
      UPDATE usuarios u
      LEFT JOIN (
        SELECT usuario_id, COALESCE(SUM(puntos), 0) AS saldo_calculado
        FROM movimientos_puntos
        GROUP BY usuario_id
      ) mp ON mp.usuario_id = u.id
      SET u.puntos_saldo = COALESCE(mp.saldo_calculado, 0)
      WHERE u.puntos_saldo <> COALESCE(mp.saldo_calculado, 0)
    `);
        const affected = result.affectedRows || 0;
        await conn.commit();
        console.log(`Reconciliation finished. Updated users: ${affected}`);
    }
    catch (err) {
        await conn.rollback();
        console.error("Error during reconciliation:", err);
    }
    finally {
        conn.release();
        process.exit(0);
    }
}
reconcileAllUsers();
