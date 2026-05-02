import { qAll, qOne, qRun, type Queryable } from "../db";

type CanjeStockItem = {
  producto_id: number;
  cantidad: number;
};

type CheckoutStockItem = {
  producto_id: number;
  cantidad: number;
  origen: "compra" | "canje";
  descripcion?: string;
};

type InventoryRow = {
  stock_disponible: number;
  stock_reservado: number;
};

type ProductoStockMeta = {
  id: number;
  nombre: string;
  activo: number;
  track_stock: number;
  stock_disponible: number;
  stock_reservado: number;
};

async function ensureInventarioRow(conn: Queryable, productoId: number, sucursalId: number) {
  const current = await qOne<{ id: number }>(
    conn,
    "SELECT id FROM inventario_sucursal WHERE producto_id = ? AND sucursal_id = ? LIMIT 1",
    [productoId, sucursalId],
  );
  if (current) return;

  const existingRows = await qOne<{ c: number }>(
    conn,
    "SELECT COUNT(*) AS c FROM inventario_sucursal WHERE producto_id = ?",
    [productoId],
  );

  let initialDisponible = 0;
  let initialReservado = 0;
  if (Number(existingRows?.c ?? 0) === 0) {
    const producto = await qOne<ProductoStockMeta>(
      conn,
      "SELECT stock_disponible, stock_reservado FROM productos WHERE id = ? LIMIT 1",
      [productoId],
    );
    initialDisponible = Number(producto?.stock_disponible ?? 0);
    initialReservado = Number(producto?.stock_reservado ?? 0);
  }

  await qRun(
    conn,
    `INSERT INTO inventario_sucursal (producto_id, sucursal_id, stock_disponible, stock_reservado)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP`,
    [productoId, sucursalId, initialDisponible, initialReservado],
  );
}

async function getProductoMetaForStock(conn: Queryable, productoId: number): Promise<ProductoStockMeta> {
  const producto = await qOne<ProductoStockMeta>(
    conn,
    `SELECT id, nombre, activo, track_stock, stock_disponible, stock_reservado
     FROM productos
     WHERE id = ?
     LIMIT 1`,
    [productoId],
  );
  if (!producto) {
    throw new Error("Producto no encontrado.");
  }
  return {
    ...producto,
    activo: Number(producto.activo ?? 0),
    track_stock: Number(producto.track_stock ?? 0),
    stock_disponible: Number(producto.stock_disponible ?? 0),
    stock_reservado: Number(producto.stock_reservado ?? 0),
  };
}

async function lockInventoryRow(conn: Queryable, productoId: number, sucursalId: number): Promise<InventoryRow> {
  await ensureInventarioRow(conn, productoId, sucursalId);
  const row = await qOne<InventoryRow>(
    conn,
    `SELECT stock_disponible, stock_reservado
     FROM inventario_sucursal
     WHERE producto_id = ? AND sucursal_id = ?
     FOR UPDATE`,
    [productoId, sucursalId],
  );
  if (!row) {
    throw new Error("No se pudo crear o bloquear inventario de la sucursal.");
  }
  return {
    stock_disponible: Number(row.stock_disponible ?? 0),
    stock_reservado: Number(row.stock_reservado ?? 0),
  };
}

async function writeInventoryRow(
  conn: Queryable,
  productoId: number,
  sucursalId: number,
  stockDisponible: number,
  stockReservado: number,
) {
  await qRun(
    conn,
    `UPDATE inventario_sucursal
     SET stock_disponible = ?, stock_reservado = ?
     WHERE producto_id = ? AND sucursal_id = ?`,
    [stockDisponible, stockReservado, productoId, sucursalId],
  );
}

async function syncProductoGlobalStock(conn: Queryable, productoId: number) {
  const sum = await qOne<{ disponible: number; reservado: number }>(
    conn,
    `SELECT COALESCE(SUM(stock_disponible), 0) AS disponible,
            COALESCE(SUM(stock_reservado), 0) AS reservado
     FROM inventario_sucursal
     WHERE producto_id = ?`,
    [productoId],
  );
  await qRun(
    conn,
    `UPDATE productos
     SET stock_disponible = ?, stock_reservado = ?
     WHERE id = ?`,
    [Number(sum?.disponible ?? 0), Number(sum?.reservado ?? 0), productoId],
  );
}

async function recordStockMovement(
  conn: Queryable,
  {
    productoId,
    sucursalId,
    tipo,
    origen,
    cantidad,
    descripcion,
    creadoPor,
  }: {
    productoId: number;
    sucursalId: number | null;
    tipo: "ingreso" | "reserva" | "liberacion" | "descuento" | "ajuste";
    origen: "compra" | "canje" | "admin" | "devolucion";
    cantidad: number;
    descripcion?: string | null;
    creadoPor?: number | null;
  },
) {
  if (!cantidad) return;
  await qRun(
    conn,
    `INSERT INTO movimientos_stock
      (producto_id, sucursal_id, orden_id, tipo, origen, cantidad, descripcion, creado_por)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
    [productoId, sucursalId, tipo, origen, cantidad, descripcion ?? null, creadoPor ?? null],
  );
}

export async function reserveStockForCanje(
  conn: Queryable,
  {
    sucursalId,
    items,
    canjeId,
  }: {
    sucursalId: number;
    items: CanjeStockItem[];
    canjeId?: number;
  },
) {
  for (const item of items) {
    const productoId = Number(item.producto_id);
    const cantidad = Number(item.cantidad);
    if (!Number.isFinite(productoId) || productoId <= 0 || !Number.isFinite(cantidad) || cantidad <= 0) continue;

    const producto = await getProductoMetaForStock(conn, productoId);
    if (!producto.activo) {
      throw new Error(`El producto ${producto.nombre} no está activo.`);
    }
    if (!producto.track_stock) continue;

    const inv = await lockInventoryRow(conn, productoId, sucursalId);
    if (inv.stock_disponible < cantidad) {
      throw new Error(
        `Stock insuficiente para ${producto.nombre} en la sucursal seleccionada. Disponible: ${inv.stock_disponible}.`,
      );
    }

    await writeInventoryRow(conn, productoId, sucursalId, inv.stock_disponible - cantidad, inv.stock_reservado + cantidad);
    await recordStockMovement(conn, {
      productoId,
      sucursalId,
      tipo: "reserva",
      origen: "canje",
      cantidad,
      descripcion: canjeId ? `Reserva por canje #${canjeId}` : "Reserva por canje",
    });
    await syncProductoGlobalStock(conn, productoId);
  }
}

export async function releaseReservedStockForCanje(
  conn: Queryable,
  {
    sucursalId,
    items,
    canjeId,
    strict = false,
    creadoPor = null,
  }: {
    sucursalId: number;
    items: CanjeStockItem[];
    canjeId?: number;
    strict?: boolean;
    creadoPor?: number | null;
  },
) {
  for (const item of items) {
    const productoId = Number(item.producto_id);
    const cantidad = Number(item.cantidad);
    if (!Number.isFinite(productoId) || productoId <= 0 || !Number.isFinite(cantidad) || cantidad <= 0) continue;

    const producto = await getProductoMetaForStock(conn, productoId);
    if (!producto.track_stock) continue;

    const inv = await lockInventoryRow(conn, productoId, sucursalId);
    if (strict && inv.stock_reservado < cantidad) {
      throw new Error(
        `No hay stock reservado suficiente para liberar ${producto.nombre}. Reservado: ${inv.stock_reservado}.`,
      );
    }
    const qtyToRelease = Math.min(inv.stock_reservado, cantidad);
    if (qtyToRelease <= 0) continue;

    await writeInventoryRow(
      conn,
      productoId,
      sucursalId,
      inv.stock_disponible + qtyToRelease,
      inv.stock_reservado - qtyToRelease,
    );
    await recordStockMovement(conn, {
      productoId,
      sucursalId,
      tipo: "liberacion",
      origen: "canje",
      cantidad: qtyToRelease,
      descripcion: canjeId ? `Liberación por canje #${canjeId}` : "Liberación por canje",
      creadoPor,
    });
    await syncProductoGlobalStock(conn, productoId);
  }
}

export async function finalizeReservedStockForCanje(
  conn: Queryable,
  {
    sucursalId,
    items,
    canjeId,
    creadoPor = null,
  }: {
    sucursalId: number;
    items: CanjeStockItem[];
    canjeId?: number;
    creadoPor?: number | null;
  },
) {
  for (const item of items) {
    const productoId = Number(item.producto_id);
    const cantidad = Number(item.cantidad);
    if (!Number.isFinite(productoId) || productoId <= 0 || !Number.isFinite(cantidad) || cantidad <= 0) continue;

    const producto = await getProductoMetaForStock(conn, productoId);
    if (!producto.track_stock) continue;

    const inv = await lockInventoryRow(conn, productoId, sucursalId);
    const reservedUsed = Math.min(inv.stock_reservado, cantidad);
    const missingFromDisponible = cantidad - reservedUsed;
    if (missingFromDisponible > 0 && inv.stock_disponible < missingFromDisponible) {
      throw new Error(
        `No hay stock suficiente para entregar ${producto.nombre}. Disponible: ${inv.stock_disponible}, reservado: ${inv.stock_reservado}.`,
      );
    }

    await writeInventoryRow(
      conn,
      productoId,
      sucursalId,
      inv.stock_disponible - missingFromDisponible,
      inv.stock_reservado - reservedUsed,
    );

    if (reservedUsed > 0) {
      await recordStockMovement(conn, {
        productoId,
        sucursalId,
        tipo: "descuento",
        origen: "canje",
        cantidad: reservedUsed,
        descripcion: canjeId ? `Entrega canje #${canjeId} (desde reserva)` : "Entrega canje (desde reserva)",
        creadoPor,
      });
    }
    if (missingFromDisponible > 0) {
      await recordStockMovement(conn, {
        productoId,
        sucursalId,
        tipo: "descuento",
        origen: "canje",
        cantidad: missingFromDisponible,
        descripcion: canjeId ? `Entrega canje #${canjeId} (sin reserva previa)` : "Entrega canje (sin reserva previa)",
        creadoPor,
      });
    }
    await syncProductoGlobalStock(conn, productoId);
  }
}

export async function adjustStockBySucursal(
  conn: Queryable,
  {
    productoId,
    sucursalId,
    nuevoStockDisponible,
    descripcion,
    creadoPor,
  }: {
    productoId: number;
    sucursalId: number;
    nuevoStockDisponible: number;
    descripcion?: string | null;
    creadoPor?: number | null;
  },
) {
  if (!Number.isInteger(nuevoStockDisponible) || nuevoStockDisponible < 0) {
    throw new Error("El stock disponible debe ser un entero mayor o igual a 0.");
  }

  const producto = await getProductoMetaForStock(conn, productoId);
  if (!producto.track_stock) {
    throw new Error(`El producto ${producto.nombre} no usa control de stock.`);
  }

  const inv = await lockInventoryRow(conn, productoId, sucursalId);
  if (nuevoStockDisponible < inv.stock_reservado) {
    throw new Error(
      `No puedes dejar el stock disponible por debajo del reservado (${inv.stock_reservado}).`,
    );
  }

  const delta = nuevoStockDisponible - inv.stock_disponible;
  await writeInventoryRow(conn, productoId, sucursalId, nuevoStockDisponible, inv.stock_reservado);
  if (delta !== 0) {
    await recordStockMovement(conn, {
      productoId,
      sucursalId,
      tipo: "ajuste",
      origen: "admin",
      cantidad: delta,
      descripcion: descripcion ?? "Ajuste manual de stock",
      creadoPor,
    });
  }
  await syncProductoGlobalStock(conn, productoId);
}

export async function getCanjeItemsStock(conn: Queryable, canjeId: number): Promise<CanjeStockItem[]> {
  const rows = await qAll<{ producto_id: number; cantidad: number }>(
    conn,
    `SELECT producto_id, cantidad
     FROM canje_items
     WHERE canje_id = ?`,
    [canjeId],
  );
  return rows.map((row) => ({
    producto_id: Number(row.producto_id),
    cantidad: Number(row.cantidad),
  }));
}

export async function reserveStockForCheckoutItems(
  conn: Queryable,
  {
    sucursalId,
    items,
    referencia,
    creadoPor = null,
  }: {
    sucursalId: number;
    items: CheckoutStockItem[];
    referencia?: string;
    creadoPor?: number | null;
  },
) {
  for (const item of items) {
    const productoId = Number(item.producto_id);
    const cantidad = Number(item.cantidad);
    if (!Number.isFinite(productoId) || productoId <= 0 || !Number.isFinite(cantidad) || cantidad <= 0) continue;

    const producto = await getProductoMetaForStock(conn, productoId);
    if (!producto.activo) {
      throw new Error(`El producto ${producto.nombre} no está activo.`);
    }
    if (!producto.track_stock) continue;

    const inv = await lockInventoryRow(conn, productoId, sucursalId);
    if (inv.stock_disponible < cantidad) {
      throw new Error(
        `Stock insuficiente para ${producto.nombre} en la sucursal seleccionada. Disponible: ${inv.stock_disponible}.`,
      );
    }

    await writeInventoryRow(conn, productoId, sucursalId, inv.stock_disponible - cantidad, inv.stock_reservado + cantidad);
    await recordStockMovement(conn, {
      productoId,
      sucursalId,
      tipo: "reserva",
      origen: item.origen,
      cantidad,
      descripcion: item.descripcion ?? (referencia ? `Reserva ${referencia}` : "Reserva de checkout"),
      creadoPor,
    });
    await syncProductoGlobalStock(conn, productoId);
  }
}

export async function releaseStockForCheckoutItems(
  conn: Queryable,
  {
    sucursalId,
    items,
    referencia,
    creadoPor = null,
  }: {
    sucursalId: number;
    items: CheckoutStockItem[];
    referencia?: string;
    creadoPor?: number | null;
  },
) {
  for (const item of items) {
    const productoId = Number(item.producto_id);
    const cantidad = Number(item.cantidad);
    if (!Number.isFinite(productoId) || productoId <= 0 || !Number.isFinite(cantidad) || cantidad <= 0) continue;

    const producto = await getProductoMetaForStock(conn, productoId);
    if (!producto.track_stock) continue;

    const inv = await lockInventoryRow(conn, productoId, sucursalId);
    const qtyToRelease = Math.min(inv.stock_reservado, cantidad);
    if (qtyToRelease <= 0) continue;

    await writeInventoryRow(
      conn,
      productoId,
      sucursalId,
      inv.stock_disponible + qtyToRelease,
      inv.stock_reservado - qtyToRelease,
    );
    await recordStockMovement(conn, {
      productoId,
      sucursalId,
      tipo: "liberacion",
      origen: item.origen,
      cantidad: qtyToRelease,
      descripcion: item.descripcion ?? (referencia ? `Liberación ${referencia}` : "Liberación de checkout"),
      creadoPor,
    });
    await syncProductoGlobalStock(conn, productoId);
  }
}

export async function finalizeStockForCheckoutItems(
  conn: Queryable,
  {
    sucursalId,
    items,
    referencia,
    creadoPor = null,
  }: {
    sucursalId: number;
    items: CheckoutStockItem[];
    referencia?: string;
    creadoPor?: number | null;
  },
) {
  for (const item of items) {
    const productoId = Number(item.producto_id);
    const cantidad = Number(item.cantidad);
    if (!Number.isFinite(productoId) || productoId <= 0 || !Number.isFinite(cantidad) || cantidad <= 0) continue;

    const producto = await getProductoMetaForStock(conn, productoId);
    if (!producto.track_stock) continue;

    const inv = await lockInventoryRow(conn, productoId, sucursalId);
    const reservedUsed = Math.min(inv.stock_reservado, cantidad);
    const missingFromDisponible = cantidad - reservedUsed;

    if (missingFromDisponible > 0 && inv.stock_disponible < missingFromDisponible) {
      throw new Error(
        `No hay stock suficiente para finalizar ${producto.nombre}. Disponible: ${inv.stock_disponible}, reservado: ${inv.stock_reservado}.`,
      );
    }

    await writeInventoryRow(
      conn,
      productoId,
      sucursalId,
      inv.stock_disponible - missingFromDisponible,
      inv.stock_reservado - reservedUsed,
    );

    if (reservedUsed > 0) {
      await recordStockMovement(conn, {
        productoId,
        sucursalId,
        tipo: "descuento",
        origen: item.origen,
        cantidad: reservedUsed,
        descripcion: item.descripcion ?? (referencia ? `Entrega ${referencia} (desde reserva)` : "Entrega desde reserva"),
        creadoPor,
      });
    }

    if (missingFromDisponible > 0) {
      await recordStockMovement(conn, {
        productoId,
        sucursalId,
        tipo: "descuento",
        origen: item.origen,
        cantidad: missingFromDisponible,
        descripcion:
          item.descripcion ?? (referencia ? `Entrega ${referencia} (sin reserva previa)` : "Entrega sin reserva previa"),
        creadoPor,
      });
    }

    await syncProductoGlobalStock(conn, productoId);
  }
}
