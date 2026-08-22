"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cargarCuentaVigente = cargarCuentaVigente;
exports.estaRevocadoElJti = estaRevocadoElJti;
exports.revocarJti = revocarJti;
exports.invalidarTodasLasSesiones = invalidarTodasLasSesiones;
exports.purgarSesionesRevocadasVencidas = purgarSesionesRevocadasVencidas;
const db_1 = require("../db");
async function cargarCuentaVigente(usuarioId, q = db_1.pool) {
    const row = await (0, db_1.qOne)(q, "SELECT id, email, rol, activo, token_version FROM usuarios WHERE id = ? LIMIT 1", [usuarioId]);
    if (!row)
        return null;
    return {
        id: Number(row.id),
        email: String(row.email),
        rol: row.rol,
        activo: Number(row.activo) === 1,
        tokenVersion: Number(row.token_version ?? 0),
    };
}
async function estaRevocadoElJti(jti, q = db_1.pool) {
    if (!jti)
        return false;
    const row = await (0, db_1.qOne)(q, "SELECT jti FROM sesiones_revocadas WHERE jti = ? LIMIT 1", [jti]);
    return Boolean(row);
}
/** Logout de un dispositivo: invalida solo ese token. */
async function revocarJti(jti, usuarioId, expiraEn, q = db_1.pool) {
    if (!jti)
        return;
    await (0, db_1.qRun)(q, `INSERT INTO sesiones_revocadas (jti, usuario_id, expires_at)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE revocado_en = CURRENT_TIMESTAMP`, [jti, usuarioId, expiraEn]);
}
/**
 * Invalida TODAS las sesiones del usuario. Se llama al cambiar contrasena,
 * cambiar rol o desactivar la cuenta.
 */
async function invalidarTodasLasSesiones(usuarioId, q = db_1.pool) {
    await (0, db_1.qRun)(q, "UPDATE usuarios SET token_version = token_version + 1 WHERE id = ?", [usuarioId]);
}
/** Limpieza de filas vencidas: un jti caducado ya no puede usarse. */
async function purgarSesionesRevocadasVencidas(q = db_1.pool) {
    const { affectedRows } = await (0, db_1.qRun)(q, "DELETE FROM sesiones_revocadas WHERE expires_at < NOW()");
    return affectedRows;
}
