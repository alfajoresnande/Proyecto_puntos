import { qOne, qRun, type Queryable } from "../db";
import { resolvePaymentFee } from "./paymentFees";
import {
  finalizeFlavorStockForCheckoutItems,
  finalizeStockForCheckoutItems,
  releaseFlavorStockForCheckoutItems,
  releaseStockForCheckoutItems,
} from "./stock";

type PendingCheckoutState = "pendiente_pago" | "pagada" | "cancelada" | "expirada";
type PendingCheckoutPaymentState = "iniciado" | "aprobado" | "rechazado" | "reembolsado";

export type PendingCheckoutItemFlavor = {
  sabor_id: number;
  nombre: string;
  cantidad: number;
};

export type PendingCheckoutItem = {
  producto_id: number;
  cantidad: number;
  modo_compra: "dinero" | "puntos";
  config_hash: string;
  precio_dinero_unit: number | null;
  precio_puntos_unit: number | null;
  subtotal_dinero: number;
  subtotal_puntos: number;
  track_stock: number;
  puntaje_al_comprar_unitario: number;
  nombre: string;
  sabores: PendingCheckoutItemFlavor[];
};

export type PendingCheckoutRecord = {
  id: number;
  usuario_id: number;
  carrito_id: number;
  orden_id: number | null;
  estado: PendingCheckoutState;
  metodo_entrega: "retiro" | "envio";
  sucursal_retiro_id: number | null;
  direccion_envio_json: string | null;
  envio_zona_id: number | null;
  envio_costo: number;
  envio_cotizacion_json: string | null;
  notas: string | null;
  moneda: string;
  total_dinero: number;
  total_puntos: number;
  total_puntos_ganados: number;
  proveedor: string;
  metodo: string | null;
  pago_estado: PendingCheckoutPaymentState;
  comision_porcentaje: number | null;
  comision_monto: number | null;
  monto_neto: number | null;
  provider_payment_id: string | null;
  checkout_url: string | null;
  payload_json: string | null;
  items_json: string;
  created_at: string;
  updated_at: string;
};

type CreatePendingCheckoutInput = {
  usuarioId: number;
  carritoId: number;
  metodoEntrega: "retiro" | "envio";
  sucursalRetiroId: number | null;
  direccionEnvioJson: string | null;
  envioZonaId: number | null;
  envioCosto: number;
  envioCotizacionJson: string | null;
  notas: string | null;
  moneda: string;
  totalDinero: number;
  totalPuntos: number;
  totalPuntosGanados: number;
  proveedor: string;
  metodo: string | null;
  items: PendingCheckoutItem[];
};

type UpdatePendingCheckoutPaymentInput = {
  checkoutId: number;
  proveedor: string;
  metodo: string | null;
  pagoEstado?: PendingCheckoutPaymentState;
  comisionPorcentaje?: number | null;
  comisionMonto?: number | null;
  montoNeto?: number | null;
  providerPaymentId?: string | null;
  checkoutUrl?: string | null;
  payload?: unknown;
};

type ResolvePendingCheckoutOrderInput = {
  checkoutId: number;
  providerPaymentId?: string | null;
  payload?: unknown;
};

function toMoney(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parseItemsJson(value: string): PendingCheckoutItem[] {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => ({
      producto_id: Number(item?.producto_id),
      cantidad: Number(item?.cantidad),
      modo_compra: item?.modo_compra === "puntos" ? "puntos" : "dinero",
      config_hash: String(item?.config_hash ?? ""),
      precio_dinero_unit: item?.precio_dinero_unit === null || item?.precio_dinero_unit === undefined ? null : Number(item.precio_dinero_unit),
      precio_puntos_unit: item?.precio_puntos_unit === null || item?.precio_puntos_unit === undefined ? null : Number(item.precio_puntos_unit),
      subtotal_dinero: Number(item?.subtotal_dinero ?? 0),
      subtotal_puntos: Number(item?.subtotal_puntos ?? 0),
      track_stock: Number(item?.track_stock ?? 0),
      puntaje_al_comprar_unitario: Number(item?.puntaje_al_comprar_unitario ?? 0),
      nombre: String(item?.nombre ?? ""),
      sabores: Array.isArray(item?.sabores)
        ? item.sabores.map((flavor: any) => ({
            sabor_id: Number(flavor?.sabor_id),
            nombre: String(flavor?.nombre ?? ""),
            cantidad: Number(flavor?.cantidad ?? 0),
          }))
        : [],
    }));
  } catch {
    return [];
  }
}

function normalizePendingCheckoutRow(row: PendingCheckoutRecord | undefined): PendingCheckoutRecord | undefined {
  if (!row) return undefined;
  return {
    ...row,
    id: Number(row.id),
    usuario_id: Number(row.usuario_id),
    carrito_id: Number(row.carrito_id),
    orden_id: row.orden_id === null ? null : Number(row.orden_id),
    sucursal_retiro_id: row.sucursal_retiro_id === null ? null : Number(row.sucursal_retiro_id),
    envio_zona_id: row.envio_zona_id === null ? null : Number(row.envio_zona_id),
    envio_costo: Number(row.envio_costo ?? 0),
    total_dinero: Number(row.total_dinero ?? 0),
    total_puntos: Number(row.total_puntos ?? 0),
    total_puntos_ganados: Number(row.total_puntos_ganados ?? 0),
    comision_porcentaje: row.comision_porcentaje === null ? null : Number(row.comision_porcentaje),
    comision_monto: row.comision_monto === null ? null : Number(row.comision_monto),
    monto_neto: row.monto_neto === null ? null : Number(row.monto_neto),
  };
}

function checkoutStockItems(items: PendingCheckoutItem[], descripcion: string) {
  return items
    .filter((item) => Number(item.track_stock ?? 0) === 1)
    .map((item) => ({
      producto_id: Number(item.producto_id),
      cantidad: Number(item.cantidad),
      origen: "compra" as const,
      descripcion,
    }));
}

function checkoutFlavorStockItems(items: PendingCheckoutItem[], descripcion: string) {
  return items.flatMap((item) =>
    item.sabores.map((sabor) => ({
      sabor_id: Number(sabor.sabor_id),
      cantidad: Number(sabor.cantidad),
      origen: "compra" as const,
      descripcion,
    })),
  );
}

export function toPendingCheckoutRouteId(checkoutId: number): number {
  return -Math.abs(Number(checkoutId));
}

export function isPendingCheckoutRouteId(routeId: number): boolean {
  return Number(routeId) < 0;
}

export function routeIdToPendingCheckoutId(routeId: number): number {
  return Math.abs(Number(routeId));
}

export function buildPendingCheckoutExternalReference(checkoutId: number): string {
  return `checkout_${Math.trunc(checkoutId)}`;
}

export function parsePendingCheckoutIdFromReference(reference: string | null | undefined): number | null {
  const normalized = String(reference ?? "").trim();
  if (!normalized) return null;
  const direct = Number(normalized);
  if (Number.isInteger(direct) && direct < 0) return Math.abs(direct);
  const match = normalized.match(/(?:checkout|pago|payment)[_-]?(\d+)/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function getPendingCheckoutForUser(
  conn: Queryable,
  checkoutId: number,
  usuarioId: number,
  { forUpdate = false }: { forUpdate?: boolean } = {},
): Promise<PendingCheckoutRecord | undefined> {
  const row = await qOne<PendingCheckoutRecord>(
    conn,
    `SELECT *
     FROM checkout_pendientes
     WHERE id = ? AND usuario_id = ?
     LIMIT 1
     ${forUpdate ? "FOR UPDATE" : ""}`,
    [checkoutId, usuarioId],
  );
  return normalizePendingCheckoutRow(row);
}

export async function getPendingCheckoutByPaymentReference(
  conn: Queryable,
  providerPaymentId: string,
  { forUpdate = false }: { forUpdate?: boolean } = {},
): Promise<PendingCheckoutRecord | undefined> {
  const row = await qOne<PendingCheckoutRecord>(
    conn,
    `SELECT *
     FROM checkout_pendientes
     WHERE provider_payment_id = ?
     ORDER BY updated_at DESC, id DESC
     LIMIT 1
     ${forUpdate ? "FOR UPDATE" : ""}`,
    [providerPaymentId],
  );
  return normalizePendingCheckoutRow(row);
}

export async function createPendingCheckout(
  conn: Queryable,
  input: CreatePendingCheckoutInput,
): Promise<number> {
  const created = await qRun(
    conn,
    `INSERT INTO checkout_pendientes (
       usuario_id, carrito_id, estado, metodo_entrega, sucursal_retiro_id, direccion_envio_json, envio_zona_id,
       envio_costo, envio_cotizacion_json, notas, moneda, total_dinero, total_puntos, total_puntos_ganados,
       proveedor, metodo, items_json
     ) VALUES (?, ?, 'pendiente_pago', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.usuarioId,
      input.carritoId,
      input.metodoEntrega,
      input.sucursalRetiroId,
      input.direccionEnvioJson,
      input.envioZonaId,
      toMoney(input.envioCosto),
      input.envioCotizacionJson,
      input.notas,
      input.moneda || "ARS",
      toMoney(input.totalDinero),
      Number(input.totalPuntos ?? 0),
      Number(input.totalPuntosGanados ?? 0),
      input.proveedor,
      input.metodo,
      JSON.stringify(input.items),
    ],
  );
  return Number(created.insertId);
}

export async function updatePendingCheckoutPayment(
  conn: Queryable,
  input: UpdatePendingCheckoutPaymentInput,
): Promise<void> {
  await qRun(
    conn,
    `UPDATE checkout_pendientes
     SET proveedor = ?,
         metodo = ?,
         pago_estado = ?,
         comision_porcentaje = ?,
         comision_monto = ?,
         monto_neto = ?,
         provider_payment_id = ?,
         checkout_url = ?,
         payload_json = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      input.proveedor,
      input.metodo,
      input.pagoEstado ?? "iniciado",
      input.comisionPorcentaje ?? null,
      input.comisionMonto ?? null,
      input.montoNeto ?? null,
      input.providerPaymentId ?? null,
      input.checkoutUrl ?? null,
      input.payload === undefined ? null : JSON.stringify(input.payload),
      input.checkoutId,
    ],
  );
}

async function releasePendingCheckoutReservations(
  conn: Queryable,
  checkout: PendingCheckoutRecord,
  nextState: "cancelada" | "expirada",
  creadoPor: number | null = null,
) {
  if (!checkout.sucursal_retiro_id) return;
  const items = parseItemsJson(checkout.items_json);
  const stockItems = checkoutStockItems(items, `${nextState} checkout #${checkout.id}`);
  const flavorItems = checkoutFlavorStockItems(items, `${nextState} checkout #${checkout.id}`);
  if (stockItems.length) {
    await releaseStockForCheckoutItems(conn, {
      sucursalId: checkout.sucursal_retiro_id,
      items: stockItems,
      referencia: `checkout #${checkout.id}`,
      creadoPor,
      ordenId: null,
    });
  }
  if (flavorItems.length) {
    await releaseFlavorStockForCheckoutItems(conn, {
      sucursalId: checkout.sucursal_retiro_id,
      items: flavorItems,
      referencia: `checkout #${checkout.id}`,
      creadoPor,
      ordenId: null,
    });
  }
}

export async function cancelOpenPendingCheckoutsForUser(
  conn: Queryable,
  usuarioId: number,
  { exceptCheckoutId = null }: { exceptCheckoutId?: number | null } = {},
): Promise<void> {
  const params: Array<number | string> = [usuarioId];
  const exceptSql = exceptCheckoutId ? "AND id <> ?" : "";
  if (exceptCheckoutId) params.push(exceptCheckoutId);
  const rows = await (async () => {
    const result = await (conn as any).query(
      `SELECT *
       FROM checkout_pendientes
       WHERE usuario_id = ?
         AND estado = 'pendiente_pago'
         ${exceptSql}
       ORDER BY id ASC
       FOR UPDATE`,
      params,
    );
    return result[0] as PendingCheckoutRecord[];
  })();
  for (const raw of rows) {
    const checkout = normalizePendingCheckoutRow(raw);
    if (!checkout) continue;
    await releasePendingCheckoutReservations(conn, checkout, "cancelada");
    await qRun(
      conn,
      `UPDATE checkout_pendientes
       SET estado = 'cancelada',
           pago_estado = CASE WHEN pago_estado = 'aprobado' THEN pago_estado ELSE 'rechazado' END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [checkout.id],
    );
  }
}

async function decrementCartItemFlavorQuantities(
  conn: Queryable,
  cartItemId: number,
  purchasedFlavors: PendingCheckoutItemFlavor[],
) {
  for (const flavor of purchasedFlavors) {
    const existing = await qOne<{ id: number; cantidad: number }>(
      conn,
      `SELECT id, cantidad
       FROM carrito_item_sabores
       WHERE carrito_item_id = ? AND sabor_id = ?
       LIMIT 1
       FOR UPDATE`,
      [cartItemId, Number(flavor.sabor_id)],
    );
    if (!existing) continue;
    const nextQty = Number(existing.cantidad ?? 0) - Number(flavor.cantidad ?? 0);
    if (nextQty > 0) {
      await qRun(
        conn,
        "UPDATE carrito_item_sabores SET cantidad = ? WHERE id = ?",
        [nextQty, Number(existing.id)],
      );
    } else {
      await qRun(conn, "DELETE FROM carrito_item_sabores WHERE id = ?", [Number(existing.id)]);
    }
  }
}

async function removePurchasedItemsFromCart(
  conn: Queryable,
  carritoId: number,
  items: PendingCheckoutItem[],
) {
  for (const item of items) {
    const cartItem = await qOne<{
      id: number;
      cantidad: number;
      precio_dinero_unit: number | null;
      precio_puntos_unit: number | null;
      subtotal_dinero: number;
      subtotal_puntos: number;
    }>(
      conn,
      `SELECT id, cantidad, precio_dinero_unit, precio_puntos_unit, subtotal_dinero, subtotal_puntos
       FROM carrito_items
       WHERE carrito_id = ? AND producto_id = ? AND modo_compra = ? AND config_hash = ?
       LIMIT 1
       FOR UPDATE`,
      [carritoId, item.producto_id, item.modo_compra, item.config_hash ?? ""],
    );
    if (!cartItem) continue;

    const remainingQty = Number(cartItem.cantidad ?? 0) - Number(item.cantidad ?? 0);
    if (remainingQty <= 0) {
      await qRun(conn, "DELETE FROM carrito_items WHERE id = ?", [Number(cartItem.id)]);
      continue;
    }

    const nextSubtotalDinero = item.precio_dinero_unit === null ? 0 : toMoney(Number(cartItem.precio_dinero_unit ?? 0) * remainingQty);
    const nextSubtotalPuntos = item.precio_puntos_unit === null ? 0 : Number(cartItem.precio_puntos_unit ?? 0) * remainingQty;
    await qRun(
      conn,
      `UPDATE carrito_items
       SET cantidad = ?, subtotal_dinero = ?, subtotal_puntos = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [remainingQty, nextSubtotalDinero, nextSubtotalPuntos, Number(cartItem.id)],
    );
    if (item.sabores.length) {
      await decrementCartItemFlavorQuantities(conn, Number(cartItem.id), item.sabores);
    }
  }
  await qRun(conn, "UPDATE carritos SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", [carritoId]);
}

export async function approvePendingCheckoutAndCreateOrder(
  conn: Queryable,
  input: ResolvePendingCheckoutOrderInput,
): Promise<{ orderId: number; alreadyApproved: boolean }> {
  const checkout = await qOne<PendingCheckoutRecord>(
    conn,
    `SELECT *
     FROM checkout_pendientes
     WHERE id = ?
     LIMIT 1
     FOR UPDATE`,
    [input.checkoutId],
  );
  const pending = normalizePendingCheckoutRow(checkout);
  if (!pending) {
    throw new Error("Checkout pendiente no encontrado.");
  }

  if (pending.orden_id) {
    return { orderId: pending.orden_id, alreadyApproved: true };
  }
  if (pending.estado !== "pendiente_pago") {
    throw new Error(`El checkout pendiente ya no se puede aprobar porque esta en estado '${pending.estado}'.`);
  }

  const items = parseItemsJson(pending.items_json);
  if (!items.length) {
    throw new Error("El checkout pendiente no tiene items validos para crear la orden.");
  }

  const insertedOrder = await qRun(
    conn,
    `INSERT INTO ordenes
      (usuario_id, carrito_id, canal, tipo_orden, estado, moneda, total_dinero, total_puntos,
       direccion_envio_json, sucursal_retiro_id, envio_zona_id, envio_costo, envio_cotizacion_json, notas)
     VALUES (?, ?, 'web', 'venta', 'pagada', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      pending.usuario_id,
      pending.carrito_id,
      pending.moneda || "ARS",
      pending.total_dinero,
      pending.total_puntos,
      pending.direccion_envio_json,
      pending.sucursal_retiro_id,
      pending.envio_zona_id,
      pending.envio_costo,
      pending.envio_cotizacion_json,
      pending.notas,
    ],
  );
  const orderId = Number(insertedOrder.insertId);

  for (const item of items) {
    const insertedItem = await qRun(
      conn,
      `INSERT INTO orden_items
        (orden_id, producto_id, cantidad, modo_compra, config_hash, precio_dinero_unit, precio_puntos_unit, subtotal_dinero, subtotal_puntos, puntaje_al_comprar_unitario)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderId,
        item.producto_id,
        item.cantidad,
        item.modo_compra,
        item.config_hash ?? "",
        item.precio_dinero_unit,
        item.precio_puntos_unit,
        item.subtotal_dinero,
        item.subtotal_puntos,
        item.puntaje_al_comprar_unitario ?? 0,
      ],
    );
    for (const sabor of item.sabores) {
      await qRun(
        conn,
        `INSERT INTO orden_item_sabores (orden_item_id, sabor_id, sabor_nombre, cantidad)
         VALUES (?, ?, ?, ?)`,
        [insertedItem.insertId, sabor.sabor_id, sabor.nombre, sabor.cantidad],
      );
    }
  }

  if (pending.sucursal_retiro_id) {
    const stockItems = checkoutStockItems(items, `Pago aprobado checkout #${pending.id}`);
    const flavorItems = checkoutFlavorStockItems(items, `Pago aprobado checkout #${pending.id}`);
    if (stockItems.length) {
      await finalizeStockForCheckoutItems(conn, {
        sucursalId: pending.sucursal_retiro_id,
        items: stockItems,
        referencia: `checkout #${pending.id}`,
        ordenId: orderId,
      });
    }
    if (flavorItems.length) {
      await finalizeFlavorStockForCheckoutItems(conn, {
        sucursalId: pending.sucursal_retiro_id,
        items: flavorItems,
        referencia: `checkout #${pending.id}`,
        ordenId: orderId,
      });
    }
  }

  const comision = pending.comision_porcentaje === null || pending.comision_monto === null || pending.monto_neto === null
    ? await resolvePaymentFee(conn, {
        proveedor: pending.proveedor,
        metodo: pending.metodo,
        monto: pending.total_dinero,
      })
    : {
        porcentaje: Number(pending.comision_porcentaje ?? 0),
        montoComision: Number(pending.comision_monto ?? 0),
        montoNeto: Number(pending.monto_neto ?? pending.total_dinero),
        descripcion: null,
      };

  await qRun(
    conn,
    `INSERT INTO pagos (
       orden_id, proveedor, metodo, estado, monto, comision_porcentaje, comision_monto, monto_neto,
       moneda, provider_payment_id, checkout_url, payload_json
     ) VALUES (?, ?, ?, 'aprobado', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      orderId,
      pending.proveedor,
      pending.metodo,
      pending.total_dinero,
      comision.porcentaje,
      comision.montoComision,
      comision.montoNeto,
      pending.moneda || "ARS",
      input.providerPaymentId ?? pending.provider_payment_id ?? null,
      pending.checkout_url,
      input.payload === undefined ? pending.payload_json : JSON.stringify(input.payload),
    ],
  );

  await qRun(
    conn,
    `UPDATE checkout_pendientes
     SET estado = 'pagada',
         pago_estado = 'aprobado',
         orden_id = ?,
         provider_payment_id = COALESCE(?, provider_payment_id),
         payload_json = COALESCE(?, payload_json),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      orderId,
      input.providerPaymentId ?? null,
      input.payload === undefined ? null : JSON.stringify(input.payload),
      pending.id,
    ],
  );

  await removePurchasedItemsFromCart(conn, pending.carrito_id, items);
  return { orderId, alreadyApproved: false };
}

export async function rejectOrExpirePendingCheckout(
  conn: Queryable,
  {
    checkoutId,
    nextState,
    providerPaymentId = null,
    payload,
  }: {
    checkoutId: number;
    nextState: "cancelada" | "expirada";
    providerPaymentId?: string | null;
    payload?: unknown;
  },
): Promise<void> {
  const checkout = await qOne<PendingCheckoutRecord>(
    conn,
    `SELECT *
     FROM checkout_pendientes
     WHERE id = ?
     LIMIT 1
     FOR UPDATE`,
    [checkoutId],
  );
  const pending = normalizePendingCheckoutRow(checkout);
  if (!pending) {
    throw new Error("Checkout pendiente no encontrado.");
  }
  if (pending.orden_id || pending.estado === "pagada") {
    return;
  }
  if (pending.estado !== "pendiente_pago") {
    return;
  }

  await releasePendingCheckoutReservations(conn, pending, nextState);
  await qRun(
    conn,
    `UPDATE checkout_pendientes
     SET estado = ?,
         pago_estado = 'rechazado',
         provider_payment_id = COALESCE(?, provider_payment_id),
         payload_json = COALESCE(?, payload_json),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      nextState,
      providerPaymentId,
      payload === undefined ? null : JSON.stringify(payload),
      pending.id,
    ],
  );
}
