import { Queryable, qAll, qOne, qRun } from "../db";

export type CashPaymentMethod = "cash" | "transferencia" | "tarjeta" | "qr" | "otro";
export type CajaMovimientoTipo = "venta" | "gasto";

export type CajaSesionSummary = {
  totalVentas: number;
  totalGastos: number;
  neto: number;
  efectivoSistema: number;
  ventasPorMedio: Record<CashPaymentMethod, number>;
  gastosPorMedio: Record<CashPaymentMethod, number>;
  cantidadMovimientos: number;
};

const BUENOS_AIRES_TIME_ZONE = "America/Argentina/Buenos_Aires";
const VALID_PAYMENT_METHODS = new Set<CashPaymentMethod>(["cash", "transferencia", "tarjeta", "qr", "otro"]);

function getTimeZoneParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  ) as Record<string, string>;

  return {
    year: values.year,
    month: values.month,
    day: values.day,
  };
}

function toMoney(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function getBuenosAiresDateStamp(value: Date = new Date()): string {
  const parts = getTimeZoneParts(value, BUENOS_AIRES_TIME_ZONE);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function normalizeCashPaymentMethod(value: string | null | undefined): CashPaymentMethod {
  const normalized = String(value || "").trim().toLowerCase();
  return VALID_PAYMENT_METHODS.has(normalized as CashPaymentMethod) ? (normalized as CashPaymentMethod) : "cash";
}

function emptyTotals(): Record<CashPaymentMethod, number> {
  return {
    cash: 0,
    transferencia: 0,
    tarjeta: 0,
    qr: 0,
    otro: 0,
  };
}

export async function getActiveCajaSesion(
  conn: Queryable,
  input: { usuarioId: number; sucursalId?: number | null },
) {
  const fechaOperativa = getBuenosAiresDateStamp();
  const whereSucursal = input.sucursalId ? "AND sucursal_id = ?" : "";
  const params = input.sucursalId ? [input.usuarioId, fechaOperativa, input.sucursalId] : [input.usuarioId, fechaOperativa];
  return qOne<{
    id: number;
    sucursal_id: number;
    usuario_id: number;
    fecha_operativa: string;
    estado: "abierta" | "cerrada";
    monto_apertura: number;
    monto_cierre_sistema: number | null;
    monto_cierre_declarado: number | null;
    diferencia_cierre: number | null;
    observaciones_apertura: string | null;
    observaciones_cierre: string | null;
    apertura_at: string;
    cierre_at: string | null;
  }>(
    conn,
    `SELECT id, sucursal_id, usuario_id, fecha_operativa, estado,
            monto_apertura, monto_cierre_sistema, monto_cierre_declarado, diferencia_cierre,
            observaciones_apertura, observaciones_cierre, apertura_at, cierre_at
     FROM caja_sesiones
     WHERE usuario_id = ? AND fecha_operativa = ? AND estado = 'abierta' ${whereSucursal}
     ORDER BY apertura_at DESC, id DESC
     LIMIT 1`,
    params,
  );
}

async function closeCajaSesionAutomatically(conn: Queryable, cajaSesionId: number) {
  const session = await qOne<{
    id: number;
    estado: "abierta" | "cerrada";
  }>(
    conn,
    `SELECT id, estado
     FROM caja_sesiones
     WHERE id = ?
     LIMIT 1
     FOR UPDATE`,
    [cajaSesionId],
  );
  if (!session || session.estado !== "abierta") return;

  const summary = await getCajaSesionSummary(conn, cajaSesionId);
  await qRun(
    conn,
    `UPDATE caja_sesiones
     SET estado = 'cerrada',
         monto_cierre_sistema = ?,
         monto_cierre_declarado = ?,
         diferencia_cierre = 0,
         observaciones_cierre = COALESCE(observaciones_cierre, 'Cierre automatico por cambio de fecha operativa.'),
         cierre_at = COALESCE(cierre_at, CURRENT_TIMESTAMP)
     WHERE id = ?`,
    [summary.efectivoSistema, summary.efectivoSistema, cajaSesionId],
  );
}

export async function closeStaleCajaSesiones(
  conn: Queryable,
  input: { usuarioId?: number | null; sucursalId?: number | null } = {},
) {
  const where = ["estado = 'abierta'", "fecha_operativa < ?"];
  const params: Array<string | number> = [getBuenosAiresDateStamp()];
  if (input.usuarioId) {
    where.push("usuario_id = ?");
    params.push(input.usuarioId);
  }
  if (input.sucursalId) {
    where.push("sucursal_id = ?");
    params.push(input.sucursalId);
  }

  const rows = await qAll<{ id: number }>(
    conn,
    `SELECT id
     FROM caja_sesiones
     WHERE ${where.join(" AND ")}`,
    params,
  );

  for (const row of rows) {
    await closeCajaSesionAutomatically(conn, Number(row.id));
  }
}

export async function ensureDailyCajaSesion(
  conn: Queryable,
  input: { usuarioId: number; sucursalId: number },
) {
  const sucursal = await qOne<{ id: number }>(
    conn,
    "SELECT id FROM sucursales WHERE id = ? AND activo = 1 LIMIT 1",
    [input.sucursalId],
  );
  if (!sucursal) {
    throw new Error("La sucursal seleccionada no existe o esta inactiva.");
  }

  await closeStaleCajaSesiones(conn, input);

  const existing = await getActiveCajaSesion(conn, input);
  if (existing) return existing;

  const created = await qRun(
    conn,
    `INSERT INTO caja_sesiones
      (sucursal_id, usuario_id, fecha_operativa, estado, monto_apertura, observaciones_apertura)
     VALUES (?, ?, ?, 'abierta', 0, 'Caja diaria creada automaticamente.')`,
    [input.sucursalId, input.usuarioId, getBuenosAiresDateStamp()],
  );

  const session = await qOne<{
    id: number;
    sucursal_id: number;
    usuario_id: number;
    fecha_operativa: string;
    estado: "abierta" | "cerrada";
    monto_apertura: number;
    monto_cierre_sistema: number | null;
    monto_cierre_declarado: number | null;
    diferencia_cierre: number | null;
    observaciones_apertura: string | null;
    observaciones_cierre: string | null;
    apertura_at: string;
    cierre_at: string | null;
  }>(
    conn,
    `SELECT id, sucursal_id, usuario_id, fecha_operativa, estado,
            monto_apertura, monto_cierre_sistema, monto_cierre_declarado, diferencia_cierre,
            observaciones_apertura, observaciones_cierre, apertura_at, cierre_at
     FROM caja_sesiones
     WHERE id = ?
     LIMIT 1`,
    [created.insertId],
  );
  if (!session) {
    throw new Error("No se pudo crear la caja diaria.");
  }
  return session;
}

export async function openCajaSesion(
  conn: Queryable,
  input: {
    usuarioId: number;
    sucursalId: number;
    montoApertura: number;
    observaciones?: string | null;
  },
) {
  const montoApertura = toMoney(input.montoApertura);
  if (!Number.isFinite(montoApertura) || montoApertura < 0) {
    throw new Error("El monto de apertura debe ser un numero mayor o igual a 0.");
  }

  const sucursal = await qOne<{ id: number }>(
    conn,
    "SELECT id FROM sucursales WHERE id = ? AND activo = 1 LIMIT 1",
    [input.sucursalId],
  );
  if (!sucursal) throw new Error("La sucursal seleccionada no existe o esta inactiva.");

  const existing = await getActiveCajaSesion(conn, { usuarioId: input.usuarioId });
  if (existing) {
    throw new Error("Ya tienes una caja abierta. Debes cerrarla antes de abrir otra.");
  }

  const created = await qRun(
    conn,
    `INSERT INTO caja_sesiones
      (sucursal_id, usuario_id, fecha_operativa, estado, monto_apertura, observaciones_apertura)
     VALUES (?, ?, ?, 'abierta', ?, ?)`,
    [
      input.sucursalId,
      input.usuarioId,
      getBuenosAiresDateStamp(),
      montoApertura,
      input.observaciones?.trim() || null,
    ],
  );

  return created.insertId;
}

export async function registerCajaMovimiento(
  conn: Queryable,
  input: {
    cajaSesionId: number;
    tipo: CajaMovimientoTipo;
    medioPago: CashPaymentMethod;
    monto: number;
    descripcion?: string | null;
    referenciaTipo?: string | null;
    referenciaId?: number | null;
    creadoPor: number;
  },
) {
  const monto = toMoney(input.monto);
  if (!Number.isFinite(monto) || monto <= 0) {
    throw new Error("El movimiento de caja debe tener un monto mayor a 0.");
  }

  await qRun(
    conn,
    `INSERT INTO caja_movimientos
      (caja_sesion_id, tipo, referencia_tipo, referencia_id, medio_pago, monto, descripcion, creado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.cajaSesionId,
      input.tipo,
      input.referenciaTipo ?? null,
      input.referenciaId ?? null,
      normalizeCashPaymentMethod(input.medioPago),
      monto,
      input.descripcion?.trim() || null,
      input.creadoPor,
    ],
  );
}

export async function getCajaSesionSummary(conn: Queryable, cajaSesionId: number): Promise<CajaSesionSummary> {
  const session = await qOne<{ monto_apertura: number }>(
    conn,
    "SELECT monto_apertura FROM caja_sesiones WHERE id = ? LIMIT 1",
    [cajaSesionId],
  );
  if (!session) {
    throw new Error("La caja solicitada no existe.");
  }

  const rows = await qAll<{
    tipo: CajaMovimientoTipo;
    medio_pago: CashPaymentMethod;
    monto: number;
  }>(
    conn,
    `SELECT tipo, medio_pago, monto
     FROM caja_movimientos
     WHERE caja_sesion_id = ?
     ORDER BY id ASC`,
    [cajaSesionId],
  );

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

export async function closeCajaSesion(
  conn: Queryable,
  input: {
    cajaSesionId: number;
    usuarioId: number;
    montoCierreDeclarado: number;
    observaciones?: string | null;
    forceAdmin?: boolean;
  },
) {
  const session = await qOne<{
    id: number;
    usuario_id: number;
    estado: "abierta" | "cerrada";
  }>(
    conn,
    `SELECT id, usuario_id, estado
     FROM caja_sesiones
     WHERE id = ?
     LIMIT 1
     FOR UPDATE`,
    [input.cajaSesionId],
  );
  if (!session) throw new Error("La caja solicitada no existe.");
  if (session.estado !== "abierta") throw new Error("La caja ya fue cerrada.");
  if (!input.forceAdmin && Number(session.usuario_id) !== input.usuarioId) {
    throw new Error("No puedes cerrar una caja que no te pertenece.");
  }

  const summary = await getCajaSesionSummary(conn, input.cajaSesionId);
  const montoDeclarado = toMoney(input.montoCierreDeclarado);
  if (!Number.isFinite(montoDeclarado) || montoDeclarado < 0) {
    throw new Error("El monto de cierre declarado debe ser un numero mayor o igual a 0.");
  }
  const diferencia = toMoney(montoDeclarado - summary.efectivoSistema);

  await qRun(
    conn,
    `UPDATE caja_sesiones
     SET estado = 'cerrada',
         monto_cierre_sistema = ?,
         monto_cierre_declarado = ?,
         diferencia_cierre = ?,
         observaciones_cierre = ?,
         cierre_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      summary.efectivoSistema,
      montoDeclarado,
      diferencia,
      input.observaciones?.trim() || null,
      input.cajaSesionId,
    ],
  );

  return {
    ...summary,
    montoCierreDeclarado: montoDeclarado,
    diferenciaCierre: diferencia,
  };
}
