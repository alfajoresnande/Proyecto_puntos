import { qAll, qOne, qRun, type Queryable } from "../db";
import { finalizeStockForCheckoutItems, releaseStockForCheckoutItems } from "./stock";
import { acreditarPuntosPorCompra, recalcularSaldoPuntosUsuario, registrarMovimientoPuntos } from "./points";

export type OrderState = "borrador" | "pendiente_pago" | "pagada" | "preparada" | "enviada" | "entregada" | "cancelada" | "expirada";
export type OrderLifecycleResult = {
  ok: boolean;
  orderId: number;
  previousState: OrderState;
  state: OrderState;
  changed: boolean;
};

type OrderForLifecycle = {
  id: number;
  usuario_id: number;
  estado: OrderState;
  total_puntos: number;
  total_dinero: number;
  sucursal_retiro_id: number | null;
};

type OrderStockItemRow = {
  producto_id: number;
  cantidad: number;
  modo_compra: "dinero" | "puntos";
  track_stock: number;
};

function checkoutStockItems(items: OrderStockItemRow[], descripcion: string) {
  return items
    .filter((item) => Number(item.track_stock ?? 0) === 1)
    .map((item) => ({
      producto_id: Number(item.producto_id),
      cantidad: Number(item.cantidad),
      origen: item.modo_compra === "dinero" ? ("compra" as const) : ("canje" as const),
      descripcion,
    }));
}

export async function getOrderForLifecycle(conn: Queryable, orderId: number): Promise<OrderForLifecycle | undefined> {
  const order = await qOne<OrderForLifecycle>(
    conn,
    `SELECT id, usuario_id, estado, total_puntos, total_dinero, sucursal_retiro_id
     FROM ordenes
     WHERE id = ?
     LIMIT 1
     FOR UPDATE`,
    [orderId],
  );
  if (!order) return undefined;
  return {
    ...order,
    id: Number(order.id),
    usuario_id: Number(order.usuario_id),
    total_puntos: Number(order.total_puntos ?? 0),
    total_dinero: Number(order.total_dinero ?? 0),
    sucursal_retiro_id: order.sucursal_retiro_id === null ? null : Number(order.sucursal_retiro_id),
  };
}

async function getOrderStockItems(conn: Queryable, orderId: number): Promise<OrderStockItemRow[]> {
  const rows = await qAll<OrderStockItemRow>(
    conn,
    `SELECT oi.producto_id, oi.cantidad, oi.modo_compra, p.track_stock
     FROM orden_items oi
     JOIN productos p ON p.id = oi.producto_id
     WHERE oi.orden_id = ?
     ORDER BY oi.id ASC`,
    [orderId],
  );
  return rows.map((row) => ({
    ...row,
    producto_id: Number(row.producto_id),
    cantidad: Number(row.cantidad),
    track_stock: Number(row.track_stock ?? 0),
  }));
}

async function updatePaymentRows(
  conn: Queryable,
  {
    orderId,
    provider,
    providerPaymentId,
    estado,
    payload,
  }: {
    orderId: number;
    provider?: string | null;
    providerPaymentId?: string | null;
    estado: "aprobado" | "rechazado";
    payload?: unknown;
  },
) {
  const payloadJson = payload === undefined ? null : JSON.stringify(payload);
  const params: unknown[] = [estado];
  const setParts = ["estado = ?"];

  if (providerPaymentId) {
    setParts.push("provider_payment_id = ?");
    params.push(providerPaymentId);
  }
  if (payloadJson) {
    setParts.push("payload_json = ?");
    params.push(payloadJson);
  }

  params.push(orderId);
  const whereParts = ["orden_id = ?"];
  if (provider) {
    whereParts.push("proveedor = ?");
    params.push(provider);
  }

  const result = await qRun(
    conn,
    `UPDATE pagos
     SET ${setParts.join(", ")}
     WHERE ${whereParts.join(" AND ")}
       AND estado = 'iniciado'`,
    params,
  );

  if (result.affectedRows === 0 && provider && providerPaymentId) {
    // Evitar duplicados: Si ya existe una fila aprobada con el mismo provider_payment_id para esta orden, no insertamos otra.
    const yaExiste = await qOne<{ id: number }>(
      conn,
      "SELECT id FROM pagos WHERE orden_id = ? AND provider_payment_id = ? AND estado = 'aprobado' LIMIT 1",
      [orderId, providerPaymentId]
    );

    if (!yaExiste) {
      await qRun(
        conn,
        `INSERT INTO pagos (orden_id, proveedor, metodo, estado, monto, moneda, provider_payment_id, payload_json)
         SELECT id, ?, NULL, ?, total_dinero, moneda, ?, ?
         FROM ordenes
         WHERE id = ?`,
        [provider, estado, providerPaymentId, payloadJson, orderId],
      );
    }
  }
}

async function refundOrderPointsIfReserved(
  conn: Queryable,
  order: OrderForLifecycle,
  descripcion: string,
  creadoPor: number | null,
) {
  if (Number(order.total_puntos ?? 0) <= 0) return;
  if (!(order.estado === "pendiente_pago" || order.estado === "preparada")) return;

  await registrarMovimientoPuntos(conn, {
    usuarioId: order.usuario_id,
    tipo: 'devolucion_canje',
    puntos: order.total_puntos,
    descripcion,
    referenciaId: order.id,
    referenciaTipo: 'ordenes',
    creadoPor: creadoPor ?? undefined
  });
}

export async function approvePaidOrder(
  conn: Queryable,
  {
    orderId,
    provider,
    providerPaymentId,
    payload,
    creadoPor = null,
  }: {
    orderId: number;
    provider?: string | null;
    providerPaymentId?: string | null;
    payload?: unknown;
    creadoPor?: number | null;
  },
): Promise<OrderLifecycleResult> {
  console.log("[approvePaidOrder] ejecutado", { orderId });
  const order = await getOrderForLifecycle(conn, orderId);
  if (!order) {
    throw new Error("Orden no encontrada.");
  }

  if (order.estado !== "pendiente_pago") {
    await updatePaymentRows(conn, { orderId, provider, providerPaymentId, estado: "aprobado", payload });
    console.log("[approvePaidOrder] Orden ya no estaba en pendiente_pago, verificando puntos igualmente", {
      orderId,
      estado: order.estado,
    });
    // Intentar acreditar puntos igualmente por si el proceso anterior falló (idempotente)
    await acreditarPuntosPorCompra(conn, orderId);
    return { ok: true, orderId, previousState: order.estado, state: order.estado, changed: false };
  }

  if (order.sucursal_retiro_id) {
    const items = checkoutStockItems(await getOrderStockItems(conn, orderId), `Pago aprobado orden #${orderId}`);
    if (items.length) {
      await finalizeStockForCheckoutItems(conn, {
        sucursalId: order.sucursal_retiro_id,
        items,
        referencia: `orden #${orderId}`,
        ordenId: orderId,
        creadoPor,
      });
    }
  }

  await updatePaymentRows(conn, { orderId, provider, providerPaymentId, estado: "aprobado", payload });
  await qRun(conn, "UPDATE ordenes SET estado = 'pagada' WHERE id = ?", [orderId]);
  
  // Acreditación automática de puntos
  await acreditarPuntosPorCompra(conn, orderId);
  
  return { ok: true, orderId, previousState: order.estado, state: "pagada", changed: true };
}

export async function rejectOrExpirePendingOrder(
  conn: Queryable,
  {
    orderId,
    nextState,
    provider,
    providerPaymentId,
    payload,
    creadoPor = null,
  }: {
    orderId: number;
    nextState: "cancelada" | "expirada";
    provider?: string | null;
    providerPaymentId?: string | null;
    payload?: unknown;
    creadoPor?: number | null;
  },
): Promise<OrderLifecycleResult> {
  const order = await getOrderForLifecycle(conn, orderId);
  if (!order) {
    throw new Error("Orden no encontrada.");
  }

  if (!(order.estado === "pendiente_pago" || order.estado === "preparada")) {
    await updatePaymentRows(conn, { orderId, provider, providerPaymentId, estado: "rechazado", payload });
    return { ok: true, orderId, previousState: order.estado, state: order.estado, changed: false };
  }

  if (order.sucursal_retiro_id) {
    const items = checkoutStockItems(await getOrderStockItems(conn, orderId), `${nextState} orden #${orderId}`);
    if (items.length) {
      await releaseStockForCheckoutItems(conn, {
        sucursalId: order.sucursal_retiro_id,
        items,
        referencia: `${nextState} orden #${orderId}`,
        creadoPor,
        ordenId: orderId,
      });
    }
  }

  await refundOrderPointsIfReserved(
    conn,
    order,
    `Devolucion puntos por ${nextState} orden #${orderId}`,
    creadoPor,
  );
  await updatePaymentRows(conn, { orderId, provider, providerPaymentId, estado: "rechazado", payload });
  await qRun(conn, "UPDATE ordenes SET estado = ? WHERE id = ?", [nextState, orderId]);
  return { ok: true, orderId, previousState: order.estado, state: nextState, changed: true };
}
