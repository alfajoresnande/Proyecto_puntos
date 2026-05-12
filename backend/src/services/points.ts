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
  const saldo = Number(row?.saldo ?? 0);
  await qRun(
    conn,
    "UPDATE usuarios SET puntos_saldo = ? WHERE id = ?",
    [saldo, usuarioId],
  );
  console.log("[recalcularSaldoPuntosUsuario] Saldo recalculado correctamente", {
    usuarioId,
    saldo,
  });
  return saldo;
}

/**
 * Acredita puntos por compra de una orden pagada.
 *
 * Garantías:
 * - No duplica movimientos (UNIQUE constraint + check previo).
 * - Si el movimiento ya existía (webhook repetido, race condition), recalcula el saldo igualmente.
 * - Si el INSERT falla por duplicate key (race condition extrema), trata el caso como "ya existía".
 * - Siempre llama a recalcularSaldoPuntosUsuario antes de terminar si hay puntos a acreditar.
 * - El outer try/catch solo captura errores inesperados, no toca el flujo normal.
 */
export async function acreditarPuntosPorCompra(conn: Queryable, orderId: number): Promise<void> {
  console.log("Iniciando acreditacion de puntos", { orderId });

  try {
    const orden = await qOne<{ id: number; usuario_id: number; estado: string; total_dinero: number }>(
      conn,
      "SELECT id, usuario_id, estado, total_dinero FROM ordenes WHERE id = ?",
      [orderId],
    );

    if (!orden) {
      console.log("[acreditarPuntosPorCompra] Orden no encontrada", { orderId });
      return;
    }
    if (orden.estado !== "pagada") {
      console.log("[acreditarPuntosPorCompra] Orden no está en estado pagada, se omite", {
        orderId,
        estado: orden.estado,
      });
      return;
    }
    if (Number(orden.total_dinero) <= 0) {
      console.log("[acreditarPuntosPorCompra] Orden sin total en dinero, se omite", { orderId });
      return;
    }

    const usuarioId = Number(orden.usuario_id);

    // COALESCE multicapa: snapshot histórico → puntaje actual del producto → 0
    const items = await qAll<{ cantidad: number; puntaje_al_comprar_unitario: number }>(
      conn,
      `SELECT oi.cantidad,
              COALESCE(
                NULLIF(oi.puntaje_al_comprar_unitario, 0),
                p.puntaje_al_comprar,
                0
              ) AS puntaje_al_comprar_unitario
       FROM orden_items oi
       LEFT JOIN productos p ON p.id = oi.producto_id
       WHERE oi.orden_id = ? AND oi.modo_compra = 'dinero'`,
      [orderId],
    );

    const puntosASumar = items.reduce((acc, item) => {
      return acc + Number(item.cantidad) * (Number(item.puntaje_al_comprar_unitario) || 0);
    }, 0);

    console.log("Puntos calculados", {
      orderId,
      usuarioId,
      puntos: puntosASumar,
    });

    if (puntosASumar <= 0) {
      console.log("[acreditarPuntosPorCompra] Orden pagada sin puntos acreditables", {
        orden_id: orderId,
        usuario_id: usuarioId,
        cantidad_items: items.length,
        mensaje: "Productos sin puntaje_al_comprar configurado o solo canjes",
      });
      return;
    }

    // ─── Verificar idempotencia: ¿ya existe el movimiento? ───────────────────
    const existente = await qOne<{ id: number }>(
      conn,
      `SELECT id FROM movimientos_puntos
       WHERE referencia_tipo = 'ordenes'
         AND referencia_id = ?
         AND tipo = 'acreditacion_compra'
       LIMIT 1`,
      [orderId],
    );

    if (existente) {
      // Movimiento ya existe (webhook repetido, polling que llegó tarde, etc.)
      // No crear otro. Sí recalcular el saldo por si quedó desincronizado.
      console.log("Movimiento creado o ya existente", {
        orderId,
        usuarioId,
      });
      const saldo = await recalcularSaldoPuntosUsuario(conn, usuarioId);
      return;
    }

    // ─── Intentar insertar el movimiento ─────────────────────────────────────
    // Aislamos este bloque para poder tratar ER_DUP_ENTRY como caso normal
    // (race condition: dos webhooks simultáneos superaron el check de existente).
    let movimientoInsertado = false;
    try {
      await qRun(
        conn,
        `INSERT INTO movimientos_puntos
          (usuario_id, tipo, puntos, descripcion, referencia_id, referencia_tipo, creado_por)
         VALUES (?, 'acreditacion_compra', ?, ?, ?, 'ordenes', ?)`,
        [
          usuarioId,
          puntosASumar,
          `Puntos acreditados por compra de orden #${orderId}`,
          orderId,
          usuarioId,
        ],
      );
      movimientoInsertado = true;
      console.log("Movimiento creado o ya existente", {
        orderId,
        usuarioId,
      });
    } catch (insertError) {
      if (isDuplicateKeyError(insertError)) {
        // Race condition: otro proceso ya insertó el movimiento entre nuestro SELECT y este INSERT.
        // No es un error real, continúa al recálculo del saldo.
        console.log("Movimiento creado o ya existente", {
          orderId,
          usuarioId,
        });
      } else {
        // Error real (conexión, permisos, etc.) — propagarlo para que el outer catch lo registre.
        throw insertError;
      }
    }

    // ─── Recalcular saldo SIEMPRE (movimiento nuevo o ya existía por race) ───
    console.log("Recalculando saldo de puntos", { usuarioId });
    const saldoFinal = await recalcularSaldoPuntosUsuario(conn, usuarioId);
    console.log("[acreditarPuntosPorCompra] Acreditacion completada", {
      orderId,
      usuarioId,
      puntos: movimientoInsertado ? puntosASumar : 0,
      saldo_final: saldoFinal,
    });
  } catch (error) {
    // Solo llega aquí si ocurrió un error inesperado (no duplicate key, no flujo normal).
    // Se loguea y se captura para no romper el flujo de pago del usuario.
    recordSecurityEvent("error_acreditacion_puntos", null as any, {
      orderId,
      error: error instanceof Error ? error.message : String(error),
    });
    console.error("[acreditarPuntosPorCompra] Error inesperado procesando orden", {
      orderId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
