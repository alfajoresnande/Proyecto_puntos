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

    // Obtener los ítems comprados con dinero.
    // Usar COALESCE para proteger contra snapshots que llegaron en 0 por carritos viejos:
    //   1. Si puntaje_al_comprar_unitario > 0 → usar ese (snapshot histórico correcto).
    //   2. Si es 0 → intentar obtener puntaje_al_comprar del producto actual como fallback.
    //   3. Si el producto tampoco tiene → 0.
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
      [orderId]
    );

    const puntosASumar = items.reduce((acc, item) => {
      const pts = Number(item.puntaje_al_comprar_unitario) || 0;
      return acc + (Number(item.cantidad) * pts);
    }, 0);

    if (puntosASumar <= 0) {
      // Log seguro: orden pagada pero sin puntos acreditables
      const totalItems = items.length;
      const sumaPuntaje = items.reduce((acc, item) => acc + Number(item.puntaje_al_comprar_unitario || 0), 0);
      console.info(
        `[acreditarPuntosPorCompra] Orden pagada sin puntos acreditables:`,
        {
          orden_id: orderId,
          usuario_id: orden.usuario_id,
          cantidad_items: totalItems,
          suma_puntaje_unitario: sumaPuntaje,
          mensaje: "Orden pagada sin puntos acreditables (productos sin puntaje_al_comprar o solo canjes)",
        }
      );
      return;
    }

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

    console.info(`[acreditarPuntosPorCompra] Acreditados ${puntosASumar} puntos para orden #${orderId} (usuario #${orden.usuario_id})`);

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
