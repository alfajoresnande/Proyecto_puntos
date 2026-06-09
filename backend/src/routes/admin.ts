import path from "path";
import crypto from "crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { pool, qOne, qAll, qRun } from "../db";
import { requireAuth, requireRole } from "../auth";
import { emitRealtime } from "../realtime";
import { normalizeSafeImageUrl } from "../urlSafety";
import { getPersistedSecurityEvents, getSecurityMonitorSnapshot, recordSecurityEvent } from "../securityMonitor";
import { verifyUploadedImageFile } from "../uploadSecurity";
import { createFullBackupArchive } from "../services/backup";
import { UPLOADS_DIR } from "../paths";
import {
  adjustFlavorStockBySucursal,
  adjustStockBySucursal,
  finalizeFlavorStockForCheckoutItems,
  finalizeStockForCheckoutItems,
  finalizeReservedStockForCanje,
  getCanjeItemsStock,
  initializeInventoryForFlavor,
  initializeInventoryForProduct,
  releaseFlavorStockForCheckoutItems,
  releaseStockForCheckoutItems,
  releaseReservedStockForCanje,
} from "../services/stock";
import {
  acreditarPuntosPorCompra,
  recalcularSaldoPuntosUsuario,
  registrarMovimientoPuntos,
} from "../services/points";
import { runReservationExpirations } from "../services/expirations";
import { approvePaidOrder, cancelOrderUrgently, rejectOrExpirePendingOrder } from "../services/orderLifecycle";
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
  updateCajaSesionManually,
} from "../services/cashRegister";
import { getCajaReportData, renderCajaPdfBuffer } from "../services/cashRegisterReports";
import {
  getBuenosAiresDateStamp,
  getVentasReporteRows,
  cancelLocalSale,
  registerLocalSale,
  renderVentasExcelBuffer,
  renderVentasExcelHtml,
  renderVentasPdfBuffer,
  renderVentasPrintableHtml,
  updateLocalSale,
} from "../services/localSales";
import { notifyOrderCancellation } from "../services/supportNotifications";
import { sendOrderReceiptEmail } from "../services/email";
import {
  createShippingZone,
  listShippingZones,
  setShippingZoneActive,
  ShippingZoneError,
  updateShippingZone,
} from "../services/shippingZones";
import { getAppPresenceOverview } from "../services/appPresence";
const DEFAULT_INVITE_CODE_LENGTH = 9;
const MIN_INVITE_CODE_LENGTH = 6;
const MAX_INVITE_CODE_LENGTH = 20;
const MINIMUM_ALLOWED_AGE_YEARS = 13;

function parseBirthDate(raw: string): Date | null {
  const text = (raw || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const dt = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(dt.getTime())) return null;
  const [y, m, d] = text.split("-").map((x) => Number(x));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() + 1 !== m || dt.getUTCDate() !== d) return null;
  return dt;
}

function isAtLeastAge(date: Date, minYears: number): boolean {
  const today = new Date();
  const limit = new Date(Date.UTC(today.getUTCFullYear() - minYears, today.getUTCMonth(), today.getUTCDate()));
  return date.getTime() <= limit.getTime();
}

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

function toDateOnly(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const match = trimmed.match(/^\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : null;
  }
  return null;
}

function normalizeAdminUserRow<T extends Record<string, unknown>>(row: T): T {
  return {
    ...row,
    fecha_nacimiento: toDateOnly(row.fecha_nacimiento),
  };
}

// ── Configuración de multer para subida de imágenes ──────
const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png":  ".png",
  "image/webp": ".webp",
};
const IMAGE_EXT_TO_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function getAllowedImageExtension(file: Express.Multer.File): string | null {
  const mimeExt = MIME_TO_EXT[file.mimetype];
  if (mimeExt) return mimeExt;
  const originalExt = path.extname(file.originalname || "").toLowerCase();
  return IMAGE_EXT_TO_MIME[originalExt] ? originalExt : null;
}

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (_req, file, cb) => {
    const ext = getAllowedImageExtension(file);
    if (!ext) return cb(new Error("Tipo de archivo no permitido"), "");
    cb(null, `${uuidv4()}-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB máx
  fileFilter: (_req, file, cb) => {
    if (getAllowedImageExtension(file)) cb(null, true);
    else cb(new Error("Solo se permiten imágenes JPG, PNG o WEBP"));
  },
});

const router = Router();
router.use(requireAuth, requireRole("admin", "superAdmin"));

function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.rol !== "superAdmin") {
    res.status(403).json({ error: "Contacta a soporte para acceder a esta funcion." });
    return;
  }
  next();
}

function queueOrderReceiptEmail(orderId: number) {
  void sendOrderReceiptEmail(orderId).catch((err) => {
    console.error(`[MAIL] Error enviando comprobante orden #${orderId}:`, err instanceof Error ? err.message : err);
  });
}

async function ensureCanManageUser(req: Request, res: Response, userId: number): Promise<boolean> {
  const target = await qOne<{ id: number; rol: string }>(
    pool,
    "SELECT id, rol FROM usuarios WHERE id = ? LIMIT 1",
    [userId]
  );
  if (!target) {
    res.status(404).json({ error: "Usuario no encontrado" });
    return false;
  }
  if (req.user?.rol !== "superAdmin" && (target.rol === "superAdmin" || target.rol === "admin")) {
    res.status(404).json({ error: "Usuario no encontrado" });
    return false;
  }
  return true;
}

const strongPasswordSchema = z
  .string()
  .min(8, "La contrasena debe tener al menos 8 caracteres")
  .max(128, "La contrasena no puede superar 128 caracteres")
  .regex(/[^A-Za-z0-9]/, "La contrasena debe incluir al menos 1 caracter especial")
  .regex(/\d/, "La contrasena debe incluir al menos 1 numero");

const sucursalSchema = z.object({
  nombre: z.string().min(2).max(120),
  direccion: z.string().min(3).max(180),
  piso: z.string().max(30).optional().nullable(),
  localidad: z.string().min(2).max(120),
  provincia: z.string().min(2).max(120),
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

function makeInviteCode(length: number): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length }, () => chars[crypto.randomInt(chars.length)]).join("");
}

async function uniqueInviteCode(length: number): Promise<string> {
  while (true) {
    const code = makeInviteCode(length);
    const exists = await qOne(pool, "SELECT id FROM usuarios WHERE codigo_invitacion = ?", [code]);
    if (!exists) return code;
  }
}

async function getInviteCodeLength(): Promise<number> {
  const row = await qOne<{ valor: string }>(pool, "SELECT valor FROM configuracion WHERE clave = 'longitud_codigo_invitacion' LIMIT 1");
  const parsed = Number(row?.valor ?? DEFAULT_INVITE_CODE_LENGTH);
  if (!Number.isInteger(parsed)) return DEFAULT_INVITE_CODE_LENGTH;
  return Math.max(MIN_INVITE_CODE_LENGTH, Math.min(MAX_INVITE_CODE_LENGTH, parsed));
}

function normalizeProductImages(imagenes: string[] | undefined | null, imagenUrlFallback?: string | null): string[] {
  const clean = (imagenes ?? [])
    .map((url) => normalizeSafeImageUrl(url))
    .filter((url): url is string => Boolean(url))
    .slice(0, 3);

  if (clean.length > 0) return clean;
  const fallback = normalizeSafeImageUrl(imagenUrlFallback);
  if (fallback) return [fallback];
  return [];
}

async function replaceProductImages(conn: any, productoId: number, imagenes: string[]) {
  await qRun(conn, "DELETE FROM producto_imagenes WHERE producto_id = ?", [productoId]);
  for (let index = 0; index < imagenes.length; index += 1) {
    await qRun(
      conn,
      "INSERT INTO producto_imagenes (producto_id, imagen_url, orden) VALUES (?, ?, ?)",
      [productoId, imagenes[index], index + 1]
    );
  }
}

function normalizeFlavorIds(raw: unknown[] | undefined | null): number[] {
  const seen = new Set<number>();
  for (const value of raw ?? []) {
    const id = Number(value);
    if (Number.isInteger(id) && id > 0) seen.add(id);
  }
  return Array.from(seen);
}

async function replaceProductFlavors(conn: any, productoId: number, flavorIds: number[]) {
  await qRun(conn, "DELETE FROM producto_sabores WHERE producto_id = ?", [productoId]);
  for (let index = 0; index < flavorIds.length; index += 1) {
    await qRun(
      conn,
      `INSERT INTO producto_sabores (producto_id, sabor_id, orden, activo)
       VALUES (?, ?, ?, 1)`,
      [productoId, flavorIds[index], index + 1],
    );
  }
}

type CanjeItemDetalle = {
  producto_id: number;
  producto_nombre: string;
  producto_imagen: string | null;
  cantidad: number;
  puntos_unitarios: number;
  puntos_total: number;
};

type OrdenItemAdminRow = {
  id: number;
  orden_id: number;
  producto_id: number;
  cantidad: number;
  modo_compra: "dinero" | "puntos";
  subtotal_dinero: number;
  subtotal_puntos: number;
  nombre: string;
  imagen_url: string | null;
  track_stock: number;
  sabores?: Array<{
    sabor_id: number;
    nombre: string;
    cantidad: number;
  }>;
};

const tipoClienteSchema = z.enum(["cliente", "mayorista", "empleado"]);
const descuentoTipoCategoriaSchema = z.object({
  tipo_cliente: tipoClienteSchema,
  categoria: z.string().min(1).max(100),
  descuento_porcentaje: z.number().min(0).max(100),
  activo: z.boolean().optional().default(true),
});
const descuentoTipoProductoSchema = z.object({
  tipo_cliente: tipoClienteSchema,
  producto_id: z.number().int().positive(),
  descuento_porcentaje: z.number().min(0).max(100),
  activo: z.boolean().optional().default(true),
});
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
const proveedorSchema = z.object({
  nombre: z.string().min(2).max(160),
  contacto: z.string().max(160).optional().nullable(),
  telefono: z.string().max(25).optional().nullable(),
  email: z.string().email().max(160).optional().nullable().or(z.literal("")),
  notas: z.string().max(2000).optional().nullable(),
  activo: z.boolean().optional().default(true),
});
const costoCobroSchema = z.object({
  proveedor: z.string().min(1).max(40),
  metodo: z.string().min(1).max(40),
  descripcion: z.string().min(2).max(160),
  porcentaje: z.number().min(0).max(100),
  activo: z.boolean().optional().default(true),
});
const costosCobroBulkSchema = z.array(costoCobroSchema).min(1).max(50);
const cajaAperturaSchema = z.object({
  sucursal_id: z.number().int().positive(),
  monto_apertura: z.number().min(0),
  observaciones: z.string().max(2000).optional().nullable(),
});
const cajaCierreSchema = z.object({
  monto_cierre_declarado: z.number().min(0),
  observaciones: z.string().max(2000).optional().nullable(),
});
const cajaEdicionSchema = z.object({
  monto_apertura: z.number().min(0),
  observaciones_apertura: z.string().max(2000).optional().nullable(),
  monto_cierre_declarado: z.number().min(0).optional().nullable(),
  observaciones_cierre: z.string().max(2000).optional().nullable(),
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
  const movimientos = await qAll<{
    id: number;
    tipo: "venta" | "gasto";
    referencia_tipo: string | null;
    referencia_id: number | null;
    medio_pago: string;
    monto: number;
    descripcion: string | null;
    creado_por: number;
    creado_por_nombre: string;
    created_at: string;
  }>(
    conn,
    `SELECT cm.id, cm.tipo, cm.referencia_tipo, cm.referencia_id, cm.medio_pago, cm.monto,
            cm.descripcion, cm.creado_por, u.nombre AS creado_por_nombre, cm.created_at
     FROM caja_movimientos cm
     JOIN usuarios u ON u.id = cm.creado_por
     WHERE cm.caja_sesion_id = ?
     ORDER BY cm.created_at DESC, cm.id DESC
     LIMIT 100`,
    [sessionId],
  );

  return {
    ...session,
    fecha_operativa: formatCashDateStamp(session.fecha_operativa),
    monto_apertura: Number(session.monto_apertura ?? 0),
    monto_cierre_sistema: session.monto_cierre_sistema === null ? null : Number(session.monto_cierre_sistema),
    monto_cierre_declarado: session.monto_cierre_declarado === null ? null : Number(session.monto_cierre_declarado),
    diferencia_cierre: session.diferencia_cierre === null ? null : Number(session.diferencia_cierre),
    summary,
    movimientos: movimientos.map((item) => ({
      ...item,
      monto: Number(item.monto ?? 0),
      referencia_id: item.referencia_id === null ? null : Number(item.referencia_id),
    })),
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

async function getOrdenItemsByOrdenIds(orderIds: number[]): Promise<Map<number, OrdenItemAdminRow[]>> {
  const map = new Map<number, OrdenItemAdminRow[]>();
  if (!orderIds.length) return map;

  const placeholders = orderIds.map(() => "?").join(", ");
  const rows = await qAll<OrdenItemAdminRow>(
    pool,
    `SELECT oi.id, oi.orden_id, oi.producto_id, oi.cantidad, oi.modo_compra,
            oi.subtotal_dinero, oi.subtotal_puntos, p.nombre, p.imagen_url, p.track_stock
     FROM orden_items oi
     JOIN productos p ON p.id = oi.producto_id
     WHERE oi.orden_id IN (${placeholders})
     ORDER BY oi.orden_id ASC, oi.id ASC`,
    orderIds,
  );

  const flavorMap = new Map<number, NonNullable<OrdenItemAdminRow["sabores"]>>();
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
    const list = map.get(Number(row.orden_id)) ?? [];
    list.push({
      ...row,
      id: Number(row.id),
      orden_id: Number(row.orden_id),
      producto_id: Number(row.producto_id),
      cantidad: Number(row.cantidad),
      subtotal_dinero: Number(row.subtotal_dinero),
      subtotal_puntos: Number(row.subtotal_puntos),
      track_stock: Number(row.track_stock ?? 0),
      sabores: flavorMap.get(Number(row.id)) ?? [],
    });
    map.set(Number(row.orden_id), list);
  }

  return map;
}

// ════════════════════════════════════════════════════════
//  ESTADÍSTICAS
// ════════════════════════════════════════════════════════

router.get("/stats", async (_req, res) => {
  const [clientes, productos, codigos, canjesPend, ptsEmitidos] = await Promise.all([
    qOne(pool, "SELECT COUNT(*) AS c FROM usuarios WHERE rol='cliente'"),
    qOne(pool, "SELECT COUNT(*) AS c FROM productos WHERE activo=1"),
    qOne(pool, "SELECT COUNT(*) AS c FROM codigos_puntos WHERE activo=1"),
    qOne(pool, "SELECT COUNT(*) AS c FROM canjes WHERE estado='pendiente'"),
    qOne(pool, "SELECT COALESCE(SUM(puntos),0) AS s FROM movimientos_puntos WHERE puntos > 0"),
  ]);
  res.json({
    clientes:          clientes?.c          ?? 0,
    productos:         productos?.c         ?? 0,
    codigos_activos:   codigos?.c           ?? 0,
    canjes_pendientes: canjesPend?.c        ?? 0,
    puntos_emitidos:   ptsEmitidos?.s       ?? 0,
  });
});

router.get("/personas-app", async (req, res) => {
  const requestedLimit = Number(req.query.limit ?? 80);
  const requestedActivePage = Number(req.query.active_page ?? 1);
  const requestedRecentPage = Number(req.query.recent_page ?? 1);
  const requestedPageSize = Number(req.query.page_size ?? 10);
  const pageSize = Number.isFinite(requestedPageSize) ? Math.max(5, Math.min(50, Math.floor(requestedPageSize))) : 10;
  const activePage = Number.isFinite(requestedActivePage) ? Math.max(1, Math.floor(requestedActivePage)) : 1;
  const recentPage = Number.isFinite(requestedRecentPage) ? Math.max(1, Math.floor(requestedRecentPage)) : 1;
  const computedRecentLimit = recentPage * pageSize;
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(computedRecentLimit, requestedLimit)
    : Math.max(80, computedRecentLimit);

  const overview = await getAppPresenceOverview(limit);
  const activeTotal = overview.active_sessions.length;
  const recentTotal = overview.recent_logs.length;
  const activeTotalPages = Math.max(1, Math.ceil(activeTotal / pageSize));
  const recentTotalPages = Math.max(1, Math.ceil(recentTotal / pageSize));
  const safeActivePage = Math.min(activePage, activeTotalPages);
  const safeRecentPage = Math.min(recentPage, recentTotalPages);
  const activeStart = (safeActivePage - 1) * pageSize;
  const recentStart = (safeRecentPage - 1) * pageSize;

  res.json({
    summary: overview.summary,
    active_sessions: {
      items: overview.active_sessions.slice(activeStart, activeStart + pageSize),
      total: activeTotal,
      page: safeActivePage,
      pageSize,
      totalPages: activeTotalPages,
    },
    recent_logs: {
      items: overview.recent_logs.slice(recentStart, recentStart + pageSize),
      total: recentTotal,
      page: safeRecentPage,
      pageSize,
      totalPages: recentTotalPages,
    },
  });
});

router.get("/security/monitor", requireSuperAdmin, async (req, res) => {
  const requested = Number(req.query.limit ?? 50);
  const limit = Number.isFinite(requested) ? requested : 50;
  const snapshot = getSecurityMonitorSnapshot();
  const persistidos = await getPersistedSecurityEvents(limit);
  res.json({ ...snapshot, persistidos });
});

router.post("/backup/full", requireSuperAdmin, async (req, res) => {
  try {
    const backup = await createFullBackupArchive();
    recordSecurityEvent("backup_full_generado", req, {
      archivo: backup.fileName,
      tamano_bytes: backup.sizeBytes,
    });
    res.download(backup.archivePath, backup.fileName);
  } catch (error) {
    const internalMessage = error instanceof Error ? error.message : "No se pudo generar el backup";
    recordSecurityEvent("backup_full_error", req, { error: internalMessage });
    res.status(500).json({ error: "No se pudo generar el backup en este momento" });
  }
});

// ════════════════════════════════════════════════════════
//  USUARIOS
// ════════════════════════════════════════════════════════

router.get("/usuarios", async (_req, res) => {
  const isSuperAdmin = _req.user?.rol === "superAdmin";
  const rows = await qAll(
    pool,
    `SELECT id, nombre, email, rol, tipo_cliente, descuento_porcentaje, dni, telefono, fecha_nacimiento, localidad, provincia, puntos_saldo, codigo_invitacion, activo, created_at
     FROM usuarios
     ${isSuperAdmin ? "" : "WHERE rol <> 'superAdmin'"}
     ORDER BY created_at DESC`
  );
  res.json(rows.map((row) => normalizeAdminUserRow(row)));
});

router.post("/usuarios", async (req, res) => {
  const schema = z.object({
    nombre:   z.string().min(1).max(100),
    email:    z.string().email(),
    password: strongPasswordSchema,
    rol:      z.enum(["cliente", "vendedor", "admin"]),
    tipo_cliente: tipoClienteSchema.optional().default("cliente"),
    descuento_porcentaje: z.number().min(0).max(100).optional().default(0),
    dni:      z.string().min(6).optional(),
    fecha_nacimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    localidad: z.string().min(2).max(120).optional().nullable(),
    provincia: z.string().min(2).max(120).optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }
  const { nombre, email, password, rol, tipo_cliente, descuento_porcentaje, dni, fecha_nacimiento, localidad, provincia } = parsed.data;

  if (rol === "admin" && req.user?.rol !== "superAdmin") {
    res.status(403).json({ error: "Contacta a soporte para crear administradores." });
    return;
  }
  if (rol === "cliente" && !dni) { res.status(400).json({ error: "DNI requerido para clientes" }); return; }
  if (rol === "cliente" && fecha_nacimiento) {
    const dt = parseBirthDate(fecha_nacimiento);
    if (!dt || !isAtLeastAge(dt, MINIMUM_ALLOWED_AGE_YEARS)) {
      res.status(400).json({ error: `Cliente debe tener al menos ${MINIMUM_ALLOWED_AGE_YEARS} años.` });
      return;
    }
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    let codigo: string | null = null;
    if (rol === "cliente") {
      const longitud = await getInviteCodeLength();
      codigo = await uniqueInviteCode(longitud);
    }
    const { insertId } = await qRun(pool,
      `INSERT INTO usuarios
         (nombre, email, email_verificado, email_verificado_at, password_hash, rol, tipo_cliente, descuento_porcentaje, dni, telefono, fecha_nacimiento, localidad, provincia, codigo_invitacion)
       VALUES (?, ?, 1, NOW(), ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
      [
        nombre,
        email.trim().toLowerCase(),
        hash,
        rol,
        rol === "cliente" ? tipo_cliente : "cliente",
        rol === "cliente" ? descuento_porcentaje : 0,
        dni ?? null,
        fecha_nacimiento ?? null,
        localidad?.trim() || null,
        provincia?.trim() || null,
        codigo,
      ]
    );
    res.status(201).json({ id: insertId });
  } catch (err: any) {
    if (err.code === "ER_DUP_ENTRY") { res.status(409).json({ error: "Email o DNI ya registrado" }); return; }
    throw err;
  }
});

router.put("/usuarios/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "ID de usuario inválido" });
    return;
  }

  if (!(await ensureCanManageUser(req, res, id))) return;

  const schema = z.object({
    nombre: z.string().min(1).max(100),
    email: z.string().email(),
    rol: z.enum(["cliente", "vendedor", "admin"]),
    tipo_cliente: tipoClienteSchema.optional().default("cliente"),
    descuento_porcentaje: z.number().min(0).max(100).optional().default(0),
    dni: z.string().min(6).max(20).optional().nullable(),
    telefono: z.string().max(25).optional().nullable(),
    fecha_nacimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    localidad: z.string().min(2).max(120).optional().nullable(),
    provincia: z.string().min(2).max(120).optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const { nombre, email, rol, tipo_cliente, descuento_porcentaje, dni, telefono, fecha_nacimiento, localidad, provincia } = parsed.data;
  if (rol === "admin" && req.user?.rol !== "superAdmin") {
    res.status(403).json({ error: "Contacta a soporte para editar o crear administradores." });
    return;
  }
  if (rol === "cliente" && !dni?.trim()) {
    res.status(400).json({ error: "DNI requerido para clientes" });
    return;
  }
  if (rol === "cliente" && fecha_nacimiento) {
    const dt = parseBirthDate(fecha_nacimiento);
    if (!dt || !isAtLeastAge(dt, MINIMUM_ALLOWED_AGE_YEARS)) {
      res.status(400).json({ error: `Cliente debe tener al menos ${MINIMUM_ALLOWED_AGE_YEARS} años.` });
      return;
    }
  }

  try {
    const { affectedRows } = await qRun(
      pool,
       `UPDATE usuarios
       SET nombre = ?, email = ?, rol = ?, tipo_cliente = ?, descuento_porcentaje = ?, dni = ?, telefono = ?, fecha_nacimiento = ?, localidad = ?, provincia = ?
        WHERE id = ?`,
      [
        nombre.trim(),
        email.trim().toLowerCase(),
        rol,
        rol === "cliente" ? tipo_cliente : "cliente",
        rol === "cliente" ? descuento_porcentaje : 0,
        dni?.trim() || null,
        telefono?.trim() || null,
        fecha_nacimiento ?? null,
        localidad?.trim() || null,
        provincia?.trim() || null,
        id,
      ]
    );
    if (affectedRows === 0) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    if (err.code === "ER_DUP_ENTRY") {
      res.status(409).json({ error: "Email o DNI ya registrado" });
      return;
    }
    throw err;
  }
});

router.patch("/usuarios/:id/activo", async (req, res) => {
  const id = Number(req.params.id);
  const { activo } = req.body;
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "ID de usuario invalido" });
    return;
  }
  if (typeof activo !== "boolean") { res.status(400).json({ error: "activo debe ser boolean" }); return; }
  if (!(await ensureCanManageUser(req, res, id))) return;
  const { affectedRows } = await qRun(pool, "UPDATE usuarios SET activo = ? WHERE id = ?", [activo ? 1 : 0, id]);
  if (affectedRows === 0) {
    res.status(404).json({ error: "Usuario no encontrado" });
    return;
  }
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════
//  PUNTOS MANUALES
// ════════════════════════════════════════════════════════

router.post("/puntos", async (req, res) => {
  const schema = z.object({
    usuario_id:  z.number().int().positive(),
    puntos:      z.number().int().refine((n) => n !== 0, "No puede ser 0"),
    descripcion: z.string().max(255).optional(),
    tipo:        z.enum(["asignacion_manual", "ajuste"]).default("asignacion_manual"),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }
  const { usuario_id, puntos, descripcion, tipo } = parsed.data;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const userRow = await qOne(conn, "SELECT id, puntos_saldo FROM usuarios WHERE id = ? AND rol = 'cliente'", [usuario_id]);
    if (!userRow) { res.status(404).json({ error: "Cliente no encontrado" }); return; }

    const nuevoSaldo = await registrarMovimientoPuntos(conn, {
      usuarioId: usuario_id,
      tipo,
      puntos,
      descripcion: descripcion ?? undefined,
      creadoPor: req.user!.id
    });

    await conn.commit();
    res.json({ ok: true, nuevo_saldo: nuevoSaldo });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

// ════════════════════════════════════════════════════════
//  CÓDIGOS DE PUNTOS
// ════════════════════════════════════════════════════════

router.get("/codigos", async (_req, res) => {
  const rows = await qAll(pool,
    `SELECT c.id, c.codigo, c.puntos_valor, c.usos_maximos, c.usos_actuales,
            c.fecha_expiracion, c.activo, c.created_at, u.nombre AS creado_por_nombre
     FROM codigos_puntos c JOIN usuarios u ON u.id = c.creado_por
     ORDER BY c.created_at DESC`
  );
  res.json(rows);
});

router.get("/codigos/:id/usos", async (req, res) => {
  const rows = await qAll(pool,
    `SELECT u.nombre, u.email, u.dni, uc.created_at AS usado_en
     FROM usos_codigos uc JOIN usuarios u ON u.id = uc.usuario_id
     WHERE uc.codigo_id = ? ORDER BY uc.created_at DESC`,
    [Number(req.params.id)]
  );
  res.json(rows);
});

router.post("/codigos", async (req, res) => {
  const schema = z.object({
    codigo:           z.string().min(3).max(50).transform((s) => s.toUpperCase().trim()),
    puntos_valor:     z.number().int().positive(),
    usos_maximos:     z.number().int().min(0).default(1),
    fecha_expiracion: z.string().datetime({ offset: true }).optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }
  const { codigo, puntos_valor, usos_maximos, fecha_expiracion } = parsed.data;

  let fechaExpMysql: string | null = null;
  if (fecha_expiracion) {
    const date = new Date(fecha_expiracion);
    if (Number.isNaN(date.getTime())) {
      res.status(400).json({ error: "La fecha de expiración no es válida" });
      return;
    }
    if (date.getTime() <= Date.now()) {
      res.status(400).json({ error: "La fecha de expiración debe ser futura" });
      return;
    }
    // MySQL DATETIME no acepta el sufijo "Z" ni los milisegundos del ISO 8601
    fechaExpMysql = date.toISOString().slice(0, 19).replace("T", " ");
  }

  try {
    const { insertId } = await qRun(pool,
      `INSERT INTO codigos_puntos (codigo, puntos_valor, usos_maximos, fecha_expiracion, creado_por)
       VALUES (?, ?, ?, ?, ?)`,
      [codigo, puntos_valor, usos_maximos, fechaExpMysql, req.user!.id]
    );
    res.status(201).json({ id: insertId, codigo });
  } catch (err: any) {
    if (err.code === "ER_DUP_ENTRY") { res.status(409).json({ error: "Ya existe un código con ese nombre" }); return; }
    console.error("POST /admin/codigos:", err);
    res.status(500).json({ error: "No se pudo crear el código" });
  }
});

router.patch("/codigos/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { activo } = req.body;
  if (typeof activo !== "boolean") { res.status(400).json({ error: "activo (boolean) requerido" }); return; }
  await qRun(pool, "UPDATE codigos_puntos SET activo = ? WHERE id = ?", [activo ? 1 : 0, id]);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════
//  CANJES
// ════════════════════════════════════════════════════════

router.get("/canjes", async (_req, res) => {
  const rows = await qAll(pool,
    `SELECT c.id, c.codigo_retiro, c.puntos_usados, c.estado, c.fecha_limite_retiro, c.notas,
            c.created_at, c.updated_at,
            u.nombre AS cliente_nombre, u.email AS cliente_email, u.dni AS cliente_dni,
            p.nombre AS producto_nombre,
            s.id AS sucursal_id, s.nombre AS sucursal_nombre, s.direccion AS sucursal_direccion,
            s.piso AS sucursal_piso, s.localidad AS sucursal_localidad, s.provincia AS sucursal_provincia
     FROM canjes c
     JOIN usuarios u ON u.id = c.usuario_id
     JOIN productos p ON p.id = c.producto_id
     LEFT JOIN sucursales s ON s.id = c.sucursal_id
     ORDER BY c.created_at DESC`
  );
  if (!rows.length) {
    res.json([]);
    return;
  }

  const itemsMap = await getCanjeItemsByCanjeIds(rows.map((row: any) => Number(row.id)));
  const payload = rows.map((row: any) => {
    const fallbackItem: CanjeItemDetalle = {
      producto_id: 0,
      producto_nombre: String(row.producto_nombre),
      producto_imagen: null,
      cantidad: 1,
      puntos_unitarios: Number(row.puntos_usados),
      puntos_total: Number(row.puntos_usados),
    };
    const items = itemsMap.get(Number(row.id)) ?? [fallbackItem];
    const totalUnidades = items.reduce((acc, item) => acc + Number(item.cantidad), 0);
    const primerItem = items[0];
    const productoNombreVista =
      items.length > 1 ? `${primerItem.producto_nombre} +${items.length - 1} mas` : primerItem.producto_nombre;

    return {
      ...row,
      producto_nombre: productoNombreVista,
      items,
      total_items: items.length,
      total_unidades: totalUnidades,
      productos_detalle: items.map((item) => `${item.producto_nombre} x${item.cantidad}`).join(" | "),
    };
  });

  res.json(payload);
});

router.patch("/canjes/:id", async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({
    estado: z.enum(["pendiente", "entregado", "no_disponible", "expirado", "cancelado"]),
    notas: z.string().max(1000).optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }
  const { estado, notas } = parsed.data;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const canje = await qOne<{
      id: number;
      usuario_id: number;
      puntos_usados: number;
      estado: "pendiente" | "entregado" | "no_disponible" | "expirado" | "cancelado";
      sucursal_id: number | null;
      producto_id: number;
    }>(
      conn,
      "SELECT id, usuario_id, puntos_usados, estado, sucursal_id, producto_id FROM canjes WHERE id = ? FOR UPDATE",
      [id],
    );
    if (!canje) { res.status(404).json({ error: "Canje no encontrado" }); return; }

    if (canje.estado === estado) {
      await conn.commit();
      res.json({ ok: true, unchanged: true });
      return;
    }
    if (canje.estado !== "pendiente") {
      res.status(400).json({ error: `No se puede modificar un canje en estado '${canje.estado}'` });
      return;
    }

    const canjeItems = await getCanjeItemsStock(conn, id);
    const itemsForStock = canjeItems.length
      ? canjeItems
      : [{ producto_id: Number(canje.producto_id), cantidad: 1 }];

    if (Number(canje.sucursal_id) > 0) {
      if (estado === "entregado") {
        await finalizeReservedStockForCanje(conn, {
          sucursalId: Number(canje.sucursal_id),
          items: itemsForStock,
          canjeId: id,
          creadoPor: req.user!.id,
        });
      } else if (estado === "no_disponible" || estado === "cancelado" || estado === "expirado") {
        await releaseReservedStockForCanje(conn, {
          sucursalId: Number(canje.sucursal_id),
          items: itemsForStock,
          canjeId: id,
          strict: false,
          creadoPor: req.user!.id,
        });
      }
    }

    await qRun(conn, "UPDATE canjes SET estado = ?, notas = ? WHERE id = ?", [estado, notas ?? null, id]);

    if (estado === "no_disponible" || estado === "cancelado") {
      const motivo = estado === "cancelado" ? "cancelado" : "no disponible";
      await registrarMovimientoPuntos(conn, {
        usuarioId: Number(canje.usuario_id),
        tipo: "devolucion_canje",
        puntos: Number(canje.puntos_usados),
        descripcion: `Devolucion por canje ${motivo}`,
        referenciaId: id,
        referenciaTipo: "canjes",
        creadoPor: req.user!.id,
      });
    }

    await conn.commit();
    emitRealtime(["canjes", "inventario", "stats", "puntos"]);
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

// ════════════════════════════════════════════════════════
//  MOVIMIENTOS (historial global)
// ════════════════════════════════════════════════════════

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
const cancelacionUrgenteOrdenSchema = z.object({
  motivo: z.string().trim().min(8).max(1000),
  mensaje_devolucion: z.string().trim().max(1000).optional().nullable(),
});

router.post("/ventas-locales", async (req, res) => {
  const parsed = ventaLocalSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await registerLocalSale(conn, {
      canal: "admin",
      usuarioId: parsed.data.usuario_id ?? null,
      clienteLocal: parsed.data.cliente_local ?? null,
      sucursalId: parsed.data.sucursal_id,
      metodoPago: parsed.data.metodo_pago,
      acreditarPuntos: Boolean(parsed.data.usuario_id),
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

router.put("/ventas-locales/:id", async (req, res) => {
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
    const order = await qOne<{ canal: "admin" | "vendedor" | "web" }>(
      conn,
      "SELECT canal FROM ordenes WHERE id = ? AND tipo_orden = 'venta' LIMIT 1 FOR UPDATE",
      [orderId],
    );
    if (!order || (order.canal !== "admin" && order.canal !== "vendedor")) {
      throw new Error("Solo se pueden editar ventas locales.");
    }
    const result = await updateLocalSale(conn, {
      orderId,
      canal: order.canal,
      usuarioId: parsed.data.usuario_id ?? null,
      clienteLocal: parsed.data.cliente_local ?? null,
      sucursalId: parsed.data.sucursal_id,
      metodoPago: parsed.data.metodo_pago,
      acreditarPuntos: Boolean(parsed.data.usuario_id),
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

router.post(["/ventas-locales/:id/cancelar", "/ventas-locales/:id/anular"], async (req, res) => {
  const orderId = Number(req.params.id);
  if (!Number.isFinite(orderId) || orderId <= 0) {
    res.status(400).json({ error: "Venta local invalida." });
    return;
  }
  const parsed = z.object({
    motivo: z.string().trim().max(1000).optional().nullable(),
  }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await cancelLocalSale(conn, {
      orderId,
      motivo: parsed.data.motivo,
      creadoPor: req.user!.id,
    });
    await conn.commit();
    emitRealtime(["ordenes", "stats", "puntos", "inventario"]);
    res.json(result);
  } catch (err: any) {
    await conn.rollback();
    res.status(400).json({ error: err?.message || "No se pudo cancelar la venta local." });
  } finally {
    conn.release();
  }
});

router.get("/ventas/export", async (req, res, next) => {
  try {
    const rows = await getVentasReporteRows(pool, {
      desde: typeof req.query.desde === "string" ? req.query.desde : null,
      hasta: typeof req.query.hasta === "string" ? req.query.hasta : null,
      canal: req.query.canal === "web" || req.query.canal === "admin" || req.query.canal === "vendedor"
        ? req.query.canal
        : null,
      estado: typeof req.query.estado === "string" ? req.query.estado : null,
    });
    const formato = typeof req.query.formato === "string" ? req.query.formato.toLowerCase() : "html";
    const stamp = getBuenosAiresDateStamp();

    if (formato === "xlsx" || formato === "excel") {
      const excel = await renderVentasExcelBuffer(rows);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="ventas-${stamp}.xlsx"`);
      res.send(excel);
      return;
    }

    if (formato === "xls") {
      res.setHeader("Content-Type", "application/vnd.ms-excel; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="ventas-${stamp}.xls"`);
      res.send(renderVentasExcelHtml(rows));
      return;
    }

    if (formato === "pdf") {
      const pdf = await renderVentasPdfBuffer(rows);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="ventas-${stamp}.pdf"`);
      res.send(pdf);
      return;
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="ventas-${stamp}.html"`);
    res.send(renderVentasPrintableHtml(rows));
  } catch (err) {
    next(err);
  }
});

router.get("/proveedores", async (_req, res) => {
  const rows = await qAll(
    pool,
    `SELECT id, nombre, contacto, telefono, email, notas, activo, created_at, updated_at
     FROM proveedores
     ORDER BY activo DESC, nombre ASC, id ASC`,
  );
  res.json(rows.map((row: any) => ({ ...row, activo: Boolean(row.activo) })));
});

router.post("/proveedores", async (req, res) => {
  const parsed = proveedorSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  try {
    const result = await qRun(
      pool,
      `INSERT INTO proveedores (nombre, contacto, telefono, email, notas, activo)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        parsed.data.nombre.trim(),
        parsed.data.contacto?.trim() || null,
        parsed.data.telefono?.trim() || null,
        parsed.data.email?.trim() || null,
        parsed.data.notas?.trim() || null,
        parsed.data.activo ? 1 : 0,
      ],
    );
    emitRealtime(["admin-config"]);
    res.status(201).json({ ok: true, id: result.insertId });
  } catch (err: any) {
    if (err?.code === "ER_DUP_ENTRY") {
      res.status(409).json({ error: "Ya existe un proveedor con ese nombre." });
      return;
    }
    throw err;
  }
});

router.put("/proveedores/:id", async (req, res) => {
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
       SET nombre = ?, contacto = ?, telefono = ?, email = ?, notas = ?, activo = ?
       WHERE id = ?`,
      [
        parsed.data.nombre.trim(),
        parsed.data.contacto?.trim() || null,
        parsed.data.telefono?.trim() || null,
        parsed.data.email?.trim() || null,
        parsed.data.notas?.trim() || null,
        parsed.data.activo ? 1 : 0,
        proveedorId,
      ],
    );
    if (!result.affectedRows) {
      res.status(404).json({ error: "Proveedor no encontrado." });
      return;
    }
    emitRealtime(["admin-config"]);
    res.json({ ok: true });
  } catch (err: any) {
    if (err?.code === "ER_DUP_ENTRY") {
      res.status(409).json({ error: "Ya existe otro proveedor con ese nombre." });
      return;
    }
    throw err;
  }
});

router.get("/costos-cobro", async (_req, res) => {
  const rows = await qAll(
    pool,
    `SELECT id, proveedor, metodo, descripcion, porcentaje, activo, created_at, updated_at
     FROM costos_cobro
     ORDER BY proveedor ASC, metodo ASC, id ASC`,
  );
  res.json(rows.map((row: any) => ({
    ...row,
    porcentaje: Number(row.porcentaje ?? 0),
    activo: Boolean(row.activo),
  })));
});

router.put("/costos-cobro", async (req, res) => {
  const parsed = costosCobroBulkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const item of parsed.data) {
      await qRun(
        conn,
        `INSERT INTO costos_cobro (proveedor, metodo, descripcion, porcentaje, activo)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           descripcion = VALUES(descripcion),
           porcentaje = VALUES(porcentaje),
           activo = VALUES(activo)`,
        [
          item.proveedor.trim().toLowerCase(),
          item.metodo.trim().toLowerCase(),
          item.descripcion.trim(),
          item.porcentaje,
          item.activo ? 1 : 0,
        ],
      );
    }
    await conn.commit();
    emitRealtime(["admin-config"]);
    res.json({ ok: true });
  } catch (err: any) {
    await conn.rollback();
    res.status(400).json({ error: err?.message || "No se pudieron guardar los costos de cobro." });
  } finally {
    conn.release();
  }
});

router.get("/caja/actual", async (req, res) => {
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
  } catch (err: any) {
    await conn.rollback();
    res.status(400).json({ error: err?.message || "No se pudo obtener la caja del dia." });
  } finally {
    conn.release();
  }
});

router.post("/caja/apertura", async (req, res) => {
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
  } catch (err: any) {
    await conn.rollback();
    res.status(400).json({ error: err?.message || "No se pudo abrir la caja." });
  } finally {
    conn.release();
  }
});

router.post("/caja/:id/cierre", async (req, res) => {
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
  } catch (err: any) {
    await conn.rollback();
    res.status(400).json({ error: err?.message || "No se pudo cerrar la caja." });
  } finally {
    conn.release();
  }
});

router.put("/caja/sesiones/:id", async (req, res) => {
  const sessionId = Number(req.params.id);
  const parsed = cajaEdicionSchema.safeParse(req.body);
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
    await updateCajaSesionManually(conn, {
      cajaSesionId: sessionId,
      montoApertura: Number(parsed.data.monto_apertura),
      observacionesApertura: parsed.data.observaciones_apertura,
      montoCierreDeclarado: parsed.data.monto_cierre_declarado ?? null,
      observacionesCierre: parsed.data.observaciones_cierre,
      usuarioId: req.user!.id,
    });
    await conn.commit();
    emitRealtime(["ordenes"]);
    res.json(await getCajaSesionPayload(pool, sessionId));
  } catch (err: any) {
    await conn.rollback();
    res.status(400).json({ error: err?.message || "No se pudo actualizar la caja." });
  } finally {
    conn.release();
  }
});

router.get("/caja/sesiones", async (req, res) => {
  const sucursalId = Number(req.query.sucursal_id ?? 0);
  const desde = typeof req.query.desde === "string" ? req.query.desde : null;
  const hasta = typeof req.query.hasta === "string" ? req.query.hasta : null;
  const rawPage = Number(req.query.page ?? 1);
  const rawLimit = Number(req.query.limit ?? 12);
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 50) : 12;
  const offset = (page - 1) * limit;
  const where = ["1 = 1"];
  const params: Array<string | number> = [];

  if (Number.isInteger(sucursalId) && sucursalId > 0) {
    where.push("cs.sucursal_id = ?");
    params.push(sucursalId);
  }
  if (desde) {
    where.push("cs.fecha_operativa >= ?");
    params.push(desde);
  }
  if (hasta) {
    where.push("cs.fecha_operativa <= ?");
    params.push(hasta);
  }

  await closeStaleCajaSesiones(pool);
  const totalRow = await qOne<{ total: number }>(
    pool,
    `SELECT COUNT(*) AS total
     FROM caja_sesiones cs
     WHERE ${where.join(" AND ")}`,
    params,
  );
  const total = Number(totalRow?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const rows = await qAll<{ id: number }>(
    pool,
    `SELECT cs.id
     FROM caja_sesiones cs
     WHERE ${where.join(" AND ")}
     ORDER BY cs.apertura_at DESC, cs.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  const payload = [];
  for (const row of rows) {
    const session = await getCajaSesionPayload(pool, Number(row.id));
    if (session) payload.push(session);
  }
  res.json({
    items: payload,
    total,
    page,
    pageSize: limit,
    totalPages,
  });
});

router.get("/caja/export", async (req, res) => {
  const sucursalId = Number(req.query.sucursal_id ?? 0);
  const fecha = typeof req.query.fecha === "string" ? req.query.fecha : "";
  if (!Number.isInteger(sucursalId) || sucursalId <= 0) {
    res.status(400).json({ error: "Sucursal invalida." });
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    res.status(400).json({ error: "Fecha invalida. Usa formato YYYY-MM-DD." });
    return;
  }

  try {
    const data = await getCajaReportData(pool, { sucursalId, fecha });
    const pdf = await renderCajaPdfBuffer(data);
    const safeBranch = data.session.sucursal_nombre.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 40) || "sucursal";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="caja-${safeBranch}-${fecha}.pdf"`);
    res.send(pdf);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "No se pudo generar el reporte de caja." });
  }
});

router.get("/gastos", async (req, res) => {
  const sucursalId = Number(req.query.sucursal_id ?? 0);
  const cajaSesionId = Number(req.query.caja_sesion_id ?? 0);
  const where = ["1 = 1"];
  const params: Array<string | number> = [];

  if (Number.isInteger(sucursalId) && sucursalId > 0) {
    where.push("g.sucursal_id = ?");
    params.push(sucursalId);
  }
  if (Number.isInteger(cajaSesionId) && cajaSesionId > 0) {
    where.push("g.caja_sesion_id = ?");
    params.push(cajaSesionId);
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
     LIMIT 200`,
    params,
  );
  res.json(rows.map((row: any) => ({ ...row, monto: Number(row.monto ?? 0) })));
});

router.post("/gastos", async (req, res) => {
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
  } catch (err: any) {
    await conn.rollback();
    res.status(400).json({ error: err?.message || "No se pudo registrar el gasto." });
  } finally {
    conn.release();
  }
});

router.put("/gastos/:id", async (req, res) => {
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
  } catch (err: any) {
    await conn.rollback();
    res.status(400).json({ error: err?.message || "No se pudo actualizar el gasto." });
  } finally {
    conn.release();
  }
});

router.get("/ordenes", async (_req, res) => {
  const rows = await qAll<{
    id: number;
    usuario_id: number | null;
    cliente_local_id: number | null;
    cliente_local_dni: string | null;
    cliente_local_telefono: string | null;
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
              cl.dni AS cliente_local_dni, cl.telefono AS cliente_local_telefono,
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
                  AND NOT EXISTS (
                    SELECT 1
                    FROM movimientos_puntos cancelacion
                    WHERE cancelacion.usuario_id = mp.usuario_id
                      AND cancelacion.referencia_tipo = 'ordenes_cancelacion'
                      AND cancelacion.referencia_id = mp.referencia_id
                      AND cancelacion.tipo = 'ajuste'
                  )
              ) AS puntos_acreditados,
              o.notas, o.created_at, o.updated_at
     FROM ordenes o
     LEFT JOIN usuarios u ON u.id = o.usuario_id
     LEFT JOIN clientes_locales cl ON cl.id = o.cliente_local_id
     LEFT JOIN sucursales s ON s.id = o.sucursal_retiro_id
     WHERE NOT (
       o.direccion_envio_json IS NOT NULL
       AND o.estado IN ('borrador', 'pendiente_pago', 'expirada', 'cancelada')
       AND NOT EXISTS (
         SELECT 1
         FROM pagos p_visible
         WHERE p_visible.orden_id = o.id
           AND p_visible.estado IN ('aprobado', 'reembolsado')
       )
     )
     ORDER BY o.created_at DESC, o.id DESC`,
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
        cliente_dni: row.cliente_dni ?? row.cliente_local_dni ?? null,
        cliente_telefono: row.cliente_telefono ?? row.cliente_local_telefono ?? null,
        total_dinero: Number(row.total_dinero ?? 0),
        total_puntos: Number(row.total_puntos ?? 0),
        total_items: items.length,
        total_unidades: items.reduce((acc, item) => acc + Number(item.cantidad), 0),
        puntos_acreditados: Boolean(row.puntos_acreditados),
        items,
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
});

router.post(["/ordenes/:id/cancelar", "/ordenes/:id/cancelar-urgente"], async (req, res) => {
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
  } catch (err: any) {
    await conn.rollback();
    res.status(400).json({ error: err?.message || "No se pudo cancelar la orden." });
  } finally {
    conn.release();
  }
});

router.patch("/ordenes/:id", async (req, res) => {
  const orderId = Number(req.params.id);
  if (!Number.isFinite(orderId) || orderId <= 0) {
    res.status(400).json({ error: "ID de orden invalido" });
    return;
  }

  const schema = z.object({
    estado: z.enum(["pendiente_pago", "pagada", "preparandose", "preparada", "enviada", "entregando", "entregada", "cancelada", "expirada"]),
    notas: z.string().max(1000).optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }
  const { estado, notas } = parsed.data;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const orden = await qOne<{
      id: number;
      usuario_id: number;
      estado: "borrador" | "pendiente_pago" | "pagada" | "preparandose" | "preparada" | "enviada" | "entregando" | "entregada" | "cancelada" | "expirada";
      total_puntos: number;
      sucursal_retiro_id: number | null;
      total_dinero: number;
    }>(
      conn,
      `SELECT id, usuario_id, estado, total_puntos, sucursal_retiro_id, total_dinero
       FROM ordenes
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [orderId],
    );
    if (!orden) {
      res.status(404).json({ error: "Orden no encontrada" });
      return;
    }
    if (orden.estado === estado) {
      await conn.commit();
      res.json({ ok: true, unchanged: true });
      return;
    }
    if (orden.estado === "entregada" || orden.estado === "cancelada" || orden.estado === "expirada") {
      res.status(400).json({ error: `No se puede modificar una orden en estado '${orden.estado}'.` });
      return;
    }

    // FLUJO CENTRALIZADO PARA PAGO AUTOMÁTICO
    // Si la orden está pendiente y se mueve a un estado que implica cobro (pagada, preparada, enviada, entregada)
    let shouldSendReceipt = false;

    if (estado === "cancelada") {
      await cancelOrderUrgently(conn, {
        orderId,
        reason: notas?.trim() || "Cancelacion desde panel administrativo.",
        creadoPor: req.user!.id,
      });
      await conn.commit();
      emitRealtime(["ordenes", "inventario", "stats", "puntos"]);
      res.json({ ok: true });
      return;
    }

    const paidStates = ["pagada", "preparandose", "preparada", "enviada", "entregando", "entregada"];
    if (orden.estado === "pendiente_pago" && paidStates.includes(estado)) {
      console.log(`[ADMIN/ORDENES] Aprobando pago automático para orden #${orderId} al pasar a ${estado}`);
      await approvePaidOrder(conn, {
        orderId,
        provider: "admin",
        creadoPor: req.user!.id,
      });
      shouldSendReceipt = true;
      // NO hacemos commit/return aquí todavía si el estado final deseado NO es 'pagada'
      // Si el estado es 'pagada', ya terminamos.
      if (estado === "pagada") {
        await conn.commit();
        emitRealtime(["ordenes", "inventario", "stats", "puntos"]);
        queueOrderReceiptEmail(orderId);
        res.json({ ok: true, mensaje: "Orden marcada como pagada correctamente" });
        return;
      }
      // Si el estado es otro (preparada, entregada, etc), seguimos abajo para el UPDATE de estado final
      // Pero 'orden.estado' sigue siendo 'pendiente_pago' en memoria, hay que tener cuidado con las validaciones de abajo.
    }

    // RESTO DE TRANSICIONES
    const allowedTransitions: Record<string, string[]> = {
      borrador: ["pendiente_pago", "cancelada"],
      pendiente_pago: ["pagada", "preparandose", "preparada", "enviada", "entregando", "entregada", "cancelada", "expirada"],
      pagada: ["preparandose", "preparada", "enviada", "entregando", "entregada", "cancelada"],
      preparandose: ["preparada", "enviada", "entregando", "entregada", "cancelada"],
      preparada: ["enviada", "entregando", "entregada", "cancelada"],
      enviada: ["entregando", "entregada", "cancelada"],
      entregando: ["entregada", "cancelada"],
    };

    if (!(allowedTransitions[orden.estado] ?? []).includes(estado)) {
      res.status(400).json({ error: `No se puede pasar una orden de '${orden.estado}' a '${estado}'.` });
      return;
    }

    const itemsByOrder = await qAll<OrdenItemAdminRow>(
      conn,
      `SELECT oi.id, oi.orden_id, oi.producto_id, oi.cantidad, oi.modo_compra,
              oi.subtotal_dinero, oi.subtotal_puntos, p.nombre, p.track_stock
       FROM orden_items oi
       JOIN productos p ON p.id = oi.producto_id
       WHERE oi.orden_id = ?
       ORDER BY oi.id ASC`,
      [orderId],
    );

    if (orden.sucursal_retiro_id) {
      const stockItems = itemsByOrder
        .filter((item) => Number(item.track_stock ?? 0) === 1)
        .map((item) => ({
          producto_id: Number(item.producto_id),
          cantidad: Number(item.cantidad),
          origen: item.modo_compra === "dinero" ? ("compra" as const) : ("canje" as const),
          descripcion: `Orden #${orderId} -> ${estado}`,
        }));
      const flavorItems = await qAll<{ sabor_id: number; cantidad: number; modo_compra: "dinero" | "puntos" }>(
        conn,
        `SELECT ois.sabor_id, ois.cantidad, oi.modo_compra
         FROM orden_item_sabores ois
         JOIN orden_items oi ON oi.id = ois.orden_item_id
         WHERE oi.orden_id = ?
         ORDER BY oi.id ASC, ois.id ASC`,
        [orderId],
      );
      const flavorStockItems = flavorItems.map((item) => ({
        sabor_id: Number(item.sabor_id),
        cantidad: Number(item.cantidad),
        origen: item.modo_compra === "dinero" ? ("compra" as const) : ("canje" as const),
        descripcion: `Orden #${orderId} -> ${estado}`,
      }));

      if (stockItems.length || flavorStockItems.length) {
        // Si ya pasó por approvePaidOrder (estado inicial pendiente_pago y final en paidStates), 
        // approvePaidOrder ya ejecutó finalizeStockForCheckoutItems. 
        // No debemos duplicarlo.
        const skipStockIfPaidNow = (orden.estado === "pendiente_pago" && paidStates.includes(estado));
        
        const shouldFinalizeStock = !skipStockIfPaidNow && (estado === "entregada" && orden.estado !== "pagada");
        const shouldReleaseReservedStock =
          estado === "expirada" &&
          (orden.estado === "pendiente_pago" || orden.estado === "preparada");

        if (shouldFinalizeStock) {
          if (stockItems.length) {
            await finalizeStockForCheckoutItems(conn, {
              sucursalId: Number(orden.sucursal_retiro_id),
              items: stockItems,
              referencia: `orden #${orderId}`,
              creadoPor: req.user!.id,
              ordenId: orderId,
            });
          }
          if (flavorStockItems.length) {
            await finalizeFlavorStockForCheckoutItems(conn, {
              sucursalId: Number(orden.sucursal_retiro_id),
              items: flavorStockItems,
              referencia: `orden #${orderId}`,
              creadoPor: req.user!.id,
              ordenId: orderId,
            });
          }
        } else if (shouldReleaseReservedStock) {
          if (stockItems.length) {
            await releaseStockForCheckoutItems(conn, {
              sucursalId: Number(orden.sucursal_retiro_id),
              items: stockItems,
              referencia: `orden #${orderId}`,
              creadoPor: req.user!.id,
              ordenId: orderId,
            });
          }
          if (flavorStockItems.length) {
            await releaseFlavorStockForCheckoutItems(conn, {
              sucursalId: Number(orden.sucursal_retiro_id),
              items: flavorStockItems,
              referencia: `orden #${orderId}`,
              creadoPor: req.user!.id,
              ordenId: orderId,
            });
          }
        }
      }
    }

    if (estado === "expirada" && Number(orden.total_puntos ?? 0) > 0) {
      await registrarMovimientoPuntos(conn, {
        usuarioId: Number(orden.usuario_id),
        tipo: 'devolucion_canje',
        puntos: Number(orden.total_puntos),
        descripcion: `Devolucion puntos por ${estado} orden #${orderId}`,
        referenciaId: orderId,
        referenciaTipo: 'ordenes',
        creadoPor: req.user!.id
      });
    }

    await qRun(conn, "UPDATE ordenes SET estado = ?, notas = COALESCE(?, notas) WHERE id = ?", [
      estado,
      notas ?? null,
      orderId,
    ]);

    if (Number(orden.total_dinero ?? 0) > 0) {
      if (estado === "expirada") {
        await qRun(conn, "UPDATE pagos SET estado = 'rechazado' WHERE orden_id = ? AND estado = 'iniciado'", [orderId]);
      }
    }

    await conn.commit();
    emitRealtime(["ordenes", "inventario", "stats", "puntos"]);
    if (shouldSendReceipt) queueOrderReceiptEmail(orderId);
    res.json({ ok: true });
  } catch (err: any) {
    await conn.rollback();
    res.status(400).json({ error: err?.message || "No se pudo actualizar la orden." });
  } finally {
    conn.release();
  }
});

router.get("/movimientos", async (_req, res) => {
  const rows = await qAll(pool,
    `SELECT m.id,
            CASE
              WHEN m.tipo = 'ajuste' AND m.referencia_tipo = 'ordenes_cancelacion'
                THEN 'cancelacion_compra'
              ELSE m.tipo
            END AS tipo,
            m.puntos,
            CASE
              WHEN m.tipo = 'ajuste' AND m.referencia_tipo = 'ordenes_cancelacion'
                THEN COALESCE(NULLIF(m.descripcion, ''), CONCAT('Anulacion de puntos por cancelacion de compra #', m.referencia_id))
              ELSE m.descripcion
            END AS descripcion,
            m.referencia_tipo, m.created_at,
            u.nombre AS usuario_nombre, u.email AS usuario_email,
            a.nombre AS admin_nombre
     FROM movimientos_puntos m
     JOIN usuarios u ON u.id = m.usuario_id
     LEFT JOIN usuarios a ON a.id = m.creado_por
     WHERE NOT (
       m.tipo = 'acreditacion_compra'
       AND m.referencia_tipo = 'ordenes'
       AND EXISTS (
         SELECT 1
         FROM movimientos_puntos cancelacion
         WHERE cancelacion.usuario_id = m.usuario_id
           AND cancelacion.referencia_tipo = 'ordenes_cancelacion'
           AND cancelacion.referencia_id = m.referencia_id
           AND cancelacion.tipo = 'ajuste'
       )
     )
     ORDER BY m.created_at DESC LIMIT 500`
  );
  res.json(rows);
});

// Sabores para cajas configurables
router.get("/sabores", async (_req, res) => {
  const sabores = await qAll<{
    id: number;
    nombre: string;
    descripcion: string | null;
    activo: number;
    created_at: string;
    updated_at: string;
  }>(
    pool,
    `SELECT id, nombre, descripcion, activo, created_at, updated_at
     FROM sabores
     ORDER BY nombre ASC, id ASC`,
  );

  if (!sabores.length) {
    res.json([]);
    return;
  }

  const ids = sabores.map((sabor) => Number(sabor.id));
  const placeholders = ids.map(() => "?").join(", ");
  const inventario = await qAll<{
    sabor_id: number;
    sucursal_id: number;
    sucursal_nombre: string;
    stock_disponible: number;
    stock_reservado: number;
  }>(
    pool,
    `SELECT i.sabor_id, i.sucursal_id, s.nombre AS sucursal_nombre,
            i.stock_disponible, i.stock_reservado
     FROM inventario_sabor_sucursal i
     JOIN sucursales s ON s.id = i.sucursal_id
     WHERE i.sabor_id IN (${placeholders}) AND s.activo = 1
     ORDER BY i.sabor_id ASC, s.nombre ASC, s.id ASC`,
    ids,
  );

  const inventoryMap = new Map<number, typeof inventario>();
  for (const item of inventario) {
    const current = inventoryMap.get(Number(item.sabor_id)) ?? [];
    current.push(item);
    inventoryMap.set(Number(item.sabor_id), current);
  }

  res.json(
    sabores.map((sabor) => ({
      ...sabor,
      activo: Boolean(sabor.activo),
      inventario_sucursales: (inventoryMap.get(Number(sabor.id)) ?? []).map((item) => ({
        sucursal_id: Number(item.sucursal_id),
        sucursal_nombre: item.sucursal_nombre,
        stock_disponible: Number(item.stock_disponible ?? 0),
        stock_reservado: Number(item.stock_reservado ?? 0),
      })),
    })),
  );
});

router.post("/sabores", async (req, res) => {
  const inventarioSucursalSchema = z.object({
    sucursal_id: z.number().int().positive(),
    stock_disponible: z.number().int().min(0),
  });
  const schema = z.object({
    nombre: z.string().min(1).max(120),
    descripcion: z.string().max(300).optional().nullable(),
    activo: z.boolean().optional(),
    inventario_sucursales: z.array(inventarioSucursalSchema).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { insertId } = await qRun(
      conn,
      `INSERT INTO sabores (nombre, descripcion, activo)
       VALUES (?, ?, ?)`,
      [
        parsed.data.nombre.trim(),
        parsed.data.descripcion?.trim() || null,
        parsed.data.activo === false ? 0 : 1,
      ],
    );
    await initializeInventoryForFlavor(conn, { saborId: insertId });
    for (const item of parsed.data.inventario_sucursales ?? []) {
      await adjustFlavorStockBySucursal(conn, {
        saborId: insertId,
        sucursalId: item.sucursal_id,
        nuevoStockDisponible: item.stock_disponible,
        descripcion: "Stock inicial de sabor",
        creadoPor: req.user!.id,
      });
    }
    await conn.commit();
    emitRealtime(["productos", "inventario"]);
    res.status(201).json({ id: insertId });
  } catch (error: any) {
    await conn.rollback();
    if (error?.code === "ER_DUP_ENTRY") {
      res.status(409).json({ error: "Ya existe un sabor con ese nombre." });
      return;
    }
    throw error;
  } finally {
    conn.release();
  }
});

router.put("/sabores/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Sabor invalido." });
    return;
  }
  const inventarioSucursalSchema = z.object({
    sucursal_id: z.number().int().positive(),
    stock_disponible: z.number().int().min(0),
  });
  const schema = z.object({
    nombre: z.string().min(1).max(120),
    descripcion: z.string().max(300).optional().nullable(),
    activo: z.boolean().optional(),
    inventario_sucursales: z.array(inventarioSucursalSchema).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { affectedRows } = await qRun(
      conn,
      `UPDATE sabores
       SET nombre = ?, descripcion = ?, activo = ?
       WHERE id = ?`,
      [
        parsed.data.nombre.trim(),
        parsed.data.descripcion?.trim() || null,
        parsed.data.activo === false ? 0 : 1,
        id,
      ],
    );
    if (!affectedRows) {
      await conn.rollback();
      res.status(404).json({ error: "Sabor no encontrado." });
      return;
    }
    await initializeInventoryForFlavor(conn, { saborId: id });
    for (const item of parsed.data.inventario_sucursales ?? []) {
      await adjustFlavorStockBySucursal(conn, {
        saborId: id,
        sucursalId: item.sucursal_id,
        nuevoStockDisponible: item.stock_disponible,
        descripcion: "Ajuste de stock de sabor",
        creadoPor: req.user!.id,
      });
    }
    await conn.commit();
    emitRealtime(["productos", "inventario"]);
    res.json({ ok: true });
  } catch (error: any) {
    await conn.rollback();
    if (error?.code === "ER_DUP_ENTRY") {
      res.status(409).json({ error: "Ya existe un sabor con ese nombre." });
      return;
    }
    throw error;
  } finally {
    conn.release();
  }
});

router.patch("/sabores/:id/activo", async (req, res) => {
  const id = Number(req.params.id);
  const { activo } = req.body;
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Sabor invalido." });
    return;
  }
  if (typeof activo !== "boolean") {
    res.status(400).json({ error: "activo debe ser boolean" });
    return;
  }
  await qRun(pool, "UPDATE sabores SET activo = ? WHERE id = ?", [activo ? 1 : 0, id]);
  emitRealtime(["productos", "inventario"]);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════
//  PRODUCTOS (ABM completo)
// ════════════════════════════════════════════════════════

router.get("/productos", async (_req, res) => {
  const rows = await qAll<{
    id: number;
    nombre: string;
    sku: string | null;
    descripcion: string | null;
    imagen_url: string | null;
    imagen_mobile_url: string | null;
    categoria: string | null;
    tipo_producto: "canje" | "venta" | "mixto";
    configuracion_tipo: "simple" | "caja_sabores";
    capacidad_sabores: number | null;
    precio_dinero: number | null;
    precio_puntos: number | null;
    puntos_para_canjear: number | null;
    stock_disponible: number;
    stock_reservado: number;
    track_stock: number;
    permite_envio: number;
    envio_gratis: number;
    permite_retiro_local: number;
    puntos_requeridos: number;
    puntos_acumulables: number | null;
    puntaje_al_comprar: number | null;
    destacado_home: number;
    activo: number;
    created_at: string;
  }>(pool,
    `SELECT id, nombre, sku, descripcion, imagen_url, imagen_mobile_url, categoria, tipo_producto, configuracion_tipo, capacidad_sabores,
            precio_dinero, precio_puntos, puntos_para_canjear, stock_disponible, stock_reservado,
            track_stock, permite_envio, envio_gratis, permite_retiro_local,
            puntos_requeridos, puntos_acumulables, puntaje_al_comprar, destacado_home, activo, created_at
     FROM productos
     ORDER BY created_at DESC`
  );
  if (!rows.length) {
    res.json([]);
    return;
  }

  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => "?").join(", ");
  const imageRows = await qAll<{ producto_id: number; imagen_url: string; orden: number }>(
    pool,
    `SELECT producto_id, imagen_url, orden
     FROM producto_imagenes
     WHERE producto_id IN (${placeholders})
     ORDER BY producto_id ASC, orden ASC`,
    ids
  );

  const imageMap = new Map<number, string[]>();
  for (const image of imageRows) {
    const current = imageMap.get(image.producto_id) ?? [];
    current.push(image.imagen_url);
    imageMap.set(image.producto_id, current);
  }

  const flavorRows = await qAll<{ producto_id: number; sabor_id: number; nombre: string; orden: number }>(
    pool,
    `SELECT ps.producto_id, ps.sabor_id, s.nombre, ps.orden
     FROM producto_sabores ps
     JOIN sabores s ON s.id = ps.sabor_id
     WHERE ps.producto_id IN (${placeholders})
     ORDER BY ps.producto_id ASC, ps.orden ASC, s.nombre ASC`,
    ids
  );

  const flavorMap = new Map<number, Array<{ id: number; nombre: string }>>();
  for (const flavor of flavorRows) {
    const current = flavorMap.get(Number(flavor.producto_id)) ?? [];
    current.push({ id: Number(flavor.sabor_id), nombre: flavor.nombre });
    flavorMap.set(Number(flavor.producto_id), current);
  }

  res.json(
    rows.map((row) => {
      const imagenes = normalizeProductImages(imageMap.get(row.id), row.imagen_url);
      const sabores = flavorMap.get(Number(row.id)) ?? [];
      return {
        ...row,
        capacidad_sabores: row.capacidad_sabores === null ? null : Number(row.capacidad_sabores),
        activo: Boolean(row.activo),
        track_stock: Boolean(row.track_stock),
        permite_envio: Boolean(row.permite_envio),
        envio_gratis: Boolean(row.envio_gratis),
        permite_retiro_local: Boolean(row.permite_retiro_local),
        destacado_home: Boolean(row.destacado_home),
        sabor_ids: sabores.map((sabor) => sabor.id),
        sabores,
        imagenes,
        imagen_url: imagenes[0] ?? null,
      };
    })
  );
});

// POST /admin/productos/upload — recibe imagen y devuelve la URL pública
router.post("/productos/upload", (req, res, next) => {
  upload.single("imagen")(req, res, async (err) => {
    if (err) { res.status(400).json({ error: err.message }); return; }
    if (!req.file) { res.status(400).json({ error: "No se recibió ningún archivo" }); return; }

    const check = await verifyUploadedImageFile(req.file);
    if (!check.ok) {
      recordSecurityEvent("upload_bloqueado_firma_invalida", req, {
        mimeDeclarado: req.file.mimetype,
        mimeDetectado: check.detectedMime,
      });
      res.status(400).json({ error: check.errorMessage || "Archivo de imagen inválido" });
      return;
    }

    res.json({ url: `/uploads/${req.file.filename}` });
  });
});

router.post("/productos", async (req, res) => {
  const inventarioSucursalSchema = z.object({
    sucursal_id: z.number().int().positive(),
    stock_disponible: z.number().int().min(0),
  });
  const schema = z.object({
    nombre:             z.string().min(1).max(150),
    sku:                z.string().max(64).optional().nullable(),
    descripcion:        z.string().max(1000).optional().nullable(),
    imagen_url:         z.string().min(1).optional().nullable(),
    imagen_mobile_url:  z.string().min(1).optional().nullable(),
    imagenes:           z.array(z.string().min(1)).max(3).optional().nullable(),
    categoria:          z.string().max(100).optional().nullable(),
    tipo_producto:      z.enum(["canje", "venta", "mixto"]).optional(),
    configuracion_tipo: z.enum(["simple", "caja_sabores"]).optional(),
    capacidad_sabores:  z.number().int().positive().optional().nullable(),
    sabor_ids:          z.array(z.number().int().positive()).optional(),
    precio_dinero:      z.number().positive().optional().nullable(),
    precio_puntos:      z.number().int().positive().optional().nullable(),
    puntos_para_canjear: z.number().int().positive().optional().nullable(),
    puntos_requeridos:  z.number().int().min(0).optional().nullable(),
    puntos_acumulables: z.number().int().positive().optional().nullable(),
    puntaje_al_comprar: z.number().int().positive().optional().nullable(),
    destacado_home:     z.boolean().optional(),
    stock_disponible:   z.number().int().min(0).optional(),
    track_stock:        z.boolean().optional(),
    permite_envio:      z.boolean().optional(),
    envio_gratis:       z.boolean().optional(),
    permite_retiro_local: z.boolean().optional(),
    inventario_sucursales: z.array(inventarioSucursalSchema).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }
  const {
    nombre, sku, descripcion, imagen_url, imagen_mobile_url, imagenes, categoria,
    tipo_producto, configuracion_tipo, capacidad_sabores, sabor_ids,
    precio_dinero, precio_puntos, puntos_para_canjear, puntos_requeridos, puntos_acumulables, puntaje_al_comprar, destacado_home,
    stock_disponible, track_stock, permite_envio, envio_gratis, permite_retiro_local, inventario_sucursales,
  } = parsed.data;
  const configuracionTipo = configuracion_tipo ?? "simple";
  const isCajaSabores = configuracionTipo === "caja_sabores";
  const flavorIds = normalizeFlavorIds(sabor_ids);
  const capacidadSaboresFinal = isCajaSabores ? Number(capacidad_sabores ?? 0) : null;
  const inventarioPorSucursal = inventario_sucursales ?? [];
  const stockDisponibleFinal = inventarioPorSucursal.length
    ? inventarioPorSucursal.reduce((acc, item) => acc + item.stock_disponible, 0)
    : stock_disponible ?? 0;
  const imageUrls = normalizeProductImages(imagenes, imagen_url);
  const tipoProducto = tipo_producto ?? "canje";
  const precioPuntosFinal = puntos_para_canjear ?? precio_puntos ?? puntos_requeridos ?? null;
  const puntosRequeridosLegacy = precioPuntosFinal ?? 0;
  const precioDineroFinal = precio_dinero ?? null;
  const puntajeComprarFinal = null;
  const permiteEnvioFinal = Boolean(permite_envio);
  const envioGratisFinal = permiteEnvioFinal && Boolean(envio_gratis);

  if ((tipoProducto === "canje" || tipoProducto === "mixto") && (!precioPuntosFinal || precioPuntosFinal <= 0)) {
    res.status(400).json({ error: "Debes indicar un precio de puntos valido para canje/mixto." });
    return;
  }
  if ((tipoProducto === "venta" || tipoProducto === "mixto") && (!precioDineroFinal || precioDineroFinal <= 0)) {
    res.status(400).json({ error: "Debes indicar un precio en dinero valido para venta/mixto." });
    return;
  }
  if (isCajaSabores) {
    if (!capacidadSaboresFinal || capacidadSaboresFinal <= 0) {
      res.status(400).json({ error: "Indica cuantos alfajores trae la caja." });
      return;
    }
    if (!flavorIds.length) {
      res.status(400).json({ error: "Selecciona al menos un sabor disponible para esta caja." });
      return;
    }
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const trackStockFinal = isCajaSabores ? false : (track_stock === undefined ? true : track_stock);
    const productStockDisponible = isCajaSabores ? 0 : stockDisponibleFinal;

    const { insertId } = await qRun(conn,
      `INSERT INTO productos
        (nombre, sku, descripcion, imagen_url, imagen_mobile_url, categoria, tipo_producto, configuracion_tipo, capacidad_sabores,
         precio_dinero, precio_puntos, puntos_para_canjear, puntos_requeridos, puntos_acumulables, puntaje_al_comprar, destacado_home,
         stock_disponible, stock_reservado, track_stock, permite_envio, envio_gratis, permite_retiro_local)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      [
        nombre,
        sku?.trim() || null,
        descripcion ?? null,
        imageUrls[0] ?? null,
        imagen_mobile_url ?? null,
        categoria ?? null,
        tipoProducto,
        configuracionTipo,
        capacidadSaboresFinal,
        precioDineroFinal,
        precioPuntosFinal,
        precioPuntosFinal,
        puntosRequeridosLegacy,
        null,
        puntajeComprarFinal,
        destacado_home ? 1 : 0,
        productStockDisponible,
        trackStockFinal ? 1 : 0,
        permiteEnvioFinal ? 1 : 0,
        envioGratisFinal ? 1 : 0,
        permite_retiro_local === undefined ? 1 : (permite_retiro_local ? 1 : 0),
      ]
    );
    await replaceProductImages(conn, insertId, imageUrls);
    await replaceProductFlavors(conn, insertId, isCajaSabores ? flavorIds : []);
    await initializeInventoryForProduct(conn, {
      productoId: insertId,
      stockDisponibleInicial: isCajaSabores ? 0 : (inventarioPorSucursal.length ? 0 : stockDisponibleFinal),
    });
    if (trackStockFinal && inventarioPorSucursal.length) {
      for (const inventario of inventarioPorSucursal) {
        await adjustStockBySucursal(conn, {
          productoId: insertId,
          sucursalId: inventario.sucursal_id,
          nuevoStockDisponible: inventario.stock_disponible,
          descripcion: "Stock inicial por sucursal",
          creadoPor: req.user!.id,
        });
      }
    }

    await conn.commit();
    emitRealtime(["productos", "inventario", "categorias"]);
    res.status(201).json({ id: insertId });
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
});

router.put("/productos/:id", async (req, res) => {
  const id = Number(req.params.id);
  const inventarioSucursalSchema = z.object({
    sucursal_id: z.number().int().positive(),
    stock_disponible: z.number().int().min(0),
  });
  const schema = z.object({
    nombre:             z.string().min(1).max(150),
    sku:                z.string().max(64).optional().nullable(),
    descripcion:        z.string().max(1000).optional().nullable(),
    imagen_url:         z.string().min(1).optional().nullable(),
    imagen_mobile_url:  z.string().min(1).optional().nullable(),
    imagenes:           z.array(z.string().min(1)).max(3).optional().nullable(),
    categoria:          z.string().max(100).optional().nullable(),
    tipo_producto:      z.enum(["canje", "venta", "mixto"]).optional(),
    configuracion_tipo: z.enum(["simple", "caja_sabores"]).optional(),
    capacidad_sabores:  z.number().int().positive().optional().nullable(),
    sabor_ids:          z.array(z.number().int().positive()).optional(),
    precio_dinero:      z.number().positive().optional().nullable(),
    precio_puntos:      z.number().int().positive().optional().nullable(),
    puntos_para_canjear: z.number().int().positive().optional().nullable(),
    puntos_requeridos:  z.number().int().min(0).optional().nullable(),
    puntos_acumulables: z.number().int().positive().optional().nullable(),
    puntaje_al_comprar: z.number().int().positive().optional().nullable(),
    destacado_home:     z.boolean().optional(),
    stock_disponible:   z.number().int().min(0).optional(),
    track_stock:        z.boolean().optional(),
    permite_envio:      z.boolean().optional(),
    envio_gratis:       z.boolean().optional(),
    permite_retiro_local: z.boolean().optional(),
    inventario_sucursales: z.array(inventarioSucursalSchema).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }
  const {
    nombre, sku, descripcion, imagen_url, imagen_mobile_url, imagenes, categoria,
    tipo_producto, configuracion_tipo, capacidad_sabores, sabor_ids,
    precio_dinero, precio_puntos, puntos_para_canjear, puntos_requeridos, puntos_acumulables, puntaje_al_comprar, destacado_home,
    stock_disponible, track_stock, permite_envio, envio_gratis, permite_retiro_local, inventario_sucursales,
  } = parsed.data;
  const configuracionTipo = configuracion_tipo ?? "simple";
  const isCajaSabores = configuracionTipo === "caja_sabores";
  const flavorIds = normalizeFlavorIds(sabor_ids);
  const capacidadSaboresFinal = isCajaSabores ? Number(capacidad_sabores ?? 0) : null;
  const inventarioPorSucursal = inventario_sucursales ?? [];
  const imageUrls = normalizeProductImages(imagenes, imagen_url);
  const tipoProducto = tipo_producto ?? "canje";
  const precioPuntosFinal = puntos_para_canjear ?? precio_puntos ?? puntos_requeridos ?? null;
  const puntosRequeridosLegacy = precioPuntosFinal ?? 0;
  const precioDineroFinal = precio_dinero ?? null;
  const puntajeComprarFinal = null;
  const permiteEnvioFinal = Boolean(permite_envio);
  const envioGratisFinal = permiteEnvioFinal && Boolean(envio_gratis);

  if ((tipoProducto === "canje" || tipoProducto === "mixto") && (!precioPuntosFinal || precioPuntosFinal <= 0)) {
    res.status(400).json({ error: "Debes indicar un precio de puntos valido para canje/mixto." });
    return;
  }
  if ((tipoProducto === "venta" || tipoProducto === "mixto") && (!precioDineroFinal || precioDineroFinal <= 0)) {
    res.status(400).json({ error: "Debes indicar un precio en dinero valido para venta/mixto." });
    return;
  }
  if (isCajaSabores) {
    if (!capacidadSaboresFinal || capacidadSaboresFinal <= 0) {
      res.status(400).json({ error: "Indica cuantos alfajores trae la caja." });
      return;
    }
    if (!flavorIds.length) {
      res.status(400).json({ error: "Selecciona al menos un sabor disponible para esta caja." });
      return;
    }
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const current = await qOne<{ id: number; stock_disponible: number; track_stock: number }>(
      conn,
      "SELECT id, stock_disponible, track_stock FROM productos WHERE id = ? FOR UPDATE",
      [id],
    );
    if (!current) {
      await conn.rollback();
      res.status(404).json({ error: "Producto no encontrado" });
      return;
    }
    const stockDisponibleFinal = inventarioPorSucursal.length
      ? inventarioPorSucursal.reduce((acc, item) => acc + item.stock_disponible, 0)
      : stock_disponible ?? Number(current.stock_disponible ?? 0);
    const trackStockFinal = isCajaSabores ? false : (track_stock === undefined ? Number(current.track_stock ?? 1) === 1 : track_stock);
    const productStockDisponible = isCajaSabores ? 0 : stockDisponibleFinal;

    const { affectedRows } = await qRun(conn,
      `UPDATE productos
       SET nombre=?, sku=?, descripcion=?, imagen_url=?, imagen_mobile_url=?, categoria=?, tipo_producto=?, configuracion_tipo=?, capacidad_sabores=?,
           precio_dinero=?, precio_puntos=?, puntos_para_canjear=?, puntos_requeridos=?, puntos_acumulables=?, puntaje_al_comprar=?, destacado_home=?,
           stock_disponible=?, track_stock=?, permite_envio=?, envio_gratis=?, permite_retiro_local=?
       WHERE id=?`,
      [
        nombre,
        sku?.trim() || null,
        descripcion ?? null,
        imageUrls[0] ?? null,
        imagen_mobile_url ?? null,
        categoria ?? null,
        tipoProducto,
        configuracionTipo,
        capacidadSaboresFinal,
        precioDineroFinal,
        precioPuntosFinal,
        precioPuntosFinal,
        puntosRequeridosLegacy,
        null,
        puntajeComprarFinal,
        destacado_home ? 1 : 0,
        productStockDisponible,
        trackStockFinal ? 1 : 0,
        permiteEnvioFinal ? 1 : 0,
        envioGratisFinal ? 1 : 0,
        permite_retiro_local === undefined ? 1 : (permite_retiro_local ? 1 : 0),
        id,
      ]
    );
    if (affectedRows === 0) {
      await conn.rollback();
      res.status(404).json({ error: "Producto no encontrado" });
      return;
    }

    await replaceProductImages(conn, id, imageUrls);
    await replaceProductFlavors(conn, id, isCajaSabores ? flavorIds : []);
    if (trackStockFinal && inventarioPorSucursal.length) {
      for (const inventario of inventarioPorSucursal) {
        await adjustStockBySucursal(conn, {
          productoId: id,
          sucursalId: inventario.sucursal_id,
          nuevoStockDisponible: inventario.stock_disponible,
          descripcion: "Ajuste desde ficha de producto",
          creadoPor: req.user!.id,
        });
      }
    }
    await conn.commit();
    emitRealtime(["productos", "inventario", "categorias"]);
    res.json({ ok: true });
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
});

router.patch("/productos/:id/activo", async (req, res) => {
  const id = Number(req.params.id);
  const { activo } = req.body;
  if (typeof activo !== "boolean") { res.status(400).json({ error: "activo debe ser boolean" }); return; }
  await qRun(pool, "UPDATE productos SET activo = ? WHERE id = ?", [activo ? 1 : 0, id]);
  emitRealtime(["productos", "inventario"]);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════
//  CATEGORÍAS (ABM)
// ════════════════════════════════════════════════════════

const categoriaSchema = z.object({
  nombre: z.string().trim().min(1).max(100),
  descripcion: z.string().max(1000).optional().nullable(),
  imagen_url: z.string().optional().nullable(),
  orden: z.number().int().optional(),
  mostrar_en_home: z.boolean().optional(),
  activo: z.boolean().optional(),
});

router.get("/categorias", async (_req, res) => {
  const rows = await qAll(pool, "SELECT id, nombre, descripcion, imagen_url, orden, mostrar_en_home, activo, created_at, updated_at FROM categorias ORDER BY activo DESC, orden ASC, nombre ASC, id ASC");
  res.json(rows.map((row: any) => ({ ...row, activo: Boolean(row.activo), mostrar_en_home: Boolean(row.mostrar_en_home) })));
});

router.get("/descuentos-categorias", async (_req, res) => {
  const rows = await qAll(
    pool,
    `SELECT id, tipo_cliente, categoria, descuento_porcentaje, activo, created_at, updated_at
     FROM descuentos_tipo_categoria
     ORDER BY categoria ASC, tipo_cliente ASC, id ASC`,
  );
  res.json(rows);
});

router.put("/descuentos-categorias", async (req, res) => {
  const parsed = descuentoTipoCategoriaSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const categoria = parsed.data.categoria.trim();
  const descuento = Number(parsed.data.descuento_porcentaje ?? 0);
  await qRun(
    pool,
    `INSERT INTO descuentos_tipo_categoria (tipo_cliente, categoria, descuento_porcentaje, activo)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       descuento_porcentaje = VALUES(descuento_porcentaje),
       activo = VALUES(activo),
       updated_at = CURRENT_TIMESTAMP`,
    [parsed.data.tipo_cliente, categoria, descuento, parsed.data.activo ? 1 : 0],
  );
  emitRealtime(["admin-config", "productos"]);
  res.json({ ok: true });
});

router.get("/descuentos-productos", async (_req, res) => {
  const rows = await qAll(
    pool,
    `SELECT d.id, d.tipo_cliente, d.producto_id, p.nombre AS producto_nombre, p.categoria,
            d.descuento_porcentaje, d.activo, d.created_at, d.updated_at
     FROM descuentos_tipo_producto d
     INNER JOIN productos p ON p.id = d.producto_id
     ORDER BY p.nombre ASC, d.tipo_cliente ASC, d.id ASC`,
  );
  res.json(rows.map((row: any) => ({ ...row, activo: Boolean(row.activo) })));
});

router.put("/descuentos-productos", async (req, res) => {
  const parsed = descuentoTipoProductoSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const producto = await qOne<{ id: number }>(
    pool,
    "SELECT id FROM productos WHERE id = ? LIMIT 1",
    [parsed.data.producto_id],
  );
  if (!producto) {
    res.status(404).json({ error: "Producto no encontrado." });
    return;
  }

  const descuento = Number(parsed.data.descuento_porcentaje ?? 0);
  await qRun(
    pool,
    `INSERT INTO descuentos_tipo_producto (tipo_cliente, producto_id, descuento_porcentaje, activo)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       descuento_porcentaje = VALUES(descuento_porcentaje),
       activo = VALUES(activo),
       updated_at = CURRENT_TIMESTAMP`,
    [parsed.data.tipo_cliente, parsed.data.producto_id, descuento, parsed.data.activo ? 1 : 0],
  );
  emitRealtime(["admin-config", "productos"]);
  res.json({ ok: true });
});

router.post("/categorias", async (req, res) => {
  const parsed = categoriaSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }

  try {
    const { insertId } = await qRun(
      pool,
      "INSERT INTO categorias (nombre, descripcion, imagen_url, orden, mostrar_en_home, activo) VALUES (?, ?, ?, ?, ?, ?)",
      [
        parsed.data.nombre.trim(),
        parsed.data.descripcion?.trim() || null,
        parsed.data.imagen_url?.trim() || null,
        parsed.data.orden ?? 0,
        parsed.data.mostrar_en_home ? 1 : 0,
        parsed.data.activo === false ? 0 : 1,
      ],
    );
    emitRealtime(["categorias", "productos"]);
    res.status(201).json({ id: insertId });
  } catch (err: any) {
    if (err.code === "ER_DUP_ENTRY") { res.status(409).json({ error: "Ya existe una categoría con ese nombre" }); return; }
    throw err;
  }
});

router.put("/categorias/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Categoria invalida." });
    return;
  }
  const parsed = categoriaSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }

  const nombre = parsed.data.nombre.trim();
  const descripcion = parsed.data.descripcion?.trim() || null;
  const imagen_url = parsed.data.imagen_url?.trim() || null;
  const orden = parsed.data.orden ?? 0;
  const mostrar_en_home = parsed.data.mostrar_en_home ? 1 : 0;
  const activo = parsed.data.activo === false ? 0 : 1;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const current = await qOne<{ nombre: string }>(
      conn,
      "SELECT nombre FROM categorias WHERE id = ? LIMIT 1",
      [id],
    );
    if (!current) {
      await conn.rollback();
      res.status(404).json({ error: "Categoria no encontrada" });
      return;
    }
    await qRun(
      conn,
      "UPDATE categorias SET nombre = ?, descripcion = ?, imagen_url = ?, orden = ?, mostrar_en_home = ?, activo = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [nombre, descripcion, imagen_url, orden, mostrar_en_home, activo, id],
    );
    if (current.nombre !== nombre) {
      await qRun(conn, "UPDATE productos SET categoria = ? WHERE categoria = ?", [nombre, current.nombre]);
      await qRun(
        conn,
        "UPDATE descuentos_tipo_categoria SET categoria = ?, updated_at = CURRENT_TIMESTAMP WHERE categoria = ?",
        [nombre, current.nombre],
      );
    }
    await conn.commit();
    emitRealtime(["categorias", "productos", "admin-config"]);
    res.json({ ok: true });
  } catch (err: any) {
    await conn.rollback();
    if (err.code === "ER_DUP_ENTRY") { res.status(409).json({ error: "Ya existe otra categoría con ese nombre" }); return; }
    throw err;
  } finally {
    conn.release();
  }
});


// ════════════════════════════════════════════════════════
//  CONFIGURACIÓN
// ════════════════════════════════════════════════════════

router.patch("/categorias/:id/activo", async (req, res) => {
  const id = Number(req.params.id);
  const { activo } = req.body ?? {};
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Categoria invalida." });
    return;
  }
  if (typeof activo !== "boolean") {
    res.status(400).json({ error: "activo debe ser boolean" });
    return;
  }
  const result = await qRun(pool, "UPDATE categorias SET activo = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [activo ? 1 : 0, id]);
  if (!result.affectedRows) {
    res.status(404).json({ error: "Categoria no encontrada." });
    return;
  }
  emitRealtime(["categorias", "productos", "admin-config"]);
  res.json({ ok: true });
});

router.get("/sucursales", async (_req, res) => {
  const rows = await qAll(
    pool,
    `SELECT id, nombre, direccion, piso, localidad, provincia, activo, created_at, updated_at
     FROM sucursales
     ORDER BY activo DESC, nombre ASC, id ASC`,
  );
  res.json(rows);
});

router.post("/sucursales", async (req, res) => {
  const parsed = sucursalSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }
  const { nombre, direccion, piso, localidad, provincia } = parsed.data;
  const { insertId } = await qRun(
    pool,
    `INSERT INTO sucursales (nombre, direccion, piso, localidad, provincia, activo)
     VALUES (?, ?, ?, ?, ?, 1)`,
    [nombre.trim(), direccion.trim(), piso?.trim() || null, localidad.trim(), provincia.trim()],
  );
  emitRealtime(["sucursales", "productos"]);
  res.status(201).json({ id: insertId });
});

router.put("/sucursales/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "ID de sucursal invalido" });
    return;
  }
  const parsed = sucursalSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const { nombre, direccion, piso, localidad, provincia } = parsed.data;
  const { affectedRows } = await qRun(
    pool,
    `UPDATE sucursales
     SET nombre = ?, direccion = ?, piso = ?, localidad = ?, provincia = ?
     WHERE id = ?`,
    [nombre.trim(), direccion.trim(), piso?.trim() || null, localidad.trim(), provincia.trim(), id],
  );
  if (affectedRows === 0) {
    res.status(404).json({ error: "Sucursal no encontrada" });
    return;
  }
  emitRealtime(["sucursales", "productos"]);
  res.json({ ok: true });
});

router.patch("/sucursales/:id/activo", async (req, res) => {
  const id = Number(req.params.id);
  const { activo } = req.body;
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "ID de sucursal invalido" });
    return;
  }
  if (typeof activo !== "boolean") {
    res.status(400).json({ error: "activo debe ser boolean" });
    return;
  }

  if (!activo) {
    const totalActivas = await qOne<{ c: number }>(
      pool,
      "SELECT COUNT(*) AS c FROM sucursales WHERE activo = 1 AND id <> ?",
      [id],
    );
    if (Number(totalActivas?.c ?? 0) <= 0) {
      res.status(400).json({ error: "Debe quedar al menos una sucursal activa." });
      return;
    }
  }

  const { affectedRows } = await qRun(pool, "UPDATE sucursales SET activo = ? WHERE id = ?", [activo ? 1 : 0, id]);
  if (affectedRows === 0) {
    res.status(404).json({ error: "Sucursal no encontrada" });
    return;
  }
  emitRealtime(["sucursales", "productos"]);
  res.json({ ok: true });
});

router.get("/envio-zonas", async (_req, res) => {
  const zones = await listShippingZones(true);
  res.json(zones);
});

router.post("/envio-zonas", async (req, res) => {
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
    throw err;
  }
});

router.put("/envio-zonas/:id", async (req, res) => {
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
    throw err;
  }
});

router.patch("/envio-zonas/:id/activo", async (req, res) => {
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
    throw err;
  }
});

router.get("/inventario", async (req, res) => {
  const productoId = Number(req.query.producto_id ?? 0);
  const sucursalId = Number(req.query.sucursal_id ?? 0);

  const conditions: string[] = [];
  const params: number[] = [];
  if (Number.isFinite(productoId) && productoId > 0) {
    conditions.push("i.producto_id = ?");
    params.push(productoId);
  }
  if (Number.isFinite(sucursalId) && sucursalId > 0) {
    conditions.push("i.sucursal_id = ?");
    params.push(sucursalId);
  }
  const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = await qAll(
    pool,
    `SELECT i.id, i.producto_id, p.nombre AS producto_nombre, p.sku, p.tipo_producto,
            i.sucursal_id, s.nombre AS sucursal_nombre,
            i.stock_disponible, i.stock_reservado, i.updated_at
     FROM inventario_sucursal i
     JOIN productos p ON p.id = i.producto_id
     JOIN sucursales s ON s.id = i.sucursal_id
     ${whereSql}
     ORDER BY p.nombre ASC, s.nombre ASC`,
    params,
  );
  res.json(rows);
});

router.get("/movimientos-stock", async (req, res) => {
  const productoId = Number(req.query.producto_id ?? 0);
  const sucursalId = Number(req.query.sucursal_id ?? 0);
  const ordenId = Number(req.query.orden_id ?? 0);

  const conditions: string[] = [];
  const params: number[] = [];
  if (Number.isFinite(productoId) && productoId > 0) {
    conditions.push("m.producto_id = ?");
    params.push(productoId);
  }
  if (Number.isFinite(sucursalId) && sucursalId > 0) {
    conditions.push("m.sucursal_id = ?");
    params.push(sucursalId);
  }
  if (Number.isFinite(ordenId) && ordenId > 0) {
    conditions.push("m.orden_id = ?");
    params.push(ordenId);
  }
  const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = await qAll(
    pool,
    `SELECT m.id, m.producto_id, p.nombre AS producto_nombre, p.sku,
            m.sucursal_id, s.nombre AS sucursal_nombre, m.orden_id,
            m.tipo, m.origen, m.cantidad, m.descripcion,
            m.creado_por, u.nombre AS creado_por_nombre, m.created_at
     FROM movimientos_stock m
     JOIN productos p ON p.id = m.producto_id
     LEFT JOIN sucursales s ON s.id = m.sucursal_id
     LEFT JOIN usuarios u ON u.id = m.creado_por
     ${whereSql}
     ORDER BY m.created_at DESC, m.id DESC
     LIMIT 500`,
    params,
  );
  res.json(rows);
});

router.post("/reservas/expirar", async (_req, res) => {
  try {
    const result = await runReservationExpirations();
    res.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudieron expirar las reservas";
    console.error("Expirar reservas vencidas:", message);
    res.status(500).json({ error: "No se pudieron expirar las reservas vencidas en este momento." });
  }
});

router.patch("/inventario/ajuste", async (req, res) => {
  const schema = z.object({
    producto_id: z.number().int().positive(),
    sucursal_id: z.number().int().positive(),
    nuevo_stock_disponible: z.number().int().min(0),
    descripcion: z.string().max(255).optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const { producto_id, sucursal_id, nuevo_stock_disponible, descripcion } = parsed.data;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await adjustStockBySucursal(conn, {
      productoId: producto_id,
      sucursalId: sucursal_id,
      nuevoStockDisponible: nuevo_stock_disponible,
      descripcion: descripcion ?? null,
      creadoPor: req.user!.id,
    });
    await conn.commit();
    res.json({ ok: true });
  } catch (err: any) {
    await conn.rollback();
    res.status(400).json({ error: err?.message || "No se pudo ajustar el inventario." });
  } finally {
    conn.release();
  }
});

router.get("/configuracion", async (_req, res) => {
  const rows = await qAll(pool, "SELECT clave, valor, descripcion FROM configuracion");
  res.json(rows);
});

router.put("/configuracion/:clave", async (req, res) => {
  const { clave } = req.params;
  const { valor, descripcion } = req.body;
  if (valor === undefined || valor === null) { res.status(400).json({ error: "valor requerido" }); return; }
  await qRun(
    pool,
    `INSERT INTO configuracion (clave, valor, descripcion)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       valor = VALUES(valor),
       descripcion = COALESCE(NULLIF(VALUES(descripcion), ''), configuracion.descripcion)`,
    [clave, String(valor), typeof descripcion === "string" ? descripcion : null]
  );
  emitRealtime(["admin-config"]);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════
//  PÁGINAS DE CONTENIDO (Sobre Nosotros, Términos, etc.)
// ════════════════════════════════════════════════════════

router.get("/paginas", async (_req, res) => {
  const rows = await qAll(pool, "SELECT slug, titulo, updated_at FROM paginas_contenido");
  res.json(rows);
});

router.get("/paginas/:slug", async (req, res) => {
  const page = await qOne(pool,
    "SELECT slug, titulo, contenido, updated_at FROM paginas_contenido WHERE slug = ?",
    [req.params.slug]
  );
  if (!page) { res.status(404).json({ error: "Página no encontrada" }); return; }
  res.json(page);
});

router.put("/paginas/:slug", async (req, res) => {
  const schema = z.object({
    titulo:    z.string().min(1).max(200),
    contenido: z.string().min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }

  const { titulo, contenido } = parsed.data;
  const { affectedRows } = await qRun(pool,
    "UPDATE paginas_contenido SET titulo = ?, contenido = ? WHERE slug = ?",
    [titulo, contenido, req.params.slug]
  );
  if (affectedRows === 0) { res.status(404).json({ error: "Página no encontrada" }); return; }
  emitRealtime(["paginas"]);
  res.json({ ok: true });
});

/**
 * POST /admin/puntos/reconciliar-saldos
 * Recalcula puntos_saldo de uno o todos los usuarios desde movimientos_puntos.
 * Cuerpo opcional: { usuario_id: number } para reparar solo un usuario.
 * Sin cuerpo: repara todos los usuarios que tengan movimientos.
 */
router.post("/puntos/reconciliar-saldos", requireAuth, requireRole("admin"), async (req, res) => {
  const usuarioIdRaw = req.body?.usuario_id;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (usuarioIdRaw !== undefined) {
      // Reparar solo un usuario
      const usuarioId = Number(usuarioIdRaw);
      if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
        await conn.rollback();
        res.status(400).json({ error: "usuario_id inválido" });
        return;
      }
      const saldo = await recalcularSaldoPuntosUsuario(conn, usuarioId);
      await conn.commit();
      res.json({ ok: true, usuario_id: usuarioId, saldo_recalculado: saldo });
      return;
    }

    // Reparar todos los usuarios con lotes o saldo registrado
    const usuarios = await qAll<{ usuario_id: number }>(
      conn,
      `SELECT id AS usuario_id
       FROM usuarios
       WHERE rol = 'cliente'
          OR puntos_saldo <> 0
          OR EXISTS (SELECT 1 FROM puntos_lotes pl WHERE pl.usuario_id = usuarios.id)`,
    );

    const resultados: Array<{ usuario_id: number; saldo_anterior: number; saldo_nuevo: number }> = [];
    for (const row of usuarios) {
      const usuarioId = Number(row.usuario_id);
      const actual = await qOne<{ puntos_saldo: number }>(
        conn,
        "SELECT puntos_saldo FROM usuarios WHERE id = ?",
        [usuarioId],
      );
      const saldoAnterior = Number(actual?.puntos_saldo ?? 0);
      const saldoCalculado = await recalcularSaldoPuntosUsuario(conn, usuarioId);
      if (saldoAnterior !== saldoCalculado) {
        resultados.push({ usuario_id: usuarioId, saldo_anterior: saldoAnterior, saldo_nuevo: saldoCalculado });
        console.info(`[reconciliar-saldos] Usuario #${usuarioId}: ${saldoAnterior} → ${saldoCalculado} pts`);
      }
    }

    await conn.commit();
    res.json({ ok: true, usuarios_reparados: resultados.length, detalle: resultados });
  } catch (err: any) {
    await conn.rollback();
    console.error("[reconciliar-saldos] Error:", err);
    res.status(500).json({ error: err?.message || "Error al reconciliar saldos" });
  } finally {
    conn.release();
  }
});

// ════════════════════════════════════════════════════════
//  LAYOUT Y DISEÑO
// ════════════════════════════════════════════════════════

router.get("/layout/timeline", async (_req, res) => {
  const rows = await qAll(pool, "SELECT * FROM layout_timeline_eventos ORDER BY orden ASC");
  res.json(rows);
});

router.post("/layout/timeline", async (req, res) => {
  const schema = z.object({
    badge_text:  z.string().nullable(),
    titulo:      z.string().min(1).max(255),
    descripcion: z.string().nullable(),
    imagen_url:  z.string().nullable(),
    orden:       z.number().int(),
    activo:      z.union([z.boolean(), z.number()]).default(true),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }

  const { badge_text, titulo, descripcion, imagen_url, orden, activo } = parsed.data;
  
  const { insertId } = await qRun(pool,
    `INSERT INTO layout_timeline_eventos (badge_text, titulo, descripcion, imagen_url, orden, activo)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [badge_text, titulo, descripcion, imagen_url, orden, activo ? 1 : 0]
  );
  res.json({ ok: true, id: insertId });
});

router.put("/layout/timeline/:id", async (req, res) => {
  const schema = z.object({
    badge_text:  z.string().nullable(),
    titulo:      z.string().min(1).max(255),
    descripcion: z.string().nullable(),
    imagen_url:  z.string().nullable(),
    orden:       z.number().int(),
    activo:      z.union([z.boolean(), z.number()]),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }

  const { badge_text, titulo, descripcion, imagen_url, orden, activo } = parsed.data;

  const { affectedRows } = await qRun(pool,
    `UPDATE layout_timeline_eventos
     SET badge_text = ?, titulo = ?, descripcion = ?, imagen_url = ?, orden = ?, activo = ?
     WHERE id = ?`,
    [badge_text, titulo, descripcion, imagen_url, orden, activo ? 1 : 0, req.params.id]
  );
  if (affectedRows === 0) { res.status(404).json({ error: "Evento no encontrado" }); return; }
  res.json({ ok: true });
});

router.delete("/layout/timeline/:id", async (req, res) => {
  const { affectedRows } = await qRun(pool, "DELETE FROM layout_timeline_eventos WHERE id = ?", [req.params.id]);
  if (affectedRows === 0) { res.status(404).json({ error: "Evento no encontrado" }); return; }
  res.json({ ok: true });
});

export default router;
