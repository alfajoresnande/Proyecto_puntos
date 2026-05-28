import { Queryable, qOne, qRun, qAll } from "../db";
import { recordSecurityEvent } from "../securityMonitor";

/** Código de error MySQL para UNIQUE constraint violation */
const MYSQL_DUPLICATE_ENTRY = 1062;

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as { code: unknown }).code === "ER_DUP_ENTRY" ||
      (error as { errno?: unknown }).errno === MYSQL_DUPLICATE_ENTRY)
  );
}

/**
 * RECONCILIACIÓN GLOBAL (SQL):
 * Si necesitas reparar todos los saldos de la base de datos manualmente:
 *
 * UPDATE usuarios u
 * LEFT JOIN (
 *   SELECT usuario_id, COALESCE(SUM(puntos), 0) AS saldo_calculado
 *   FROM movimientos_puntos
 *   GROUP BY usuario_id
 * ) mp ON mp.usuario_id = u.id
 * SET u.puntos_saldo = GREATEST(COALESCE(mp.saldo_calculado, 0), 0)
 * WHERE u.puntos_saldo <> GREATEST(COALESCE(mp.saldo_calculado, 0), 0);
 */

/**
 * Recalcula el saldo de puntos de un usuario sumando todos sus movimientos.
 * Es la fuente de verdad. Idempotente: puede llamarse múltiples veces.
 */
export async function recalcularSaldoPuntosUsuario(
  conn: Queryable,
  usuarioId: number,
): Promise<number> {
  const row = await qOne<{ saldo: number }>(
    conn,
    `SELECT COALESCE(SUM(puntos), 0) AS saldo
     FROM movimientos_puntos
     WHERE usuario_id = ?`,
    [usuarioId],
  );
  const saldoCalculado = Math.max(0, Number(row?.saldo ?? 0));

  const previo = await qOne<{ puntos_saldo: number }>(conn, "SELECT puntos_saldo FROM usuarios WHERE id = ?", [usuarioId]);
  if (previo && Number(previo.puntos_saldo) !== saldoCalculado) {
    console.log(`[recalcularSaldoPuntosUsuario] Corrigiendo saldo usuario #${usuarioId}: ${previo.puntos_saldo} -> ${saldoCalculado}`);
  }

  await qRun(
    conn,
    "UPDATE usuarios SET puntos_saldo = ? WHERE id = ?",
    [saldoCalculado, usuarioId],
  );
  console.log("Saldo recalculado correctamente", {
    usuarioId,
    saldo: saldoCalculado,
  });
  return saldoCalculado;
}

/**
 * Centraliza la creación de movimientos de puntos y el recálculo del saldo del usuario.
 * Única puerta de entrada para modificar puntos en el sistema.
 * 
 * @param conn Conexión (preferiblemente transaccional)
 * @param params Datos del movimiento
 * @returns El nuevo saldo calculado
 */
export async function registrarMovimientoPuntos(
  conn: Queryable,
  params: {
    usuarioId: number;
    tipo: 'asignacion_manual' | 'codigo_canje' | 'referido_invitador' | 'referido_invitado' | 'canje_producto' | 'devolucion_canje' | 'acreditacion_compra' | 'ajuste';
    puntos: number;
    descripcion?: string;
    referenciaId?: number;
    referenciaTipo?: string;
    creadoPor?: number;
  }
): Promise<number> {
  const { usuarioId, tipo, puntos, descripcion, referenciaId, referenciaTipo, creadoPor } = params;

  if (puntos === 0) {
    console.log(`[registrarMovimientoPuntos] Omitiendo movimiento de 0 puntos para usuario #${usuarioId} (${tipo})`);
    return await recalcularSaldoPuntosUsuario(conn, usuarioId);
  }

  try {
    // Intentar insertar el movimiento. La clave única (referencia_tipo, referencia_id, tipo) protege contra duplicados.
    await qRun(
      conn,
      `INSERT INTO movimientos_puntos 
        (usuario_id, tipo, puntos, descripcion, referencia_id, referencia_tipo, creado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        usuarioId,
        tipo,
        puntos,
        descripcion || null,
        referenciaId || null,
        referenciaTipo || null,
        creadoPor || null,
      ]
    );
    console.log(`[registrarMovimientoPuntos] Movimiento creado: ${tipo} (${puntos} pts) para usuario #${usuarioId}`);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      console.log(`[registrarMovimientoPuntos] Movimiento duplicado detectado e ignorado: ${tipo} para #${usuarioId} (Ref: ${referenciaTipo} ${referenciaId})`);
    } else {
      console.error(`[registrarMovimientoPuntos] Error crítico al insertar movimiento:`, error);
      throw error; // Re-lanzar para que la transacción externa falle si es necesario
    }
  }

  // SIEMPRE recalcular saldo tras un intento de movimiento (sea nuevo o duplicado ignorado)
  return await recalcularSaldoPuntosUsuario(conn, usuarioId);
}

export async function removerPuntosAcreditadosPorCompra(
  conn: Queryable,
  orderId: number,
  usuarioId: number | null | undefined,
): Promise<void> {
  const acreditado = await qOne<{ total: number }>(
    conn,
    `SELECT COALESCE(SUM(puntos), 0) AS total
     FROM movimientos_puntos
     WHERE referencia_tipo = 'ordenes'
       AND referencia_id = ?
       AND tipo = 'acreditacion_compra'
       AND puntos > 0`,
    [orderId],
  );
  const puntosAcreditados = Number(acreditado?.total ?? 0);
  if (!usuarioId || puntosAcreditados <= 0) {
    if (usuarioId) await recalcularSaldoPuntosUsuario(conn, Number(usuarioId));
    return;
  }

  await registrarMovimientoPuntos(conn, {
    usuarioId: Number(usuarioId),
    tipo: "ajuste",
    puntos: -puntosAcreditados,
    descripcion: `Anulacion de puntos por cancelacion de compra #${orderId}`,
    referenciaId: orderId,
    referenciaTipo: "ordenes_cancelacion",
  });
}

/**
 * Acredita puntos por compra de una orden pagada.
 */
export async function acreditarPuntosPorCompra(conn: Queryable, orderId: number): Promise<void> {
  console.log("[puntos] iniciando acreditacion", { orderId });

  try {
    const orden = await qOne<{ id: number; usuario_id: number; estado: string; total_dinero: number }>(
      conn,
      "SELECT id, usuario_id, estado, total_dinero FROM ordenes WHERE id = ?",
      [orderId],
    );

    if (!orden) {
      console.error("[puntos] ERROR: Orden no encontrada", { orderId });
      return;
    }
    
    const usuarioId = Number(orden.usuario_id);
    const estado = orden.estado;
    console.log("[puntos] orden encontrada", { orderId, usuarioId, estado });

    const paidStates = ["pagada", "preparandose", "preparada", "enviada", "entregando", "entregada"];
    if (!paidStates.includes(estado)) {
      console.log(`[puntos] omitiendo: orden #${orderId} esta en estado ${estado} (debe ser uno de: ${paidStates.join(", ")}).`);
      return;
    }

    // Calcular puntos (snapshot → producto → 0)
    const items = await qAll<{ cantidad: number; puntaje_al_comprar_unitario: number }>(
      conn,
      `SELECT oi.cantidad,
              COALESCE(NULLIF(oi.puntaje_al_comprar_unitario, 0), p.puntaje_al_comprar, 0) AS puntaje_al_comprar_unitario
       FROM orden_items oi
       LEFT JOIN productos p ON p.id = oi.producto_id
       WHERE oi.orden_id = ? AND oi.modo_compra = 'dinero'`,
      [orderId],
    );

    const puntos = items.reduce((acc, item) => acc + (Number(item.cantidad) * Number(item.puntaje_al_comprar_unitario)), 0);
    console.log("[puntos] puntos calculados", { orderId, usuarioId, puntos });

    if (puntos <= 0) {
      console.log("[puntos] la orden no suma puntos (productos sin puntaje o solo canjes)", { orderId });
      return;
    }

    // Usar la función central
    console.log("[puntos] creando movimiento", { orderId, usuarioId, puntos });
    const saldo = await registrarMovimientoPuntos(conn, {
      usuarioId,
      tipo: 'acreditacion_compra',
      puntos: puntos,
      descripcion: `Puntos acreditados por compra de orden #${orderId}`,
      referenciaId: orderId,
      referenciaTipo: 'ordenes',
      creadoPor: usuarioId
    });

    console.log("[puntos] movimiento creado o existente", { orderId, usuarioId });
    console.log("[puntos] saldo recalculado", { usuarioId, saldo });

  } catch (error) {
    console.error(`[puntos] ERROR CRÍTICO procesando orden #${orderId}:`, error);
    recordSecurityEvent("error_acreditacion_puntos", null as any, {
      orderId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
