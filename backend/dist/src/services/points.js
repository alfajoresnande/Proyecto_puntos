"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PointsProgramDisabledError = void 0;
exports.isPointsProgramEnabled = isPointsProgramEnabled;
exports.getPointsProgramConfig = getPointsProgramConfig;
exports.calcularPuntosPorMontoConConfig = calcularPuntosPorMontoConConfig;
exports.calcularPuntosPorMonto = calcularPuntosPorMonto;
exports.recalcularSaldoPuntosUsuario = recalcularSaldoPuntosUsuario;
exports.registrarMovimientoPuntos = registrarMovimientoPuntos;
exports.removerPuntosAcreditadosPorCompra = removerPuntosAcreditadosPorCompra;
exports.acreditarPuntosPorCompra = acreditarPuntosPorCompra;
exports.expirarPuntosVencidos = expirarPuntosVencidos;
exports.getUpcomingPointExpirations = getUpcomingPointExpirations;
const db_1 = require("../db");
const securityMonitor_1 = require("../securityMonitor");
const MYSQL_DUPLICATE_ENTRY = 1062;
const DEFAULT_POINTS_AMOUNT_BASE = 1000;
const DEFAULT_POINTS_AMOUNT_REWARD = 20;
const DEFAULT_POINTS_EXPIRATION_MONTHS = 6;
const DEFAULT_POINTS_EXPIRATION_ALERT_VALUE = 1;
const DEFAULT_POINTS_EXPIRATION_ALERT_UNIT = "meses";
function isDuplicateKeyError(error) {
    return (typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error.code === "ER_DUP_ENTRY" ||
            error.errno === MYSQL_DUPLICATE_ENTRY));
}
function toMysqlDateTime(value) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    const hour = String(value.getUTCHours()).padStart(2, "0");
    const minute = String(value.getUTCMinutes()).padStart(2, "0");
    const second = String(value.getUTCSeconds()).padStart(2, "0");
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}
function addMonthsUtc(value, months) {
    const safeMonths = Math.max(1, Math.min(120, Math.trunc(months)));
    const target = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + safeMonths, 1, value.getUTCHours(), value.getUTCMinutes(), value.getUTCSeconds()));
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(value.getUTCDate(), lastDay));
    return target;
}
function addDaysUtc(value, days) {
    const safeDays = Math.max(1, Math.min(Math.trunc(days), 3650));
    const target = new Date(value.getTime());
    target.setUTCDate(target.getUTCDate() + safeDays);
    return target;
}
function normalizeInteger(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed))
        return fallback;
    const normalized = Math.trunc(parsed);
    if (normalized < min || normalized > max)
        return fallback;
    return normalized;
}
function normalizeAmount(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 999_999_999)
        return fallback;
    return Math.round((parsed + Number.EPSILON) * 100) / 100;
}
function normalizeAlertUnit(value) {
    return value === "semanas" ? "semanas" : DEFAULT_POINTS_EXPIRATION_ALERT_UNIT;
}
/**
 * Interruptor global del programa de puntos (clave `puntos_activo`).
 * Con el programa apagado no ENTRA ningún punto nuevo y los vencimientos
 * se pausan; solo se permiten los movimientos que deshacen operaciones
 * previas (ver BLOCKED_MOVEMENT_TYPES_WHEN_DISABLED).
 * Default seguro: si la clave no existe o la consulta falla, está activo.
 */
async function isPointsProgramEnabled(conn) {
    try {
        const row = await (0, db_1.qOne)(conn, "SELECT valor FROM configuracion WHERE clave = 'puntos_activo' LIMIT 1");
        const valor = (row?.valor ?? "1").trim().toLowerCase();
        return !["0", "false", "no", "off"].includes(valor);
    }
    catch {
        return true;
    }
}
/**
 * Tipos bloqueados con el programa apagado: todos los que hacen ENTRAR
 * puntos nuevos. `ajuste` y `devolucion_canje` quedan permitidos porque
 * no suman: deshacen compras canceladas o canjes devueltos de cuando el
 * programa estaba prendido. `vencimiento_puntos` también pasa (el job se
 * pausa aparte, pero un vencimiento en vuelo no debe romper).
 */
const BLOCKED_MOVEMENT_TYPES_WHEN_DISABLED = new Set([
    "acreditacion_compra",
    "asignacion_manual",
    "codigo_canje",
    "referido_invitador",
    "referido_invitado",
    "canje_producto",
]);
class PointsProgramDisabledError extends Error {
    constructor(tipo) {
        super(`El programa de puntos está desactivado: movimiento '${tipo}' rechazado.`);
        this.name = "PointsProgramDisabledError";
    }
}
exports.PointsProgramDisabledError = PointsProgramDisabledError;
async function getPointsProgramConfig(conn) {
    const row = await (0, db_1.qOne)(conn, `SELECT
       MAX(CASE WHEN clave = 'puntos_monto_base' THEN valor END) AS monto_base,
       MAX(CASE WHEN clave = 'puntos_por_monto' THEN valor END) AS puntos_por_monto,
       MAX(CASE WHEN clave = 'puntos_vencimiento_meses' THEN valor END) AS vencimiento_meses,
       MAX(CASE WHEN clave = 'puntos_alerta_pre_vencimiento_valor' THEN valor END) AS alerta_pre_vencimiento_valor,
       MAX(CASE WHEN clave = 'puntos_alerta_pre_vencimiento_unidad' THEN valor END) AS alerta_pre_vencimiento_unidad
      FROM configuracion
     WHERE clave IN (
       'puntos_monto_base',
       'puntos_por_monto',
       'puntos_vencimiento_meses',
       'puntos_alerta_pre_vencimiento_valor',
       'puntos_alerta_pre_vencimiento_unidad'
     )`);
    return {
        montoBase: normalizeAmount(row?.monto_base, DEFAULT_POINTS_AMOUNT_BASE),
        puntosPorMonto: normalizeInteger(row?.puntos_por_monto, DEFAULT_POINTS_AMOUNT_REWARD, 0, 1_000_000),
        vencimientoMeses: normalizeInteger(row?.vencimiento_meses, DEFAULT_POINTS_EXPIRATION_MONTHS, 1, 120),
        alertaPreVencimientoValor: normalizeInteger(row?.alerta_pre_vencimiento_valor, DEFAULT_POINTS_EXPIRATION_ALERT_VALUE, 1, 120),
        alertaPreVencimientoUnidad: normalizeAlertUnit(row?.alerta_pre_vencimiento_unidad),
    };
}
function calcularPuntosPorMontoConConfig(amount, config) {
    const total = Number(amount);
    if (!Number.isFinite(total) || total <= 0)
        return 0;
    if (config.montoBase <= 0 || config.puntosPorMonto <= 0)
        return 0;
    return Math.floor(total / config.montoBase) * config.puntosPorMonto;
}
async function calcularPuntosPorMonto(conn, amount) {
    return calcularPuntosPorMontoConConfig(amount, await getPointsProgramConfig(conn));
}
async function createPointLotForMovement(conn, { usuarioId, movimientoId, puntos, tipo, referenciaId, referenciaTipo, }) {
    if (puntos <= 0)
        return;
    const config = await getPointsProgramConfig(conn);
    const expiresAt = addMonthsUtc(new Date(), config.vencimientoMeses);
    await (0, db_1.qRun)(conn, `INSERT INTO puntos_lotes
       (usuario_id, movimiento_id, puntos_originales, puntos_disponibles, expires_at, origen_tipo, origen_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`, [
        usuarioId,
        movimientoId,
        puntos,
        puntos,
        toMysqlDateTime(expiresAt),
        referenciaTipo ?? tipo,
        referenciaId ?? movimientoId,
    ]);
}
async function restoreConsumedPointsForReference(conn, { usuarioId, puntos, referenciaId, referenciaTipo, }) {
    if (puntos <= 0 || !referenciaId || !referenciaTipo)
        return 0;
    const rows = await (0, db_1.qAll)(conn, `SELECT plc.lote_id,
            SUM(plc.puntos) AS puntos_consumidos,
            pl.puntos_originales,
            pl.puntos_disponibles
     FROM puntos_lote_consumos plc
     JOIN movimientos_puntos mp ON mp.id = plc.movimiento_id
     JOIN puntos_lotes pl ON pl.id = plc.lote_id
     WHERE mp.usuario_id = ?
       AND mp.tipo = 'canje_producto'
       AND mp.referencia_tipo = ?
       AND mp.referencia_id = ?
       AND pl.expires_at > NOW()
     GROUP BY plc.lote_id, pl.puntos_originales, pl.puntos_disponibles
     ORDER BY MIN(plc.id) ASC`, [usuarioId, referenciaTipo, referenciaId]);
    let remaining = puntos;
    let restored = 0;
    for (const row of rows) {
        if (remaining <= 0)
            break;
        const restorable = Math.max(0, Number(row.puntos_originales) - Number(row.puntos_disponibles));
        const amount = Math.min(restorable, Number(row.puntos_consumidos), remaining);
        if (amount <= 0)
            continue;
        await (0, db_1.qRun)(conn, `UPDATE puntos_lotes
       SET puntos_disponibles = puntos_disponibles + ?
       WHERE id = ?`, [amount, Number(row.lote_id)]);
        restored += amount;
        remaining -= amount;
    }
    return restored;
}
async function consumeAvailablePointLots(conn, { usuarioId, movimientoId, puntos, }) {
    if (puntos <= 0)
        return;
    const lots = await (0, db_1.qAll)(conn, `SELECT id, puntos_disponibles
     FROM puntos_lotes
     WHERE usuario_id = ?
       AND puntos_disponibles > 0
       AND expires_at > NOW()
     ORDER BY expires_at ASC, created_at ASC, id ASC
     FOR UPDATE`, [usuarioId]);
    let remaining = puntos;
    for (const lot of lots) {
        if (remaining <= 0)
            break;
        const available = Number(lot.puntos_disponibles);
        if (available <= 0)
            continue;
        const amount = Math.min(available, remaining);
        await (0, db_1.qRun)(conn, "UPDATE puntos_lotes SET puntos_disponibles = puntos_disponibles - ? WHERE id = ?", [
            amount,
            Number(lot.id),
        ]);
        await (0, db_1.qRun)(conn, `INSERT INTO puntos_lote_consumos (usuario_id, lote_id, movimiento_id, puntos)
       VALUES (?, ?, ?, ?)`, [usuarioId, Number(lot.id), movimientoId, amount]);
        remaining -= amount;
    }
    if (remaining > 0) {
        const available = puntos - remaining;
        throw new Error(`Puntos insuficientes. Disponibles: ${available}, requeridos: ${puntos}.`);
    }
}
async function recalcularSaldoPuntosUsuario(conn, usuarioId) {
    let saldoCalculado = 0;
    try {
        const row = await (0, db_1.qOne)(conn, `SELECT COALESCE(SUM(puntos_disponibles), 0) AS saldo
       FROM puntos_lotes
       WHERE usuario_id = ?
         AND expires_at > NOW()`, [usuarioId]);
        saldoCalculado = Math.max(0, Number(row?.saldo ?? 0));
    }
    catch {
        const row = await (0, db_1.qOne)(conn, `SELECT COALESCE(SUM(puntos), 0) AS saldo
       FROM movimientos_puntos
       WHERE usuario_id = ?`, [usuarioId]);
        saldoCalculado = Math.max(0, Number(row?.saldo ?? 0));
    }
    const previo = await (0, db_1.qOne)(conn, "SELECT puntos_saldo FROM usuarios WHERE id = ?", [usuarioId]);
    if (previo && Number(previo.puntos_saldo) !== saldoCalculado) {
        console.log(`[recalcularSaldoPuntosUsuario] Corrigiendo saldo usuario #${usuarioId}: ${previo.puntos_saldo} -> ${saldoCalculado}`);
    }
    await (0, db_1.qRun)(conn, "UPDATE usuarios SET puntos_saldo = ? WHERE id = ?", [saldoCalculado, usuarioId]);
    return saldoCalculado;
}
async function registrarMovimientoPuntos(conn, params) {
    const { usuarioId, tipo, puntos, descripcion, referenciaId, referenciaTipo, creadoPor } = params;
    // Corte central del toggle: todas las vías de suma (checkout, ventas
    // locales, asignación manual, referidos, códigos) pasan por acá.
    if (BLOCKED_MOVEMENT_TYPES_WHEN_DISABLED.has(tipo) && !(await isPointsProgramEnabled(conn))) {
        throw new PointsProgramDisabledError(tipo);
    }
    if (puntos === 0) {
        return await recalcularSaldoPuntosUsuario(conn, usuarioId);
    }
    let movimientoId = null;
    try {
        const result = await (0, db_1.qRun)(conn, `INSERT INTO movimientos_puntos
        (usuario_id, tipo, puntos, descripcion, referencia_id, referencia_tipo, creado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?)`, [
            usuarioId,
            tipo,
            puntos,
            descripcion || null,
            referenciaId || null,
            referenciaTipo || null,
            creadoPor || null,
        ]);
        movimientoId = result.insertId;
    }
    catch (error) {
        if (isDuplicateKeyError(error)) {
            console.log(`[registrarMovimientoPuntos] Movimiento duplicado ignorado: ${tipo} usuario #${usuarioId}`);
        }
        else {
            console.error("[registrarMovimientoPuntos] Error critico al insertar movimiento:", error);
            throw error;
        }
    }
    if (movimientoId) {
        if (puntos > 0) {
            let puntosParaNuevoLote = puntos;
            if (tipo === "devolucion_canje") {
                const restored = await restoreConsumedPointsForReference(conn, {
                    usuarioId,
                    puntos,
                    referenciaId,
                    referenciaTipo,
                });
                puntosParaNuevoLote = Math.max(0, puntos - restored);
            }
            await createPointLotForMovement(conn, {
                usuarioId,
                movimientoId,
                puntos: puntosParaNuevoLote,
                tipo,
                referenciaId,
                referenciaTipo,
            });
        }
        else {
            await consumeAvailablePointLots(conn, {
                usuarioId,
                movimientoId,
                puntos: Math.abs(puntos),
            });
        }
    }
    return await recalcularSaldoPuntosUsuario(conn, usuarioId);
}
async function removerPuntosAcreditadosPorCompra(conn, orderId, usuarioId, options = {}) {
    const acreditado = await (0, db_1.qOne)(conn, `SELECT COALESCE(SUM(puntos), 0) AS total
     FROM movimientos_puntos
     WHERE referencia_tipo = 'ordenes'
       AND referencia_id = ?
       AND tipo = 'acreditacion_compra'
       AND puntos > 0`, [orderId]);
    const puntosAcreditados = Number(acreditado?.total ?? 0);
    if (!usuarioId || puntosAcreditados <= 0) {
        if (usuarioId)
            await recalcularSaldoPuntosUsuario(conn, Number(usuarioId));
        return;
    }
    const useReference = options.dedupeReference !== false;
    await registrarMovimientoPuntos(conn, {
        usuarioId: Number(usuarioId),
        tipo: "ajuste",
        puntos: -puntosAcreditados,
        descripcion: options.descripcion ?? `Anulacion de puntos por cancelacion de compra #${orderId}`,
        referenciaId: useReference ? orderId : undefined,
        referenciaTipo: useReference ? "ordenes_cancelacion" : undefined,
    });
}
async function acreditarPuntosPorCompra(conn, orderId) {
    if (!(await isPointsProgramEnabled(conn))) {
        console.log(`[puntos] programa desactivado: la orden #${orderId} no acredita puntos.`);
        return;
    }
    console.log("[puntos] iniciando acreditacion", { orderId });
    try {
        const orden = await (0, db_1.qOne)(conn, "SELECT id, usuario_id, estado, total_dinero FROM ordenes WHERE id = ?", [orderId]);
        if (!orden) {
            console.error("[puntos] ERROR: Orden no encontrada", { orderId });
            return;
        }
        const usuarioId = Number(orden.usuario_id);
        const paidStates = ["pagada", "preparandose", "preparada", "enviada", "entregando", "entregada"];
        if (!paidStates.includes(orden.estado)) {
            console.log(`[puntos] omitiendo: orden #${orderId} esta en estado ${orden.estado}.`);
            return;
        }
        const puntos = await calcularPuntosPorMonto(conn, Number(orden.total_dinero ?? 0));
        console.log("[puntos] puntos calculados por monto", { orderId, usuarioId, total: Number(orden.total_dinero ?? 0), puntos });
        if (puntos <= 0) {
            console.log("[puntos] la orden no suma puntos por la regla vigente", { orderId });
            return;
        }
        const saldo = await registrarMovimientoPuntos(conn, {
            usuarioId,
            tipo: "acreditacion_compra",
            puntos,
            descripcion: `Puntos acreditados por compra de orden #${orderId}`,
            referenciaId: orderId,
            referenciaTipo: "ordenes",
            creadoPor: usuarioId,
        });
        console.log("[puntos] saldo recalculado", { usuarioId, saldo });
    }
    catch (error) {
        console.error(`[puntos] ERROR CRITICO procesando orden #${orderId}:`, error);
        (0, securityMonitor_1.recordSecurityEvent)("error_acreditacion_puntos", null, {
            orderId,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}
async function expirarPuntosVencidos(conn) {
    // Con el programa apagado los vencimientos se pausan por completo:
    // nadie pierde puntos que no puede usar.
    if (!(await isPointsProgramEnabled(conn)))
        return 0;
    const users = await (0, db_1.qAll)(conn, `SELECT usuario_id, COALESCE(SUM(puntos_disponibles), 0) AS puntos
     FROM puntos_lotes
     WHERE puntos_disponibles > 0
       AND expires_at <= NOW()
     GROUP BY usuario_id
     ORDER BY usuario_id ASC
     LIMIT 100`);
    let totalExpired = 0;
    for (const user of users) {
        const usuarioId = Number(user.usuario_id);
        const puntos = Number(user.puntos ?? 0);
        if (puntos <= 0)
            continue;
        await (0, db_1.qRun)(conn, `INSERT INTO movimientos_puntos
         (usuario_id, tipo, puntos, descripcion, referencia_tipo)
       VALUES (?, 'vencimiento_puntos', ?, 'Vencimiento automatico de puntos', 'puntos_lotes')`, [usuarioId, -puntos]);
        await (0, db_1.qRun)(conn, `UPDATE puntos_lotes
       SET puntos_disponibles = 0
       WHERE usuario_id = ?
         AND puntos_disponibles > 0
         AND expires_at <= NOW()`, [usuarioId]);
        await recalcularSaldoPuntosUsuario(conn, usuarioId);
        totalExpired += puntos;
    }
    return totalExpired;
}
async function getUpcomingPointExpirations(conn, usuarioId, options) {
    const config = await getPointsProgramConfig(conn);
    const windowValue = normalizeInteger(options?.windowValue ?? config.alertaPreVencimientoValor, DEFAULT_POINTS_EXPIRATION_ALERT_VALUE, 1, 120);
    const windowUnit = normalizeAlertUnit(options?.windowUnit ?? config.alertaPreVencimientoUnidad);
    const now = new Date();
    const cutoffDate = windowUnit === "semanas"
        ? addDaysUtc(now, windowValue * 7)
        : addMonthsUtc(now, windowValue);
    const safeWindowDays = Math.max(1, Math.ceil((cutoffDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
    const intervalUnitSql = windowUnit === "semanas" ? "WEEK" : "MONTH";
    const rows = await (0, db_1.qAll)(conn, `SELECT expires_at, COALESCE(SUM(puntos_disponibles), 0) AS puntos
     FROM puntos_lotes
     WHERE usuario_id = ?
       AND puntos_disponibles > 0
       AND expires_at > NOW()
       AND expires_at <= DATE_ADD(NOW(), INTERVAL ? ${intervalUnitSql})
      GROUP BY expires_at
      ORDER BY expires_at ASC`, [usuarioId, windowValue]);
    const items = rows.map((row) => ({
        expiresAt: row.expires_at instanceof Date
            ? row.expires_at.toISOString()
            : new Date(row.expires_at).toISOString(),
        puntos: Number(row.puntos ?? 0),
    })).filter((row) => row.puntos > 0);
    return {
        windowDays: safeWindowDays,
        windowValue,
        windowUnit,
        totalPoints: items.reduce((acc, item) => acc + item.puntos, 0),
        nextExpirationAt: items[0]?.expiresAt ?? null,
        items,
    };
}
