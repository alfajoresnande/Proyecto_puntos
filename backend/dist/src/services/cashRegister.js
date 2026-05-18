"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBuenosAiresDateStamp = getBuenosAiresDateStamp;
exports.formatCashDateStamp = formatCashDateStamp;
exports.normalizeCashPaymentMethod = normalizeCashPaymentMethod;
exports.getActiveCajaSesion = getActiveCajaSesion;
exports.closeStaleCajaSesiones = closeStaleCajaSesiones;
exports.ensureDailyCajaSesion = ensureDailyCajaSesion;
exports.openCajaSesion = openCajaSesion;
exports.registerCajaMovimiento = registerCajaMovimiento;
exports.getCajaSesionSummary = getCajaSesionSummary;
exports.closeCajaSesion = closeCajaSesion;
const db_1 = require("../db");
const BUENOS_AIRES_TIME_ZONE = "America/Argentina/Buenos_Aires";
const VALID_PAYMENT_METHODS = new Set(["cash", "transferencia", "tarjeta", "qr", "otro"]);
function getTimeZoneParts(date, timeZone) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    return {
        year: values.year,
        month: values.month,
        day: values.day,
    };
}
function toMoney(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}
function getBuenosAiresDateStamp(value = new Date()) {
    const parts = getTimeZoneParts(value, BUENOS_AIRES_TIME_ZONE);
    return `${parts.year}-${parts.month}-${parts.day}`;
}
function formatCashDateStamp(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().slice(0, 10);
    }
    const text = String(value ?? "").trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(text))
        return text.slice(0, 10);
    return text;
}
function normalizeCashPaymentMethod(value) {
    const normalized = String(value || "").trim().toLowerCase();
    return VALID_PAYMENT_METHODS.has(normalized) ? normalized : "cash";
}
function emptyTotals() {
    return {
        cash: 0,
        transferencia: 0,
        tarjeta: 0,
        qr: 0,
        otro: 0,
    };
}
async function getActiveCajaSesion(conn, input) {
    const fechaOperativa = getBuenosAiresDateStamp();
    return (0, db_1.qOne)(conn, `SELECT id, sucursal_id, usuario_id, fecha_operativa, estado,
            monto_apertura, monto_cierre_sistema, monto_cierre_declarado, diferencia_cierre,
            observaciones_apertura, observaciones_cierre, apertura_at, cierre_at
     FROM caja_sesiones
     WHERE sucursal_id = ? AND fecha_operativa = ? AND estado = 'abierta'
     ORDER BY apertura_at DESC, id DESC
     LIMIT 1`, [input.sucursalId, fechaOperativa]);
}
async function closeCajaSesionAutomatically(conn, cajaSesionId) {
    const session = await (0, db_1.qOne)(conn, `SELECT id, estado
     FROM caja_sesiones
     WHERE id = ?
     LIMIT 1
     FOR UPDATE`, [cajaSesionId]);
    if (!session || session.estado !== "abierta")
        return;
    const summary = await getCajaSesionSummary(conn, cajaSesionId);
    await (0, db_1.qRun)(conn, `UPDATE caja_sesiones
     SET estado = 'cerrada',
         monto_cierre_sistema = ?,
         monto_cierre_declarado = ?,
         diferencia_cierre = 0,
         observaciones_cierre = COALESCE(observaciones_cierre, 'Cierre automatico por cambio de fecha operativa.'),
         cierre_at = COALESCE(cierre_at, CURRENT_TIMESTAMP)
     WHERE id = ?`, [summary.efectivoSistema, summary.efectivoSistema, cajaSesionId]);
}
async function closeStaleCajaSesiones(conn, input = {}) {
    const where = ["estado = 'abierta'", "fecha_operativa < ?"];
    const params = [getBuenosAiresDateStamp()];
    if (input.sucursalId) {
        where.push("sucursal_id = ?");
        params.push(input.sucursalId);
    }
    const rows = await (0, db_1.qAll)(conn, `SELECT id
     FROM caja_sesiones
     WHERE ${where.join(" AND ")}`, params);
    for (const row of rows) {
        await closeCajaSesionAutomatically(conn, Number(row.id));
    }
}
async function ensureDailyCajaSesion(conn, input) {
    const sucursal = await (0, db_1.qOne)(conn, "SELECT id FROM sucursales WHERE id = ? AND activo = 1 LIMIT 1", [input.sucursalId]);
    if (!sucursal) {
        throw new Error("La sucursal seleccionada no existe o esta inactiva.");
    }
    await closeStaleCajaSesiones(conn, { sucursalId: input.sucursalId });
    const existing = await getActiveCajaSesion(conn, { sucursalId: input.sucursalId });
    if (existing)
        return existing;
    const created = await (0, db_1.qRun)(conn, `INSERT INTO caja_sesiones
      (sucursal_id, usuario_id, fecha_operativa, estado, monto_apertura, observaciones_apertura)
     VALUES (?, ?, ?, 'abierta', 0, 'Caja diaria creada automaticamente.')`, [input.sucursalId, input.usuarioId, getBuenosAiresDateStamp()]);
    const session = await (0, db_1.qOne)(conn, `SELECT id, sucursal_id, usuario_id, fecha_operativa, estado,
            monto_apertura, monto_cierre_sistema, monto_cierre_declarado, diferencia_cierre,
            observaciones_apertura, observaciones_cierre, apertura_at, cierre_at
     FROM caja_sesiones
     WHERE id = ?
     LIMIT 1`, [created.insertId]);
    if (!session) {
        throw new Error("No se pudo crear la caja diaria.");
    }
    return session;
}
async function openCajaSesion(conn, input) {
    const montoApertura = toMoney(input.montoApertura);
    if (!Number.isFinite(montoApertura) || montoApertura < 0) {
        throw new Error("El monto de apertura debe ser un numero mayor o igual a 0.");
    }
    const sucursal = await (0, db_1.qOne)(conn, "SELECT id FROM sucursales WHERE id = ? AND activo = 1 LIMIT 1", [input.sucursalId]);
    if (!sucursal)
        throw new Error("La sucursal seleccionada no existe o esta inactiva.");
    await closeStaleCajaSesiones(conn, { sucursalId: input.sucursalId });
    const existing = await getActiveCajaSesion(conn, { sucursalId: input.sucursalId });
    if (existing) {
        return existing.id;
    }
    const created = await (0, db_1.qRun)(conn, `INSERT INTO caja_sesiones
      (sucursal_id, usuario_id, fecha_operativa, estado, monto_apertura, observaciones_apertura)
     VALUES (?, ?, ?, 'abierta', ?, ?)`, [
        input.sucursalId,
        input.usuarioId,
        getBuenosAiresDateStamp(),
        montoApertura,
        input.observaciones?.trim() || null,
    ]);
    return created.insertId;
}
async function registerCajaMovimiento(conn, input) {
    const monto = toMoney(input.monto);
    if (!Number.isFinite(monto) || monto <= 0) {
        throw new Error("El movimiento de caja debe tener un monto mayor a 0.");
    }
    await (0, db_1.qRun)(conn, `INSERT INTO caja_movimientos
      (caja_sesion_id, tipo, referencia_tipo, referencia_id, medio_pago, monto, descripcion, creado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
        input.cajaSesionId,
        input.tipo,
        input.referenciaTipo ?? null,
        input.referenciaId ?? null,
        normalizeCashPaymentMethod(input.medioPago),
        monto,
        input.descripcion?.trim() || null,
        input.creadoPor,
    ]);
}
async function getCajaSesionSummary(conn, cajaSesionId) {
    const session = await (0, db_1.qOne)(conn, "SELECT monto_apertura FROM caja_sesiones WHERE id = ? LIMIT 1", [cajaSesionId]);
    if (!session) {
        throw new Error("La caja solicitada no existe.");
    }
    const rows = await (0, db_1.qAll)(conn, `SELECT tipo, medio_pago, monto
     FROM caja_movimientos
     WHERE caja_sesion_id = ?
     ORDER BY id ASC`, [cajaSesionId]);
    const ventasPorMedio = emptyTotals();
    const gastosPorMedio = emptyTotals();
    let totalVentas = 0;
    let totalGastos = 0;
    for (const row of rows) {
        const method = normalizeCashPaymentMethod(row.medio_pago);
        const amount = toMoney(Number(row.monto ?? 0));
        if (row.tipo === "venta") {
            ventasPorMedio[method] = toMoney(ventasPorMedio[method] + amount);
            totalVentas = toMoney(totalVentas + amount);
            continue;
        }
        gastosPorMedio[method] = toMoney(gastosPorMedio[method] + amount);
        totalGastos = toMoney(totalGastos + amount);
    }
    const neto = toMoney(totalVentas - totalGastos);
    const efectivoSistema = toMoney(Number(session.monto_apertura ?? 0) + ventasPorMedio.cash - gastosPorMedio.cash);
    return {
        totalVentas,
        totalGastos,
        neto,
        efectivoSistema,
        ventasPorMedio,
        gastosPorMedio,
        cantidadMovimientos: rows.length,
    };
}
async function closeCajaSesion(conn, input) {
    const session = await (0, db_1.qOne)(conn, `SELECT id, usuario_id, estado
     FROM caja_sesiones
     WHERE id = ?
     LIMIT 1
     FOR UPDATE`, [input.cajaSesionId]);
    if (!session)
        throw new Error("La caja solicitada no existe.");
    if (session.estado !== "abierta")
        throw new Error("La caja ya fue cerrada.");
    // La caja diaria pertenece a la sucursal; usuario_id solo identifica quien la creo.
    const summary = await getCajaSesionSummary(conn, input.cajaSesionId);
    const montoDeclarado = toMoney(input.montoCierreDeclarado);
    if (!Number.isFinite(montoDeclarado) || montoDeclarado < 0) {
        throw new Error("El monto de cierre declarado debe ser un numero mayor o igual a 0.");
    }
    const diferencia = toMoney(montoDeclarado - summary.efectivoSistema);
    await (0, db_1.qRun)(conn, `UPDATE caja_sesiones
     SET estado = 'cerrada',
         monto_cierre_sistema = ?,
         monto_cierre_declarado = ?,
         diferencia_cierre = ?,
         observaciones_cierre = ?,
         cierre_at = CURRENT_TIMESTAMP
     WHERE id = ?`, [
        summary.efectivoSistema,
        montoDeclarado,
        diferencia,
        input.observaciones?.trim() || null,
        input.cajaSesionId,
    ]);
    return {
        ...summary,
        montoCierreDeclarado: montoDeclarado,
        diferenciaCierre: diferencia,
    };
}
