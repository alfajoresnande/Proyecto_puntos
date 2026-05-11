import { Queryable, qOne, qRun, qAll } from "../db";
import { recordSecurityEvent } from "../securityMonitor";

export async function acreditarPuntosPorCompra(conn: Queryable, orderId: number) {
  try {
    const orden = await qOne<{ id: number; usuario_id: number; estado: string; total_dinero: number }>(
      conn,
      "SELECT id, usuario_id, estado, total_dinero FROM ordenes WHERE id = ?",
      [orderId]
    );

    if (!orden) return;
    if (orden.estado !== "pagada") return;
    if (Number(orden.total_dinero) <= 0) return;

    // Obtener los ítems comprados con dinero
    const items = await qAll<{ cantidad: number; puntaje_al_comprar_unitario: number }>(
      conn,
      "SELECT cantidad, puntaje_al_comprar_unitario FROM orden_items WHERE orden_id = ? AND modo_compra = 'dinero'",
      [orderId]
    );

    const puntosASumar = items.reduce((acc, item) => {
      const pts = Number(item.puntaje_al_comprar_unitario) || 0;
      return acc + (Number(item.cantidad) * pts);
    }, 0);

    if (puntosASumar <= 0) return;

    // Verificar si ya se acreditó (aunque el UNIQUE constraint también protege)
    const existente = await qOne(
      conn,
      "SELECT id FROM movimientos_puntos WHERE referencia_tipo = 'ordenes' AND referencia_id = ? AND tipo = 'acreditacion_compra' LIMIT 1",
      [orderId]
    );

    if (existente) return; // Ya acreditados (Idempotencia)

    // Insertar el movimiento
    await qRun(
      conn,
      `INSERT INTO movimientos_puntos 
        (usuario_id, tipo, puntos, descripcion, referencia_id, referencia_tipo, creado_por) 
       VALUES (?, 'acreditacion_compra', ?, ?, ?, 'ordenes', ?)`,
      [
        orden.usuario_id,
        puntosASumar,
        `Puntos acreditados por compra de orden #${orderId}`,
        orderId,
        orden.usuario_id
      ]
    );

    // Actualizar el saldo del usuario
    await qRun(
      conn,
      "UPDATE usuarios SET puntos_saldo = puntos_saldo + ? WHERE id = ?",
      [puntosASumar, orden.usuario_id]
    );

  } catch (error) {
    // Capturar el error y loguearlo de forma segura sin propagarlo
    // Esto asegura que approvePaidOrder no falle si los puntos fallan.
    recordSecurityEvent("error_acreditacion_puntos", null as any, {
      orderId,
      error: error instanceof Error ? error.message : String(error)
    });
    console.error(`[acreditarPuntosPorCompra] Error procesando orden ${orderId}:`, error);
  }
}
