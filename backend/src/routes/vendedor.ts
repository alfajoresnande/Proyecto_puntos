import { Router } from "express";
import { z } from "zod";
import { pool, qOne, qAll, qRun } from "../db";
import { requireAuth, requireRole } from "../auth";
import { emitRealtime } from "../realtime";
import { finalizeStockForCheckoutItems } from "../services/stock";
import {
  closeCajaSesion,
  closeStaleCajaSesiones,
  ensureDailyCajaSesion,
  formatCashDateStamp,
  getActiveCajaSesion,
  getCajaSesionSummary,
  normalizeCashPaymentMethod,
  openCajaSesion,
  registerCajaMovimiento,
  syncCajaSesionClosureState,
} from "../services/cashRegister";
import { createPricingResolver, getActiveClientePricingProfile } from "../services/customerPricing";
import {
  acreditarPuntosPorCompra,
  recalcularSaldoPuntosUsuario,
  registrarMovimientoPuntos,
} from "../services/points";
import { approvePaidOrder, cancelOrderUrgently } from "../services/orderLifecycle";
import { sendOrderReceiptEmail } from "../services/email";
import { registerLocalSale, updateLocalSale } from "../services/localSales";
import { notifyOrderCancellation } from "../services/supportNotifications";
import {
  createShippingZone,
  listShippingZones,
  setShippingZoneActive,
  ShippingZoneError,
  updateShippingZone,
} from "../services/shippingZones";

const router = Router();
router.use(requireAuth, requireRole("vendedor", "admin", "superAdmin"));

function queueOrderReceiptEmail(orderId: number) {
  void sendOrderReceiptEmail(orderId).catch((err) => {
    console.error(`[MAIL] Error enviando comprobante orden #${orderId}:`, err instanceof Error ? err.message : err);
  });
}

const dniManualSchema = z
  .string()
  .trim()
  .regex(/^\d{6,10}$/, "El DNI manual debe tener solo numeros y entre 6 y 10 digitos.");
const dniManualOptionalSchema = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((value) => {
    const normalized = value?.trim() || "";
    return normalized || null;
  })
  .refine((value) => value === null || /^\d{6,10}$/.test(value), {
    message: "El DNI manual debe tener solo numeros y entre 6 y 10 digitos.",
  });

const telefonoManualSchema = z
  .string()
  .trim()
  .max(25)
  .refine((value) => value === "" || /^[0-9+()\-\s]+$/.test(value), {
    message: "El telefono manual solo puede contener numeros, espacios, +, guiones o parentesis.",
  })
  .refine((value) => {
    if (value === "") return true;
    const digits = value.replace(/\D/g, "");
    return digits.length >= 6 && digits.length <= 15;
  }, "El telefono manual debe tener entre 6 y 15 numeros.");

const clienteLocalPayloadSchema = z.object({
  nombre: z.string().min(2).max(120),
  dni: dniManualOptionalSchema,
  telefono: telefonoManualSchema.optional().nullable(),
});
const cajaAperturaSchema = z.object({
  sucursal_id: z.number().int().positive(),
  monto_apertura: z.number().min(0),
  observaciones: z.string().max(2000).optional().nullable(),
});
const cajaCierreSchema = z.object({
  monto_cierre_declarado: z.number().min(0),
  observaciones: z.string().max(2000).optional().nullable(),
});
const gastoSchema = z.object({
  sucursal_id: z.number().int().positive(),
  proveedor_id: z.number().int().positive().optional().nullable(),
  tercero_nombre: z.string().max(160).optional().nullable(),
  categoria: z.string().min(2).max(120),
  descripcion: z.string().min(2).max(255),
  medio_pago: z.enum(["cash", "transferencia", "tarjeta", "qr", "otro"]).default("cash"),
  monto: z.number().positive(),
  fecha_gasto: z.string().datetime().optional().nullable(),
  notas: z.string().max(2000).optional().nullable(),
});

const envioZonaSchema = z.object({
  nombre: z.string().min(1).max(120),
  descripcion: z.string().max(1000).optional().nullable(),
  precio: z.coerce.number(),
  prioridad: z.coerce.number().int().optional().nullable(),
  color: z.string().max(16).optional().nullable(),
  polygon_geojson: z.unknown().refine((value) => value !== undefined && value !== null, {
    message: "El poligono de la zona es obligatorio.",
  }),
  activo: z.boolean().optional().nullable(),
});
const proveedorSchema = z.object({
  nombre: z.string().min(2).max(160),
  contacto: z.string().max(160).optional().nullable(),
  telefono: z.string().max(25).optional().nullable(),
  email: z.string().email().max(160).optional().nullable().or(z.literal("")),
  notas: z.string().max(2000).optional().nullable(),
});
const cancelacionUrgenteOrdenSchema = z.object({
  motivo: z.string().trim().min(8).max(1000),
  mensaje_devolucion: z.string().trim().max(1000).optional().nullable(),
});

async function getCajaSesionPayload(conn: any, sessionId: number) {
  const session = await qOne<{
    id: number;
    sucursal_id: number;
    sucursal_nombre: string;
    usuario_id: number;
    usuario_nombre: string;
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
    `SELECT cs.id, cs.sucursal_id, s.nombre AS sucursal_nombre,
            cs.usuario_id, u.nombre AS usuario_nombre,
            cs.fecha_operativa, cs.estado, cs.monto_apertura, cs.monto_cierre_sistema,
            cs.monto_cierre_declarado, cs.diferencia_cierre, cs.observaciones_apertura,
            cs.observaciones_cierre, cs.apertura_at, cs.cierre_at
     FROM caja_sesiones cs
     JOIN sucursales s ON s.id = cs.sucursal_id
     JOIN usuarios u ON u.id = cs.usuario_id
     WHERE cs.id = ?
     LIMIT 1`,
    [sessionId],
  );
  if (!session) return null;
  const summary = await getCajaSesionSummary(conn, sessionId);
  return {
    ...session,
    fecha_operativa: formatCashDateStamp(session.fecha_operativa),
    monto_apertura: Number(session.monto_apertura ?? 0),
    monto_cierre_sistema: session.monto_cierre_sistema === null ? null : Number(session.monto_cierre_sistema),
    monto_cierre_declarado: session.monto_cierre_declarado === null ? null : Number(session.monto_cierre_declarado),
    diferencia_cierre: session.diferencia_cierre === null ? null : Number(session.diferencia_cierre),
    summary,
  };
}

type CanjeItemDetalle = {
  producto_id: number;
  producto_nombre: string;
  producto_imagen: string | null;
  cantidad: number;
  puntos_unitarios: number;
  puntos_total: number;
};

type OrdenVendedorItem = {
  id: number;
  orden_id: number;
  producto_id: number;
  cantidad: number;
  modo_compra: "dinero" | "puntos";
  precio_dinero_unit: number | null;
  puntaje_al_comprar_unitario: number | null;
  subtotal_dinero: number;
  subtotal_puntos: number;
  nombre: string;
  track_stock: number;
  sabores?: Array<{
    sabor_id: number;
    nombre: string;
    cantidad: number;
  }>;
};

function parseJsonField(value: unknown): unknown {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function recordString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function recordNumber(record: Record<string, unknown>, key: string): number | null {
  const value = Number(record[key]);
  return Number.isFinite(value) ? value : null;
}

function normalizeOrderMapAddress(value: unknown) {
  if (!isJsonRecord(value)) return null;
  const lat = recordNumber(value, "lat");
  const lng = recordNumber(value, "lng");
  if (lat === null || lng === null) return null;

  const direccionFormateada = recordString(value, "direccion_formateada") ?? recordString(value, "direccion");

  return {
    id: recordNumber(value, "id"),
    alias: recordString(value, "alias"),
    nombre: recordString(value, "nombre") ?? recordString(value, "receptor_nombre"),
    telefono: recordString(value, "telefono") ?? recordString(value, "receptor_telefono"),
    direccion: recordString(value, "direccion") ?? direccionFormateada,
    direccion_formateada: direccionFormateada,
    calle: recordString(value, "calle"),
    numero: recordString(value, "numero"),
    piso_departamento: recordString(value, "piso_departamento"),
    barrio: recordString(value, "barrio"),
    localidad: recordString(value, "localidad"),
    provincia: recordString(value, "provincia"),
    codigo_postal: recordString(value, "codigo_postal"),
    pais: recordString(value, "pais"),
    referencias: recordString(value, "referencias") ?? recordString(value, "instrucciones_entrega"),
    lat,
    lng,
  };
}

async function getCanjeItemsByCanjeIds(canjeIds: number[]): Promise<Map<number, CanjeItemDetalle[]>> {
  const map = new Map<number, CanjeItemDetalle[]>();
  if (!canjeIds.length) return map;

  const placeholders = canjeIds.map(() => "?").join(", ");
  const rows = await qAll<{
    canje_id: number;
    producto_id: number;
    producto_nombre: string;
    producto_imagen: string | null;
    cantidad: number;
    puntos_unitarios: number;
    puntos_total: number;
  }>(
    pool,
    `SELECT ci.canje_id, ci.producto_id, p.nombre AS producto_nombre, p.imagen_url AS producto_imagen,
            ci.cantidad, ci.puntos_unitarios, ci.puntos_total
     FROM canje_items ci
     JOIN productos p ON p.id = ci.producto_id
     WHERE ci.canje_id IN (${placeholders})
     ORDER BY ci.canje_id ASC, ci.id ASC`,
    canjeIds,
  );

  for (const row of rows) {
    const current = map.get(Number(row.canje_id)) ?? [];
    current.push({
      producto_id: Number(row.producto_id),
      producto_nombre: row.producto_nombre,
      producto_imagen: row.producto_imagen ?? null,
      cantidad: Number(row.cantidad),
      puntos_unitarios: Number(row.puntos_unitarios),
      puntos_total: Number(row.puntos_total),
    });
    map.set(Number(row.canje_id), current);
  }

  return map;
}

async function getOrdenItemsByOrdenIds(orderIds: number[]): Promise<Map<number, OrdenVendedorItem[]>> {
  const map = new Map<number, OrdenVendedorItem[]>();
  if (!orderIds.length) return map;

  const rows = await qAll<OrdenVendedorItem>(
    pool,
    `SELECT oi.id, oi.orden_id, oi.producto_id, oi.cantidad, oi.modo_compra,
            oi.precio_dinero_unit, oi.puntaje_al_comprar_unitario,
            oi.subtotal_dinero, oi.subtotal_puntos, p.nombre, p.track_stock
     FROM orden_items oi
     JOIN productos p ON p.id = oi.producto_id
     WHERE oi.orden_id IN (${orderIds.map(() => "?").join(", ")})
     ORDER BY oi.orden_id ASC, oi.id ASC`,
    orderIds,
  );

  const flavorMap = new Map<number, NonNullable<OrdenVendedorItem["sabores"]>>();
  if (rows.length) {
    const itemIds = rows.map((row) => Number(row.id));
    const itemPlaceholders = itemIds.map(() => "?").join(", ");
    const flavorRows = await qAll<{
      orden_item_id: number;
      sabor_id: number;
      sabor_nombre: string;
      cantidad: number;
    }>(
      pool,
      `SELECT orden_item_id, sabor_id, sabor_nombre, cantidad
       FROM orden_item_sabores
       WHERE orden_item_id IN (${itemPlaceholders})
       ORDER BY orden_item_id ASC, id ASC`,
      itemIds,
    );
    for (const flavor of flavorRows) {
      const current = flavorMap.get(Number(flavor.orden_item_id)) ?? [];
      current.push({
        sabor_id: Number(flavor.sabor_id),
        nombre: flavor.sabor_nombre,
        cantidad: Number(flavor.cantidad),
      });
      flavorMap.set(Number(flavor.orden_item_id), current);
    }
  }

  for (const row of rows) {
    const orderId = Number(row.orden_id);
    const current = map.get(orderId) ?? [];
    current.push({
      ...row,
      orden_id: orderId,
      producto_id: Number(row.producto_id),
      cantidad: Number(row.cantidad),
      precio_dinero_unit: row.precio_dinero_unit === null ? null : Number(row.precio_dinero_unit),
      puntaje_al_comprar_unitario: row.puntaje_al_comprar_unitario === null ? null : Number(row.puntaje_al_comprar_unitario),
      subtotal_dinero: Number(row.subtotal_dinero ?? 0),
      subtotal_puntos: Number(row.subtotal_puntos ?? 0),
      track_stock: Number(row.track_stock ?? 0),
      sabores: flavorMap.get(Number(row.id)) ?? [],
    });
    map.set(orderId, current);
  }

  return map;
}

// Buscar cliente por DNI (legacy / individual)
router.get("/cliente/:dni", async (req, res, next) => {
  try {
    const cliente = await qOne(pool,
      "SELECT id, nombre, dni, email, puntos_saldo AS puntos FROM usuarios WHERE dni = ? AND rol = 'cliente'",
      [req.params.dni]
    );
    if (!cliente) { res.status(404).json({ error: "Cliente no encontrado" }); return; }
    res.json(cliente);
  } catch (err) {
    next(err);
  }
});

// Buscar clientes por nombre o DNI (real-time search)
router.get("/clientes/buscar", async (req, res, next) => {
  try {
    const q = req.query.q;
    if (!q || typeof q !== "string") { return res.json([]); }
    
    const cleanQ = q.trim();
    if (cleanQ.length < 2) { return res.json([]); }

    const term = `%${cleanQ}%`;
    const rows = await qAll(pool,
      `SELECT id, nombre, dni, email, puntos_saldo AS puntos, tipo_cliente, descuento_porcentaje
       FROM usuarios 
       WHERE rol = 'cliente' 
         AND (nombre LIKE ? OR dni LIKE ?)
       LIMIT 10`,
      [term, term]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Cargar puntos usando productos del catálogo como referencia
router.get("/productos-locales", async (_req, res, next) => {
  try {
    const clienteUsuarioId = Number(_req.query.usuario_id ?? 0);
    const pricingProfile = Number.isInteger(clienteUsuarioId) && clienteUsuarioId > 0
      ? await getActiveClientePricingProfile(pool, clienteUsuarioId)
      : null;
    const resolvePrice = await createPricingResolver(pool, { source: "local", profile: pricingProfile });
    const productos = await qAll<{
      id: number;
      nombre: string;
      descripcion: string | null;
      imagen_url: string | null;
      categoria: string | null;
      tipo_producto: "venta" | "mixto";
      configuracion_tipo: "simple" | "caja_sabores";
      capacidad_sabores: number | null;
      precio_dinero: number | null;
      puntaje_al_comprar: number | null;
      activo: number;
    }>(
      pool,
      `SELECT id, nombre, descripcion, imagen_url, categoria, tipo_producto,
              configuracion_tipo, capacidad_sabores, precio_dinero,
              puntaje_al_comprar, activo
       FROM productos
       WHERE activo = 1
         AND tipo_producto IN ('venta', 'mixto')
         AND COALESCE(precio_dinero, 0) > 0
       ORDER BY nombre ASC, id ASC`,
    );

    if (!productos.length) {
      res.json([]);
      return;
    }

    const ids = productos.map((producto) => Number(producto.id));
    const placeholders = ids.map(() => "?").join(", ");
    const sabores = await qAll<{
      producto_id: number;
      id: number;
      nombre: string;
    }>(
      pool,
      `SELECT ps.producto_id, s.id, s.nombre
       FROM producto_sabores ps
       JOIN sabores s ON s.id = ps.sabor_id
       WHERE ps.producto_id IN (${placeholders}) AND ps.activo = 1 AND s.activo = 1
       ORDER BY ps.producto_id ASC, ps.orden ASC, s.nombre ASC`,
      ids,
    );
    const flavorMap = new Map<number, Array<{ id: number; nombre: string }>>();
    for (const sabor of sabores) {
      const current = flavorMap.get(Number(sabor.producto_id)) ?? [];
      current.push({ id: Number(sabor.id), nombre: sabor.nombre });
      flavorMap.set(Number(sabor.producto_id), current);
    }

    res.json(productos.map((producto) => {
      const productFlavors = flavorMap.get(Number(producto.id)) ?? [];
      const pricing = resolvePrice({ precio_dinero: producto.precio_dinero, categoria: producto.categoria });
      return {
        ...producto,
        activo: Boolean(producto.activo),
        precio_dinero: pricing.precioFinal,
        precio_dinero_original: pricing.precioLista,
        precio_dinero_lista: pricing.precioLista,
        descuento_porcentaje_aplicado: pricing.descuentoPorcentajeAplicado,
        tipo_cliente_precio: pricing.tipoCliente,
        puntaje_al_comprar: producto.puntaje_al_comprar === null ? null : Number(producto.puntaje_al_comprar),
        capacidad_sabores: producto.capacidad_sabores === null ? null : Number(producto.capacidad_sabores),
        sabores: productFlavors,
        sabor_ids: productFlavors.map((sabor) => sabor.id),
      };
    }));
  } catch (err) {
    next(err);
  }
});

const cargarSchema = z.object({
  dni: z.string().min(6),
  items: z.array(z.object({
    producto_id: z.number().int().positive(),
    cantidad:    z.number().int().positive(),
  })).min(1),
  descripcion: z.string().optional(),
});

router.post("/cargar", async (req, res, next) => {
  const parsed = cargarSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }
  const { dni, items, descripcion } = parsed.data;

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const cliente = await qOne(conn,
      "SELECT id, puntos_saldo FROM usuarios WHERE dni = ? AND rol = 'cliente'",
      [dni]
    );
    if (!cliente) { res.status(404).json({ error: "Cliente no encontrado" }); await conn.rollback(); return; }

    let totalPuntos = 0;
    for (const item of items) {
      const prod = await qOne(conn,
        "SELECT id, puntos_acumulables FROM productos WHERE id = ? AND activo = 1",
        [item.producto_id]
      );
      if (!prod) {
        res.status(400).json({ error: `Producto ${item.producto_id} no existe o está inactivo` });
        await conn.rollback();
        return;
      }
      totalPuntos += (prod.puntos_acumulables ?? 0) * item.cantidad;
    }

    if (totalPuntos === 0) {
      res.status(400).json({ error: "Los productos seleccionados no tienen puntos acumulables" });
      await conn.rollback();
      return;
    }

    await registrarMovimientoPuntos(conn, {
      usuarioId: Number(cliente.id),
      tipo: 'asignacion_manual',
      puntos: totalPuntos,
      descripcion: descripcion || `Carga de puntos — ${items.length} producto(s)`,
      creadoPor: req.user!.id
    });

    await conn.commit();
    emitRealtime(["puntos"]);

    res.status(201).json({
      ok: true,
      cliente_id: cliente.id,
      puntos_acreditados: totalPuntos,
      nuevo_saldo: cliente.puntos_saldo + totalPuntos,
    });
  } catch (err) {
    if (conn) await conn.rollback();
    next(err);
  } finally {
    if (conn) conn.release();
  }
});

// Buscar canje por código de retiro
router.get("/canje/:codigo", async (req, res, next) => {
  try {
    const codigo = req.params.codigo.trim().toUpperCase();
    const canje = await qOne(pool,
      `SELECT c.id, c.codigo_retiro, c.puntos_usados, c.estado, c.fecha_limite_retiro, c.notas,
              u.nombre AS cliente_nombre, u.dni AS cliente_dni,
              p.nombre AS producto_nombre,
              s.id AS sucursal_id, s.nombre AS sucursal_nombre, s.direccion AS sucursal_direccion,
              s.piso AS sucursal_piso, s.localidad AS sucursal_localidad, s.provincia AS sucursal_provincia
       FROM canjes c
       JOIN usuarios u ON u.id = c.usuario_id
       JOIN productos p ON p.id = c.producto_id
       LEFT JOIN sucursales s ON s.id = c.sucursal_id
       WHERE c.codigo_retiro = ?`,
      [codigo]
    );
    if (!canje) { res.status(404).json({ error: "Código de retiro no encontrado" }); return; }
    const itemsMap = await getCanjeItemsByCanjeIds([Number(canje.id)]);
    const fallbackItem: CanjeItemDetalle = {
      producto_id: 0,
      producto_nombre: String(canje.producto_nombre),
      producto_imagen: null,
      cantidad: 1,
      puntos_unitarios: Number(canje.puntos_usados),
      puntos_total: Number(canje.puntos_usados),
    };
    const items = itemsMap.get(Number(canje.id)) ?? [fallbackItem];
    const totalUnidades = items.reduce((acc, item) => acc + Number(item.cantidad), 0);

    res.json({
      ...canje,
      items,
      total_items: items.length,
      total_unidades: totalUnidades,
      productos_detalle: items.map((item) => `${item.producto_nombre} x${item.cantidad}`).join(" | "),
    });
  } catch (err) {
    next(err);
  }
});

// Actualizar estado de un canje (entregado / no_disponible / cancelado)
router.patch("/canje/:codigo", async (req, res, next) => {
  const codigo = req.params.codigo.trim().toUpperCase();
  const schema = z.object({
    estado: z.enum(["entregado", "no_disponible", "cancelado"]),
    notas: z.string().max(500).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }
  const { estado, notas } = parsed.data;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const canje = await qOne(conn,
      "SELECT id, usuario_id, puntos_usados, estado FROM canjes WHERE codigo_retiro = ? FOR UPDATE",
      [codigo]
    );
    if (!canje) { await conn.rollback(); res.status(404).json({ error: "Código de retiro no encontrado" }); return; }
    if (canje.estado === "entregado" || canje.estado === "cancelado") {
      await conn.rollback();
      res.status(400).json({ error: `El canje ya está en estado '${canje.estado}'` });
      return;
    }

    await qRun(conn, "UPDATE canjes SET estado = ?, notas = ? WHERE id = ?", [estado, notas ?? null, canje.id]);

    if (estado === "no_disponible" || estado === "cancelado") {
      const motivo = estado === "cancelado" ? "cancelado" : "no disponible";
      await qRun(conn,
        `INSERT INTO movimientos_puntos
           (usuario_id, tipo, puntos, descripcion, referencia_id, referencia_tipo, creado_por)
         VALUES (?, 'devolucion_canje', ?, ?, ?, 'canjes', ?)`,
        [canje.usuario_id, canje.puntos_usados, `Devolución por canje ${motivo}`, canje.id, req.user!.id]
      );
      await recalcularSaldoPuntosUsuario(conn, Number(canje.usuario_id));
    }

    await conn.commit();
    emitRealtime(["canjes", "inventario", "stats", "puntos"]);
    res.json({ ok: true, estado });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

const ventaLocalItemSchema = z.object({
  producto_id: z.number().int().positive(),
  cantidad: z.number().int().positive().max(200),
  sabores: z.array(z.object({
    sabor_id: z.number().int().positive(),
    cantidad: z.number().int().positive().max(200),
  })).optional(),
});

const ventaLocalSchema = z.object({
  usuario_id: z.number().int().positive().optional().nullable(),
  cliente_local: clienteLocalPayloadSchema.optional().nullable(),
  sucursal_id: z.number().int().positive(),
  metodo_pago: z.enum(["cash", "transferencia", "tarjeta", "qr", "otro"]).default("cash"),
  acreditar_puntos: z.boolean().optional().default(false),
  notas: z.string().max(1000).optional().nullable(),
  items: z.array(ventaLocalItemSchema).min(1).max(80),
});

router.post("/ventas-locales", async (req, res, next) => {
  const parsed = ventaLocalSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await registerLocalSale(conn, {
      canal: "vendedor",
      usuarioId: parsed.data.usuario_id ?? null,
      clienteLocal: parsed.data.cliente_local ?? null,
      sucursalId: parsed.data.sucursal_id,
      metodoPago: parsed.data.metodo_pago,
      acreditarPuntos: parsed.data.acreditar_puntos,
      notas: parsed.data.notas,
      items: parsed.data.items,
      creadoPor: req.user!.id,
    });
    await conn.commit();
    emitRealtime(["ordenes", "stats", "puntos"]);
    res.status(201).json({ ok: true, ...result });
  } catch (err: any) {
    await conn.rollback();
    res.status(400).json({ error: err?.message || "No se pudo registrar la venta local." });
  } finally {
    conn.release();
  }
});

router.put("/ventas-locales/:id", async (req, res, next) => {
  const orderId = Number(req.params.id);
  const parsed = ventaLocalSchema.safeParse(req.body);
  if (!Number.isFinite(orderId) || orderId <= 0) {
    res.status(400).json({ error: "Venta local invalida." });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await updateLocalSale(conn, {
      orderId,
      canal: "vendedor",
      usuarioId: parsed.data.usuario_id ?? null,
      clienteLocal: parsed.data.cliente_local ?? null,
      sucursalId: parsed.data.sucursal_id,
      metodoPago: parsed.data.metodo_pago,
      acreditarPuntos: parsed.data.acreditar_puntos,
      notas: parsed.data.notas,
      items: parsed.data.items,
      creadoPor: req.user!.id,
    });
    await conn.commit();
    emitRealtime(["ordenes", "stats", "puntos", "inventario"]);
    res.json({ ok: true, ...result });
  } catch (err: any) {
    await conn.rollback();
    res.status(400).json({ error: err?.message || "No se pudo actualizar la venta local." });
  } finally {
    conn.release();
  }
});

router.get("/proveedores", async (_req, res, next) => {
  try {
    const rows = await qAll(
      pool,
      `SELECT id, nombre, contacto, telefono, email, notas
       FROM proveedores
       WHERE activo = 1
       ORDER BY nombre ASC, id ASC`,
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post("/proveedores", async (req, res, next) => {
  const parsed = proveedorSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  try {
    const result = await qRun(
      pool,
      `INSERT INTO proveedores (nombre, contacto, telefono, email, notas, activo)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [
        parsed.data.nombre.trim(),
        parsed.data.contacto?.trim() || null,
        parsed.data.telefono?.trim() || null,
        parsed.data.email?.trim() || null,
        parsed.data.notas?.trim() || null,
      ],
    );
    emitRealtime(["admin-config"]);
    res.status(201).json({ ok: true, id: result.insertId });
  } catch (err: any) {
    if (err?.code === "ER_DUP_ENTRY") {
      res.status(409).json({ error: "Ya existe un proveedor con ese nombre." });
      return;
    }
    next(err);
  }
});

router.put("/proveedores/:id", async (req, res, next) => {
  const proveedorId = Number(req.params.id);
  const parsed = proveedorSchema.safeParse(req.body);
  if (!Number.isFinite(proveedorId) || proveedorId <= 0) {
    res.status(400).json({ error: "Proveedor invalido." });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  try {
    const result = await qRun(
      pool,
      `UPDATE proveedores
       SET nombre = ?, contacto = ?, telefono = ?, email = ?, notas = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND activo = 1`,
      [
        parsed.data.nombre.trim(),
        parsed.data.contacto?.trim() || null,
        parsed.data.telefono?.trim() || null,
        parsed.data.email?.trim() || null,
        parsed.data.notas?.trim() || null,
        proveedorId,
      ],
    );
    if (!result.affectedRows) {
      res.status(404).json({ error: "Proveedor no encontrado o inactivo." });
      return;
    }
    emitRealtime(["admin-config"]);
    res.json({ ok: true });
  } catch (err: any) {
    if (err?.code === "ER_DUP_ENTRY") {
      res.status(409).json({ error: "Ya existe otro proveedor con ese nombre." });
      return;
    }
    next(err);
  }
});

router.get("/envio-zonas", async (_req, res, next) => {
  try {
    res.json(await listShippingZones(true));
  } catch (err) {
    next(err);
  }
});

router.post("/envio-zonas", async (req, res, next) => {
  const parsed = envioZonaSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  try {
    const zone = await createShippingZone(req.user!.id, parsed.data);
    emitRealtime(["envio-zonas", "admin-config"]);
    res.status(201).json(zone);
  } catch (err) {
    if (err instanceof ShippingZoneError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
});

router.put("/envio-zonas/:id", async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "ID de zona invalido" });
    return;
  }
  const parsed = envioZonaSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  try {
    const zone = await updateShippingZone(req.user!.id, id, parsed.data);
    emitRealtime(["envio-zonas", "admin-config"]);
    res.json(zone);
  } catch (err) {
    if (err instanceof ShippingZoneError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
});

router.patch("/envio-zonas/:id/activo", async (req, res, next) => {
  const id = Number(req.params.id);
  const { activo } = req.body ?? {};
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "ID de zona invalido" });
    return;
  }
  if (typeof activo !== "boolean") {
    res.status(400).json({ error: "activo debe ser boolean" });
    return;
  }

  try {
    const zone = await setShippingZoneActive(req.user!.id, id, activo);
    emitRealtime(["envio-zonas", "admin-config"]);
    res.json(zone);
  } catch (err) {
    if (err instanceof ShippingZoneError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
});

router.get("/caja/actual", async (req, res, next) => {
  try {
    const sucursalId = Number(req.query.sucursal_id ?? 0);
    if (!Number.isInteger(sucursalId) || sucursalId <= 0) {
      res.status(400).json({ error: "Sucursal invalida." });
      return;
    }
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const session = await ensureDailyCajaSesion(conn, { usuarioId: req.user!.id, sucursalId });
      await conn.commit();
      res.json(await getCajaSesionPayload(pool, Number(session.id)));
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    next(err);
  }
});

router.post("/caja/apertura", async (req, res, next) => {
  const parsed = cajaAperturaSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const sessionId = await openCajaSesion(conn, {
      usuarioId: req.user!.id,
      sucursalId: parsed.data.sucursal_id,
      montoApertura: Number(parsed.data.monto_apertura),
      observaciones: parsed.data.observaciones,
    });
    await conn.commit();
    emitRealtime(["ordenes"]);
    res.status(201).json(await getCajaSesionPayload(pool, sessionId));
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

router.post("/caja/:id/cierre", async (req, res, next) => {
  const sessionId = Number(req.params.id);
  const parsed = cajaCierreSchema.safeParse(req.body);
  if (!Number.isFinite(sessionId) || sessionId <= 0) {
    res.status(400).json({ error: "Caja invalida." });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await closeCajaSesion(conn, {
      cajaSesionId: sessionId,
      usuarioId: req.user!.id,
      montoCierreDeclarado: Number(parsed.data.monto_cierre_declarado),
      observaciones: parsed.data.observaciones,
      forceAdmin: req.user!.rol === "admin" || req.user!.rol === "superAdmin",
    });
    await conn.commit();
    emitRealtime(["ordenes"]);
    res.json(await getCajaSesionPayload(pool, sessionId));
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

router.get("/caja/sesiones", async (req, res, next) => {
  try {
    const sucursalId = Number(req.query.sucursal_id ?? 0);
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (Number.isInteger(sucursalId) && sucursalId > 0) {
      where.push("sucursal_id = ?");
      params.push(sucursalId);
    }

    await closeStaleCajaSesiones(pool, Number.isInteger(sucursalId) && sucursalId > 0 ? { sucursalId } : {});
    const rows = await qAll<{ id: number }>(
      pool,
      `SELECT id
       FROM caja_sesiones
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY apertura_at DESC, id DESC
       LIMIT 40`,
      params,
    );
    const payload = [];
    for (const row of rows) {
      const session = await getCajaSesionPayload(pool, Number(row.id));
      if (session) payload.push(session);
    }
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

router.get("/gastos", async (req, res, next) => {
  try {
    const sucursalId = Number(req.query.sucursal_id ?? 0);
    const where = ["g.creado_por = ?"];
    const params: Array<string | number> = [req.user!.id];
    if (Number.isInteger(sucursalId) && sucursalId > 0) {
      where.push("g.sucursal_id = ?");
      params.push(sucursalId);
    }

    const rows = await qAll(
      pool,
      `SELECT g.id, g.sucursal_id, s.nombre AS sucursal_nombre, g.caja_sesion_id,
              g.proveedor_id, p.nombre AS proveedor_nombre, g.tercero_nombre,
              g.categoria, g.descripcion, g.medio_pago, g.monto, g.fecha_gasto, g.notas,
              g.creado_por, u.nombre AS creado_por_nombre, g.created_at
       FROM gastos g
       JOIN sucursales s ON s.id = g.sucursal_id
       LEFT JOIN proveedores p ON p.id = g.proveedor_id
       JOIN usuarios u ON u.id = g.creado_por
       WHERE ${where.join(" AND ")}
       ORDER BY g.fecha_gasto DESC, g.id DESC
       LIMIT 120`,
      params,
    );
    res.json(rows.map((row: any) => ({ ...row, monto: Number(row.monto ?? 0) })));
  } catch (err) {
    next(err);
  }
});

router.post("/gastos", async (req, res, next) => {
  const parsed = gastoSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const session = await ensureDailyCajaSesion(conn, {
      usuarioId: req.user!.id,
      sucursalId: parsed.data.sucursal_id,
    });
    if (!parsed.data.proveedor_id && !parsed.data.tercero_nombre?.trim()) {
      throw new Error("Selecciona un proveedor o completa un tercero.");
    }
    if (parsed.data.proveedor_id) {
      const provider = await qOne<{ id: number }>(
        conn,
        "SELECT id FROM proveedores WHERE id = ? AND activo = 1 LIMIT 1",
        [parsed.data.proveedor_id],
      );
      if (!provider) throw new Error("El proveedor seleccionado no existe o esta inactivo.");
    }

    const result = await qRun(
      conn,
      `INSERT INTO gastos
        (sucursal_id, caja_sesion_id, proveedor_id, tercero_nombre, categoria, descripcion, medio_pago, monto, fecha_gasto, notas, creado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?)`,
      [
        parsed.data.sucursal_id,
        Number(session.id),
        parsed.data.proveedor_id ?? null,
        parsed.data.tercero_nombre?.trim() || null,
        parsed.data.categoria.trim(),
        parsed.data.descripcion.trim(),
        normalizeCashPaymentMethod(parsed.data.medio_pago),
        Number(parsed.data.monto),
        parsed.data.fecha_gasto ?? null,
        parsed.data.notas?.trim() || null,
        req.user!.id,
      ],
    );

    await registerCajaMovimiento(conn, {
      cajaSesionId: Number(session.id),
      tipo: "gasto",
      medioPago: normalizeCashPaymentMethod(parsed.data.medio_pago),
      monto: Number(parsed.data.monto),
      descripcion: parsed.data.descripcion.trim(),
      referenciaTipo: "gastos",
      referenciaId: result.insertId,
      creadoPor: req.user!.id,
    });

    await conn.commit();
    emitRealtime(["ordenes"]);
    res.status(201).json({ ok: true, id: result.insertId });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

router.put("/gastos/:id", async (req, res, next) => {
  const gastoId = Number(req.params.id);
  const parsed = gastoSchema.safeParse(req.body);
  if (!Number.isInteger(gastoId) || gastoId <= 0) {
    res.status(400).json({ error: "Gasto invalido." });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const gasto = await qOne<{ id: number; sucursal_id: number; caja_sesion_id: number; creado_por: number }>(
      conn,
      "SELECT id, sucursal_id, caja_sesion_id, creado_por FROM gastos WHERE id = ? LIMIT 1 FOR UPDATE",
      [gastoId],
    );
    if (!gasto) {
      res.status(404).json({ error: "Gasto no encontrado." });
      await conn.rollback();
      return;
    }
    if (req.user!.rol === "vendedor" && Number(gasto.creado_por) !== Number(req.user!.id)) {
      throw new Error("No puedes editar un gasto cargado por otro usuario.");
    }
    if (Number(gasto.sucursal_id) !== Number(parsed.data.sucursal_id)) {
      throw new Error("No se puede cambiar la sucursal de un gasto ya registrado.");
    }
    if (!parsed.data.proveedor_id && !parsed.data.tercero_nombre?.trim()) {
      throw new Error("Selecciona un proveedor o completa un tercero.");
    }
    if (parsed.data.proveedor_id) {
      const provider = await qOne<{ id: number }>(
        conn,
        "SELECT id FROM proveedores WHERE id = ? AND activo = 1 LIMIT 1",
        [parsed.data.proveedor_id],
      );
      if (!provider) throw new Error("El proveedor seleccionado no existe o esta inactivo.");
    }

    const medioPago = normalizeCashPaymentMethod(parsed.data.medio_pago);
    const descripcion = parsed.data.descripcion.trim();
    await qRun(
      conn,
      `UPDATE gastos
       SET proveedor_id = ?, tercero_nombre = ?, categoria = ?, descripcion = ?,
           medio_pago = ?, monto = ?, notas = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        parsed.data.proveedor_id ?? null,
        parsed.data.tercero_nombre?.trim() || null,
        parsed.data.categoria.trim(),
        descripcion,
        medioPago,
        Number(parsed.data.monto),
        parsed.data.notas?.trim() || null,
        gastoId,
      ],
    );

    const movementUpdate = await qRun(
      conn,
      `UPDATE caja_movimientos
       SET medio_pago = ?, monto = ?, descripcion = ?
       WHERE referencia_tipo = 'gastos' AND referencia_id = ?`,
      [medioPago, Number(parsed.data.monto), descripcion, gastoId],
    );
    if (!movementUpdate.affectedRows) {
      await registerCajaMovimiento(conn, {
        cajaSesionId: Number(gasto.caja_sesion_id),
        tipo: "gasto",
        medioPago,
        monto: Number(parsed.data.monto),
        descripcion,
        referenciaTipo: "gastos",
        referenciaId: gastoId,
        creadoPor: req.user!.id,
      });
    }
    await syncCajaSesionClosureState(conn, { cajaSesionId: Number(gasto.caja_sesion_id) });

    await conn.commit();
    emitRealtime(["ordenes"]);
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

router.get("/ordenes", async (_req, res, next) => {
  try {
    const rows = await qAll<{
      id: number;
      usuario_id: number | null;
      cliente_local_id: number | null;
      cliente_nombre: string;
      cliente_email: string;
      cliente_dni: string | null;
      cliente_telefono: string | null;
      canal: string;
      estado: string;
      tipo_orden: string;
      total_dinero: number;
      total_puntos: number;
      moneda: string;
      direccion_envio_json: string | null;
      sucursal_retiro_id: number | null;
      sucursal_nombre: string | null;
      sucursal_direccion: string | null;
      sucursal_piso: string | null;
      sucursal_localidad: string | null;
      sucursal_provincia: string | null;
      puntos_acreditados: number;
      notas: string | null;
      created_at: string;
      updated_at: string;
    }>(
      pool,
      `SELECT o.id, o.usuario_id, o.cliente_local_id,
              COALESCE(u.nombre, cl.nombre, 'Cliente local') AS cliente_nombre,
              COALESCE(u.email, '') AS cliente_email,
              COALESCE(u.dni, cl.dni) AS cliente_dni,
              COALESCE(u.telefono, cl.telefono) AS cliente_telefono,
              o.canal, o.estado, o.tipo_orden, o.total_dinero, o.total_puntos, o.moneda,
              o.direccion_envio_json, o.sucursal_retiro_id,
              s.nombre AS sucursal_nombre, s.direccion AS sucursal_direccion,
              s.piso AS sucursal_piso, s.localidad AS sucursal_localidad, s.provincia AS sucursal_provincia,
              EXISTS(
                SELECT 1
                FROM movimientos_puntos mp
                WHERE mp.referencia_tipo = 'ordenes'
                  AND mp.referencia_id = o.id
                  AND mp.tipo = 'acreditacion_compra'
              ) AS puntos_acreditados,
              o.notas, o.created_at, o.updated_at
       FROM ordenes o
       LEFT JOIN usuarios u ON u.id = o.usuario_id
       LEFT JOIN clientes_locales cl ON cl.id = o.cliente_local_id
       LEFT JOIN sucursales s ON s.id = o.sucursal_retiro_id
       WHERE o.tipo_orden IN ('venta', 'mixta')
       ORDER BY o.created_at DESC, o.id DESC
       LIMIT 300`,
    );

    const orderIds = rows.map((row) => Number(row.id));
    const itemMap = await getOrdenItemsByOrdenIds(orderIds);
    const payments = orderIds.length
      ? await qAll<{ orden_id: number; estado: string; proveedor: string; metodo: string | null; monto: number; moneda: string }>(
          pool,
          `SELECT p.orden_id, p.estado, p.proveedor, p.metodo, p.monto, p.moneda
           FROM pagos p
           JOIN (
              SELECT orden_id, MAX(id) AS last_id
              FROM pagos
              WHERE orden_id IN (${orderIds.map(() => "?").join(", ")})
              GROUP BY orden_id
            ) latest ON latest.last_id = p.id`,
          orderIds,
        )
      : [];
    const payMap = new Map<number, { estado: string; proveedor: string; metodo: string | null; monto: number; moneda: string }>();
    for (const payment of payments) {
      payMap.set(Number(payment.orden_id), {
        estado: payment.estado,
        proveedor: payment.proveedor,
        metodo: payment.metodo ?? null,
        monto: Number(payment.monto ?? 0),
        moneda: payment.moneda,
      });
    }

    res.json(
      rows.map((row) => {
        const items = itemMap.get(Number(row.id)) ?? [];
        return {
          ...row,
          usuario_id: row.usuario_id === null ? null : Number(row.usuario_id),
          cliente_local_id: row.cliente_local_id === null ? null : Number(row.cliente_local_id),
          total_dinero: Number(row.total_dinero ?? 0),
          total_puntos: Number(row.total_puntos ?? 0),
          total_items: items.length,
          total_unidades: items.reduce((acc, item) => acc + Number(item.cantidad), 0),
          items,
          puntos_acreditados: Boolean(row.puntos_acreditados),
          direccion_envio: parseJsonField(row.direccion_envio_json),
          sucursal: row.sucursal_retiro_id
            ? {
                id: Number(row.sucursal_retiro_id),
                nombre: row.sucursal_nombre,
                direccion: row.sucursal_direccion,
                piso: row.sucursal_piso,
                localidad: row.sucursal_localidad,
                provincia: row.sucursal_provincia,
              }
            : null,
          pago: payMap.get(Number(row.id)) ?? null,
        };
      }),
    );
  } catch (err) {
    next(err);
  }
});

router.get("/ordenes/mapa", async (req, res, next) => {
  try {
    const selectedOrderId = Number(req.query.pedido_id ?? 0);
    const includeSelectedOrder = Number.isInteger(selectedOrderId) && selectedOrderId > 0;
    const rows = await qAll<{
      id: number;
      usuario_id: number | null;
      cliente_nombre: string;
      cliente_email: string;
      canal: string;
      estado: string;
      tipo_orden: string;
      total_dinero: number;
      total_puntos: number;
      moneda: string;
      direccion_envio_json: string | null;
      notas: string | null;
      created_at: string;
      updated_at: string;
    }>(
      pool,
      `SELECT o.id, o.usuario_id,
              COALESCE(u.nombre, cl.nombre, 'Cliente local') AS cliente_nombre,
              COALESCE(u.email, '') AS cliente_email,
              o.canal, o.estado, o.tipo_orden, o.total_dinero, o.total_puntos, o.moneda,
              o.direccion_envio_json, o.notas, o.created_at, o.updated_at
       FROM ordenes o
       LEFT JOIN usuarios u ON u.id = o.usuario_id
       LEFT JOIN clientes_locales cl ON cl.id = o.cliente_local_id
       WHERE o.tipo_orden IN ('venta', 'mixta')
         AND o.direccion_envio_json IS NOT NULL
         AND o.estado NOT IN ('cancelada', 'expirada')
         AND (o.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)${includeSelectedOrder ? " OR o.id = ?" : ""})
       ORDER BY o.created_at DESC, o.id DESC
       LIMIT 300`,
      includeSelectedOrder ? [selectedOrderId] : [],
    );

    res.json(
      rows
        .map((row) => {
          const direccionEnvio = normalizeOrderMapAddress(parseJsonField(row.direccion_envio_json));
          if (!direccionEnvio) return null;
          return {
            ...row,
            total_dinero: Number(row.total_dinero ?? 0),
            total_puntos: Number(row.total_puntos ?? 0),
            direccion_envio: direccionEnvio,
          };
        })
        .filter((row): row is NonNullable<typeof row> => Boolean(row)),
    );
  } catch (err) {
    next(err);
  }
});

router.get("/ordenes/:id", async (req, res, next) => {
  const orderId = Number(req.params.id);
  if (!Number.isFinite(orderId) || orderId <= 0) {
    res.status(400).json({ error: "ID de orden invalido" });
    return;
  }

  try {
    const orden = await qOne<{
      id: number;
      usuario_id: number;
      cliente_nombre: string;
      cliente_email: string;
      cliente_dni: string | null;
      cliente_telefono: string | null;
      canal: string;
      estado: string;
      tipo_orden: string;
      total_dinero: number;
      total_puntos: number;
      moneda: string;
      direccion_envio_json: string | null;
      sucursal_retiro_id: number | null;
      sucursal_nombre: string | null;
      sucursal_direccion: string | null;
      sucursal_piso: string | null;
      sucursal_localidad: string | null;
      sucursal_provincia: string | null;
      notas: string | null;
      created_at: string;
      updated_at: string;
    }>(
      pool,
      `SELECT o.id, o.usuario_id,
              COALESCE(u.nombre, cl.nombre, 'Cliente local') AS cliente_nombre,
              COALESCE(u.email, '') AS cliente_email,
              COALESCE(u.dni, cl.dni) AS cliente_dni,
              COALESCE(u.telefono, cl.telefono) AS cliente_telefono,
              o.canal, o.estado, o.tipo_orden, o.total_dinero, o.total_puntos, o.moneda,
              o.direccion_envio_json, o.sucursal_retiro_id,
              s.nombre AS sucursal_nombre, s.direccion AS sucursal_direccion,
              s.piso AS sucursal_piso, s.localidad AS sucursal_localidad, s.provincia AS sucursal_provincia,
              o.notas, o.created_at, o.updated_at
       FROM ordenes o
       LEFT JOIN usuarios u ON u.id = o.usuario_id
       LEFT JOIN clientes_locales cl ON cl.id = o.cliente_local_id
       LEFT JOIN sucursales s ON s.id = o.sucursal_retiro_id
       WHERE o.id = ? AND o.tipo_orden IN ('venta', 'mixta')
       LIMIT 1`,
      [orderId],
    );

    if (!orden) {
      res.status(404).json({ error: "Orden no encontrada" });
      return;
    }

    const itemMap = await getOrdenItemsByOrdenIds([orderId]);
    const pago = await qOne<{
      id: number;
      proveedor: string;
      metodo: string | null;
      estado: string;
      monto: number;
      moneda: string;
      provider_payment_id: string | null;
      checkout_url: string | null;
      created_at: string;
      updated_at: string;
    }>(
      pool,
      `SELECT id, proveedor, metodo, estado, monto, moneda, provider_payment_id, checkout_url, created_at, updated_at
       FROM pagos
       WHERE orden_id = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`,
      [orderId],
    );

    res.json({
      ...orden,
      total_dinero: Number(orden.total_dinero ?? 0),
      total_puntos: Number(orden.total_puntos ?? 0),
      direccion_envio: parseJsonField(orden.direccion_envio_json),
      sucursal: orden.sucursal_retiro_id
        ? {
            id: Number(orden.sucursal_retiro_id),
            nombre: orden.sucursal_nombre,
            direccion: orden.sucursal_direccion,
            piso: orden.sucursal_piso,
            localidad: orden.sucursal_localidad,
            provincia: orden.sucursal_provincia,
          }
        : null,
      items: itemMap.get(orderId) ?? [],
      pago: pago
        ? {
            ...pago,
            monto: Number(pago.monto ?? 0),
          }
        : null,
      usuario: {
        nombre: orden.cliente_nombre,
        email: orden.cliente_email,
        dni: orden.cliente_dni,
        telefono: orden.cliente_telefono,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post(["/ordenes/:id/cancelar", "/ordenes/:id/cancelar-urgente"], async (req, res, next) => {
  const orderId = Number(req.params.id);
  if (!Number.isFinite(orderId) || orderId <= 0) {
    res.status(400).json({ error: "ID de orden invalido" });
    return;
  }
  const parsed = cancelacionUrgenteOrdenSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await cancelOrderUrgently(conn, {
      orderId,
      reason: parsed.data.motivo,
      refundMessage: parsed.data.mensaje_devolucion,
      creadoPor: req.user!.id,
    });
    const conversacionId = await notifyOrderCancellation(conn, {
      usuarioId: result.usuarioId,
      orderId,
      reason: parsed.data.motivo,
      refundMessage: parsed.data.mensaje_devolucion,
      authorUserId: req.user!.id,
    });
    await conn.commit();
    emitRealtime(["ordenes", "inventario", "stats", "puntos", "support"]);
    res.json({
      ok: true,
      estado: "cancelada",
      conversacion_id: conversacionId,
      requiere_devolucion: result.paymentRequiresRefund,
    });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

router.patch("/ordenes/:id", async (req, res, next) => {
  const orderId = Number(req.params.id);
  if (!Number.isFinite(orderId) || orderId <= 0) {
    res.status(400).json({ error: "ID de orden invalido" });
    return;
  }

  const schema = z.object({
    estado: z.enum(["pagada", "preparada", "enviada", "entregada"]),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }
  const { estado } = parsed.data;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const orden = await qOne<{
      id: number;
      estado: "pendiente_pago" | "pagada" | "preparada" | "enviada" | "entregada" | "cancelada" | "expirada" | string;
      sucursal_retiro_id: number | null;
    }>(
      conn,
      `SELECT id, estado, sucursal_retiro_id
       FROM ordenes
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [orderId],
    );
    if (!orden) {
      await conn.rollback();
      res.status(404).json({ error: "Orden no encontrada" });
      return;
    }
    if (orden.estado === estado) {
      await conn.commit();
      res.json({ ok: true, unchanged: true });
      return;
    }
    if (["entregada", "cancelada", "expirada"].includes(orden.estado)) {
      await conn.rollback();
      res.status(400).json({ error: `No se puede modificar una orden en estado '${orden.estado}'.` });
      return;
    }

    const pago = await qOne<{ proveedor: string; metodo: string | null; estado: string }>(
      conn,
      `SELECT proveedor, metodo, estado
       FROM pagos
       WHERE orden_id = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT 1
       FOR UPDATE`,
      [orderId],
    );
    const isCashPayment = pago?.proveedor === "efectivo" || pago?.metodo === "cash";
    const paidStates = ["pagada", "preparada", "enviada", "entregada"];
    const allowedTransitions: Record<string, string[]> = {
      pendiente_pago: isCashPayment ? paidStates : [],
      pagada: ["preparada", "enviada", "entregada"],
      preparada: ["enviada", "entregada"],
      enviada: ["entregada"],
    };
    if (!(allowedTransitions[orden.estado] ?? []).includes(estado)) {
      await conn.rollback();
      res.status(400).json({ error: `No se puede pasar una orden de '${orden.estado}' a '${estado}' desde el panel vendedor.` });
      return;
    }

    // FLUJO CENTRALIZADO PARA PAGO AUTOMÁTICO (Efectivo)
    let shouldSendReceipt = false;

    if (orden.estado === "pendiente_pago" && paidStates.includes(estado)) {
      console.log(`[VENDEDOR/ORDENES] Aprobando pago automático para orden #${orderId} al pasar a ${estado}`);
      await approvePaidOrder(conn, {
        orderId,
        provider: "vendedor",
        creadoPor: req.user!.id,
      });
      shouldSendReceipt = true;
      
      if (estado === "pagada") {
        await conn.commit();
        emitRealtime(["ordenes", "inventario", "stats", "puntos"]);
        queueOrderReceiptEmail(orderId);
        res.json({ ok: true, mensaje: "Orden marcada como pagada correctamente" });
        return;
      }
      // Si es otro estado, seguimos abajo para el UPDATE final de estado
    }

    // RESTO DE TRANSICIONES
    await qRun(conn, "UPDATE ordenes SET estado = ? WHERE id = ?", [estado, orderId]);
    await conn.commit();
    emitRealtime(["ordenes", "inventario", "stats", "puntos"]);
    if (shouldSendReceipt) queueOrderReceiptEmail(orderId);
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

export default router;
