"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = __importDefault(require("crypto"));
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../db");
const auth_1 = require("../auth");
const realtime_1 = require("../realtime");
const stock_1 = require("../services/stock");
const orderLifecycle_1 = require("../services/orderLifecycle");
const points_1 = require("../services/points");
const customerPricing_1 = require("../services/customerPricing");
const paymentFees_1 = require("../services/paymentFees");
const email_1 = require("../services/email");
const paymentProviders_1 = require("../services/paymentProviders");
const purchaseLimits_1 = require("../services/purchaseLimits");
const userAddresses_1 = require("../services/userAddresses");
const shippingZones_1 = require("../services/shippingZones");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth, (0, auth_1.requireRole)("cliente"));
function getPrecioDineroConResolver(producto, resolvePrice) {
    return resolvePrice({ precio_dinero: producto.precio_dinero, categoria: producto.categoria }).precioFinal;
}
class HttpError extends Error {
    status;
    errorCode;
    constructor(status, message, errorCode) {
        super(message);
        this.status = status;
        this.errorCode = errorCode;
    }
}
const DEFAULT_INVITE_CODE_LENGTH = 9;
const MIN_INVITE_CODE_LENGTH = 6;
const MAX_INVITE_CODE_LENGTH = 20;
const REDEEM_CODE_LENGTH = 9;
const REDEEM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MINIMUM_ALLOWED_AGE_YEARS = 13;
const FREE_SHIPPING_MINIMUM_CONFIG_KEY = "envio_gratis_monto_minimo";
function makeRedeemCode(length = REDEEM_CODE_LENGTH) {
    return Array.from({ length }, () => REDEEM_CODE_CHARS[crypto_1.default.randomInt(REDEEM_CODE_CHARS.length)]).join("");
}
async function uniqueRedeemCode(conn, length = REDEEM_CODE_LENGTH) {
    for (let attempt = 0; attempt < 25; attempt += 1) {
        const code = makeRedeemCode(length);
        const exists = await (0, db_1.qOne)(conn, "SELECT id FROM canjes WHERE codigo_retiro = ? LIMIT 1", [code]);
        if (!exists)
            return code;
    }
    throw new Error("No se pudo generar un codigo de canje unico");
}
function profileMissingFields(perfil) {
    if (!perfil)
        return ["nombre", "email", "dni", "telefono"];
    const missing = [];
    if (!perfil.nombre || !perfil.nombre.trim())
        missing.push("nombre");
    if (!perfil.email || !perfil.email.includes("@"))
        missing.push("email");
    if (!perfil.dni || perfil.dni.trim().length < 6)
        missing.push("dni");
    if (!perfil.telefono || perfil.telefono.replace(/\D/g, "").length < 6)
        missing.push("telefono");
    if (!perfil.fecha_nacimiento)
        missing.push("fecha nacimiento");
    if (!perfil.localidad || !perfil.localidad.trim())
        missing.push("localidad");
    if (!perfil.provincia || !perfil.provincia.trim())
        missing.push("provincia");
    return missing;
}
function parseBirthDate(raw) {
    const text = (raw || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text))
        return null;
    const dt = new Date(`${text}T00:00:00.000Z`);
    if (Number.isNaN(dt.getTime()))
        return null;
    const [y, m, d] = text.split("-").map((x) => Number(x));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() + 1 !== m || dt.getUTCDate() !== d)
        return null;
    return dt;
}
function isAtLeastAge(date, minYears) {
    const today = new Date();
    const limit = new Date(Date.UTC(today.getUTCFullYear() - minYears, today.getUTCMonth(), today.getUTCDate()));
    return date.getTime() <= limit.getTime();
}
async function validateProfileForCheckout(usuarioId) {
    const perfil = await (0, db_1.qOne)(db_1.pool, "SELECT id, nombre, email, dni, telefono, fecha_nacimiento, localidad, provincia FROM usuarios WHERE id = ?", [usuarioId]);
    return profileMissingFields(perfil);
}
async function getReferralPointsConfig(conn) {
    const cfg = await (0, db_1.qOne)(conn, `SELECT
       MAX(CASE WHEN clave = 'puntos_referido_invitador' THEN CAST(valor AS UNSIGNED) END) AS inv,
       MAX(CASE WHEN clave = 'puntos_referido_invitado' THEN CAST(valor AS UNSIGNED) END) AS nuev
     FROM configuracion
     WHERE clave IN ('puntos_referido_invitador', 'puntos_referido_invitado')`);
    return {
        pointsInvitador: Number(cfg?.inv ?? 50),
        pointsInvitado: Number(cfg?.nuev ?? 30),
    };
}
async function getInviteCodeLength(conn = db_1.pool) {
    const row = await (0, db_1.qOne)(conn, "SELECT valor FROM configuracion WHERE clave = 'longitud_codigo_invitacion' LIMIT 1");
    const parsed = Number(row?.valor ?? DEFAULT_INVITE_CODE_LENGTH);
    if (!Number.isInteger(parsed))
        return DEFAULT_INVITE_CODE_LENGTH;
    return Math.max(MIN_INVITE_CODE_LENGTH, Math.min(MAX_INVITE_CODE_LENGTH, parsed));
}
function assertWithinPurchaseLimit(cantidad, limit) {
    if ((0, purchaseLimits_1.isWithinPurchaseQuantityLimit)(cantidad, limit))
        return;
    throw new HttpError(400, `El limite para tu perfil es ${limit} unidades por producto.`);
}
function isValidInviteCode(code, length) {
    return new RegExp(`^[A-Z0-9]{${length}}$`).test(code);
}
function normalizeCanjeItems(items) {
    const grouped = new Map();
    for (const item of items) {
        const productoId = Number(item.producto_id);
        const cantidad = Number(item.cantidad);
        if (!Number.isInteger(productoId) || productoId <= 0)
            continue;
        if (!Number.isInteger(cantidad) || cantidad <= 0)
            continue;
        grouped.set(productoId, (grouped.get(productoId) ?? 0) + cantidad);
    }
    return Array.from(grouped.entries()).map(([producto_id, cantidad]) => ({ producto_id, cantidad }));
}
function buildLugarRetiro(sucursal) {
    return `${sucursal.nombre} - ${sucursal.direccion}${sucursal.piso ? `, Piso ${sucursal.piso}` : ""}, ${sucursal.localidad}, ${sucursal.provincia}`;
}
function toMoney(n) {
    return Number((Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2));
}
function allShippedItemsHaveFreeShipping(items) {
    return items.length > 0 && items.every((item) => item.envio_gratis === true || Number(item.envio_gratis ?? 0) === 1);
}
async function getFreeShippingMinimum(conn = db_1.pool) {
    const row = await (0, db_1.qOne)(conn, "SELECT valor FROM configuracion WHERE clave = ? LIMIT 1", [FREE_SHIPPING_MINIMUM_CONFIG_KEY]);
    const parsed = Number(row?.valor ?? 0);
    return Number.isFinite(parsed) && parsed > 0 ? toMoney(parsed) : 0;
}
function buildFreeShippingDecision(items, subtotalDineroProductos, montoMinimo) {
    if (allShippedItemsHaveFreeShipping(items)) {
        return { aplica: true, motivo: "productos", montoMinimo };
    }
    if (montoMinimo > 0 && subtotalDineroProductos >= montoMinimo) {
        return { aplica: true, motivo: "monto_minimo", montoMinimo };
    }
    return { aplica: false, motivo: null, montoMinimo };
}
function applyFreeShippingToQuote(quote, decision) {
    if (!decision.aplica) {
        return {
            ...quote,
            envio_gratis: false,
            envio_gratis_monto_minimo: decision.montoMinimo > 0 ? decision.montoMinimo : null,
        };
    }
    return {
        ...quote,
        costo_envio: 0,
        costo_envio_original: quote.costo_envio,
        envio_gratis: true,
        envio_gratis_motivo: decision.motivo,
        envio_gratis_monto_minimo: decision.montoMinimo > 0 ? decision.montoMinimo : null,
    };
}
function toDateOnly(value) {
    if (!value)
        return null;
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime()))
            return null;
        return value.toISOString().slice(0, 10);
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed)
            return null;
        const match = trimmed.match(/^\d{4}-\d{2}-\d{2}/);
        return match ? match[0] : null;
    }
    return null;
}
function normalizeClienteUserRow(row) {
    if (!row)
        return row;
    return {
        ...row,
        fecha_nacimiento: toDateOnly(row.fecha_nacimiento),
    };
}
function firstNonEmptyString(...values) {
    for (const value of values) {
        if (typeof value === "string" && value.trim())
            return value.trim();
        if (typeof value === "number" && Number.isFinite(value))
            return String(value);
    }
    return null;
}
function parseOrderIdFromReference(reference) {
    if (!reference)
        return null;
    const direct = Number(reference);
    if (Number.isInteger(direct) && direct > 0)
        return direct;
    const match = reference.match(/(?:orden|order|pedido)[_-]?(\d+)/i);
    if (!match)
        return null;
    const parsed = Number(match[1]);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
function normalizeMercadoPagoStatus(status) {
    const normalized = (status || "").trim().toLowerCase();
    if (["approved", "aprobado", "paid", "pagada", "success", "succeeded"].includes(normalized))
        return "approved";
    if (["expired", "expirada", "vencida"].includes(normalized))
        return "expired";
    if (["rejected", "rechazado", "failed", "failure", "cancelled", "canceled", "cancelada"].includes(normalized)) {
        return "rejected";
    }
    return null;
}
async function ensureActiveCart(conn, usuarioId) {
    const existing = await (0, db_1.qOne)(conn, `SELECT id
     FROM carritos
     WHERE usuario_id = ? AND estado = 'activo'
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`, [usuarioId]);
    if (existing?.id)
        return Number(existing.id);
    const created = await (0, db_1.qRun)(conn, "INSERT INTO carritos (usuario_id, estado) VALUES (?, 'activo')", [usuarioId]);
    return Number(created.insertId);
}
async function getActiveCartId(conn, usuarioId) {
    const existing = await (0, db_1.qOne)(conn, `SELECT id
     FROM carritos
     WHERE usuario_id = ? AND estado = 'activo'
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`, [usuarioId]);
    return existing?.id ? Number(existing.id) : null;
}
async function getProductoForCart(conn, productoId) {
    const producto = await (0, db_1.qOne)(conn, `SELECT id, nombre, categoria, activo, tipo_producto, configuracion_tipo, capacidad_sabores, precio_dinero,
            COALESCE(puntos_para_canjear, precio_puntos, puntos_requeridos) AS precio_puntos_effectivo,
            track_stock, imagen_url, puntaje_al_comprar
     FROM productos
     WHERE id = ?
     LIMIT 1`, [productoId]);
    if (!producto)
        throw new HttpError(404, "Producto no encontrado.");
    return {
        ...producto,
        activo: Number(producto.activo ?? 0),
        configuracion_tipo: producto.configuracion_tipo ?? "simple",
        capacidad_sabores: producto.capacidad_sabores === null ? null : Number(producto.capacidad_sabores),
        precio_dinero: producto.precio_dinero === null ? null : Number(producto.precio_dinero),
        precio_puntos_effectivo: producto.precio_puntos_effectivo === null ? null : Number(producto.precio_puntos_effectivo),
        track_stock: Number(producto.track_stock ?? 0),
        puntaje_al_comprar: producto.puntaje_al_comprar === null ? null : Number(producto.puntaje_al_comprar),
    };
}
function validateProductoForMode(producto, modoCompra) {
    if (!producto.activo)
        throw new HttpError(400, `El producto ${producto.nombre} no está activo.`);
    if (modoCompra === "puntos") {
        if (!(producto.tipo_producto === "canje" || producto.tipo_producto === "mixto")) {
            throw new HttpError(400, `El producto ${producto.nombre} no se puede canjear por puntos.`);
        }
        if (!producto.precio_puntos_effectivo || producto.precio_puntos_effectivo <= 0) {
            throw new HttpError(400, `El producto ${producto.nombre} no tiene precio de puntos válido.`);
        }
    }
    if (modoCompra === "dinero") {
        if (!(producto.tipo_producto === "venta" || producto.tipo_producto === "mixto")) {
            throw new HttpError(400, `El producto ${producto.nombre} no se puede comprar online.`);
        }
        if (!producto.precio_dinero || producto.precio_dinero <= 0) {
            throw new HttpError(400, `El producto ${producto.nombre} no tiene precio en dinero válido.`);
        }
    }
}
function normalizeFlavorSelection(items) {
    const grouped = new Map();
    for (const item of items ?? []) {
        const saborId = Number(item.sabor_id);
        const cantidad = Number(item.cantidad);
        if (!Number.isInteger(saborId) || saborId <= 0)
            continue;
        if (!Number.isInteger(cantidad) || cantidad <= 0)
            continue;
        grouped.set(saborId, (grouped.get(saborId) ?? 0) + cantidad);
    }
    return Array.from(grouped.entries())
        .map(([sabor_id, cantidad]) => ({ sabor_id, cantidad }))
        .sort((a, b) => a.sabor_id - b.sabor_id);
}
function buildFlavorConfigHash(productoId, sabores) {
    if (!sabores.length)
        return "";
    const signature = sabores.map((item) => `${item.sabor_id}:${item.cantidad}`).join("|");
    return crypto_1.default.createHash("sha256").update(`${productoId}|${signature}`).digest("hex");
}
async function validateFlavorSelectionForProduct(conn, { producto, sabores, cantidadCajas, sucursalId, }) {
    const isCajaSabores = producto.configuracion_tipo === "caja_sabores";
    if (!isCajaSabores) {
        if (sabores.length) {
            throw new HttpError(400, "Este producto no permite seleccion de sabores.");
        }
        return [];
    }
    const capacidad = Number(producto.capacidad_sabores ?? 0);
    if (!capacidad || capacidad <= 0) {
        throw new HttpError(400, `La caja ${producto.nombre} no tiene capacidad configurada.`);
    }
    const totalSeleccionado = sabores.reduce((acc, item) => acc + item.cantidad, 0);
    if (totalSeleccionado !== capacidad) {
        throw new HttpError(400, `Selecciona exactamente ${capacidad} sabores para ${producto.nombre}.`);
    }
    const sucursalSeleccionada = await resolveSucursalSeleccionada(conn, sucursalId ?? null);
    if (!sucursalSeleccionada) {
        throw new HttpError(400, "Selecciona una sucursal para validar stock de sabores.");
    }
    const allowedRows = await (0, db_1.qAll)(conn, `SELECT s.id, s.nombre, s.activo,
            COALESCE(i.stock_disponible, 0) AS stock_disponible
     FROM producto_sabores ps
     JOIN sabores s ON s.id = ps.sabor_id
     LEFT JOIN inventario_sabor_sucursal i ON i.sabor_id = s.id AND i.sucursal_id = ?
     WHERE ps.producto_id = ? AND ps.activo = 1
     ORDER BY ps.orden ASC, s.nombre ASC`, [sucursalSeleccionada.id, producto.id]);
    const allowed = new Map(allowedRows.map((row) => [Number(row.id), row]));
    const detalles = [];
    for (const item of sabores) {
        const row = allowed.get(item.sabor_id);
        if (!row || Number(row.activo ?? 0) !== 1) {
            throw new HttpError(400, "Uno de los sabores elegidos no esta disponible para esta caja.");
        }
        const needed = item.cantidad * cantidadCajas;
        const available = Number(row.stock_disponible ?? 0);
        if (available < needed) {
            throw new HttpError(400, available > 0
                ? `Solo hay ${available} unidades disponibles del sabor ${row.nombre} en la sucursal seleccionada.`
                : `No hay stock disponible del sabor ${row.nombre} en la sucursal seleccionada.`);
        }
        detalles.push({
            sabor_id: Number(row.id),
            nombre: row.nombre,
            cantidad: needed,
        });
    }
    return detalles;
}
async function assertCartQuantityWithinStock(conn, { producto, cantidad, sucursalId, }) {
    if (!producto.track_stock)
        return;
    const sucursalSeleccionada = await resolveSucursalSeleccionada(conn, sucursalId ?? null);
    if (!sucursalSeleccionada) {
        throw new HttpError(400, "Selecciona una sucursal para validar stock.");
    }
    const inv = await (0, db_1.qOne)(conn, `SELECT stock_disponible
     FROM inventario_sucursal
     WHERE producto_id = ? AND sucursal_id = ?
     LIMIT 1`, [producto.id, sucursalSeleccionada.id]);
    const disponible = Number(inv?.stock_disponible ?? 0);
    if (disponible < cantidad) {
        throw new HttpError(400, disponible > 0
            ? `Solo hay ${disponible} unidades disponibles de ${producto.nombre} en la sucursal seleccionada.`
            : `No hay stock disponible de ${producto.nombre} en la sucursal seleccionada.`);
    }
}
async function getCarritoItems(conn, usuarioId) {
    const rows = await (0, db_1.qAll)(conn, `SELECT ci.id, ci.carrito_id, ci.producto_id, ci.cantidad, ci.modo_compra, ci.config_hash,
            ci.precio_dinero_unit, ci.precio_puntos_unit, ci.puntaje_al_comprar_unitario, ci.subtotal_dinero, ci.subtotal_puntos,
            p.nombre, p.tipo_producto, p.configuracion_tipo, p.capacidad_sabores, p.imagen_url, p.track_stock, p.permite_envio, p.envio_gratis
     FROM carrito_items ci
     JOIN carritos c ON c.id = ci.carrito_id
     JOIN productos p ON p.id = ci.producto_id
     WHERE c.usuario_id = ? AND c.estado = 'activo'
     ORDER BY ci.created_at ASC, ci.id ASC`, [usuarioId]);
    const flavorMap = new Map();
    if (rows.length) {
        const ids = rows.map((row) => Number(row.id));
        const placeholders = ids.map(() => "?").join(", ");
        const flavorRows = await (0, db_1.qAll)(conn, `SELECT carrito_item_id, sabor_id, sabor_nombre, cantidad
       FROM carrito_item_sabores
       WHERE carrito_item_id IN (${placeholders})
       ORDER BY carrito_item_id ASC, id ASC`, ids);
        for (const flavor of flavorRows) {
            const current = flavorMap.get(Number(flavor.carrito_item_id)) ?? [];
            current.push({
                sabor_id: Number(flavor.sabor_id),
                nombre: flavor.sabor_nombre,
                cantidad: Number(flavor.cantidad),
            });
            flavorMap.set(Number(flavor.carrito_item_id), current);
        }
    }
    return rows.map((row) => ({
        ...row,
        id: Number(row.id),
        carrito_id: Number(row.carrito_id),
        producto_id: Number(row.producto_id),
        cantidad: Number(row.cantidad),
        config_hash: row.config_hash ?? "",
        precio_dinero_unit: row.precio_dinero_unit === null ? null : Number(row.precio_dinero_unit),
        precio_puntos_unit: row.precio_puntos_unit === null ? null : Number(row.precio_puntos_unit),
        puntaje_al_comprar_unitario: row.puntaje_al_comprar_unitario === null ? null : Number(row.puntaje_al_comprar_unitario),
        subtotal_dinero: Number(row.subtotal_dinero),
        subtotal_puntos: Number(row.subtotal_puntos),
        configuracion_tipo: row.configuracion_tipo ?? "simple",
        capacidad_sabores: row.capacidad_sabores === null ? null : Number(row.capacidad_sabores),
        track_stock: Number(row.track_stock ?? 0),
        permite_envio: Number(row.permite_envio ?? 0),
        envio_gratis: Number(row.permite_envio ?? 0) === 1 ? Number(row.envio_gratis ?? 0) : 0,
        sabores: flavorMap.get(Number(row.id)) ?? [],
    }));
}
const shippingAddressSchema = zod_1.z.object({
    nombre: zod_1.z.string().min(2).max(120),
    telefono: zod_1.z.string().min(6).max(40),
    direccion: zod_1.z.string().min(5).max(180),
    codigo_postal: zod_1.z.string().min(3).max(20),
    localidad: zod_1.z.string().min(2).max(120),
    provincia: zod_1.z.string().min(2).max(120),
    referencias: zod_1.z.string().max(300).optional().nullable(),
});
function normalizeShippingAddress(raw) {
    return {
        nombre: raw.nombre.trim(),
        telefono: raw.telefono.trim(),
        direccion: raw.direccion.trim(),
        codigo_postal: raw.codigo_postal.trim(),
        localidad: raw.localidad.trim(),
        provincia: raw.provincia.trim(),
        referencias: raw.referencias?.trim() || null,
    };
}
async function resolveCheckoutShippingAddress(conn, usuarioId, addressId, rawAddress) {
    if (addressId) {
        const address = await (0, userAddresses_1.getUserAddress)(conn, usuarioId, addressId);
        if (!address) {
            throw new HttpError(404, "Direccion de envio no encontrada.");
        }
        return (0, userAddresses_1.buildAddressSnapshot)(address);
    }
    return rawAddress ? normalizeShippingAddress(rawAddress) : null;
}
async function resolveCheckoutShippingQuote(conn, address) {
    const lat = Number(address.lat);
    const lng = Number(address.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new HttpError(400, "La direccion de envio no tiene coordenadas validas.");
    }
    const quote = await (0, shippingZones_1.quoteShippingForCoordinates)(conn, lat, lng);
    if (!quote.disponible || !quote.zona) {
        throw new HttpError(400, quote.error || "La direccion seleccionada no esta dentro de una zona de envio activa.");
    }
    return quote;
}
function buildShippingAddressOrderSnapshot(address, quote) {
    const quoteSnapshot = (0, shippingZones_1.buildShippingQuoteSnapshot)(quote);
    return {
        ...address,
        costo_envio: quote.costo_envio,
        envio: quoteSnapshot,
    };
}
function parseJsonField(value) {
    if (!value)
        return null;
    if (typeof value === "object")
        return value;
    if (typeof value !== "string")
        return null;
    try {
        return JSON.parse(value);
    }
    catch {
        return null;
    }
}
async function getOrdenItems(conn, ordenId) {
    const rows = await (0, db_1.qAll)(conn, `SELECT oi.id, oi.orden_id, oi.producto_id, oi.cantidad, oi.modo_compra, oi.config_hash,
            oi.precio_dinero_unit, oi.precio_puntos_unit, oi.subtotal_dinero, oi.subtotal_puntos,
            oi.puntaje_al_comprar_unitario,
            p.nombre, p.imagen_url, p.track_stock
     FROM orden_items oi
     JOIN productos p ON p.id = oi.producto_id
     WHERE oi.orden_id = ?
     ORDER BY oi.id ASC`, [ordenId]);
    const flavorMap = new Map();
    if (rows.length) {
        const ids = rows.map((row) => Number(row.id));
        const placeholders = ids.map(() => "?").join(", ");
        const flavorRows = await (0, db_1.qAll)(conn, `SELECT orden_item_id, sabor_id, sabor_nombre, cantidad
       FROM orden_item_sabores
       WHERE orden_item_id IN (${placeholders})
       ORDER BY orden_item_id ASC, id ASC`, ids);
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
    return rows.map((row) => ({
        ...row,
        id: Number(row.id),
        orden_id: Number(row.orden_id),
        producto_id: Number(row.producto_id),
        cantidad: Number(row.cantidad),
        config_hash: row.config_hash ?? "",
        precio_dinero_unit: row.precio_dinero_unit === null ? null : Number(row.precio_dinero_unit),
        precio_puntos_unit: row.precio_puntos_unit === null ? null : Number(row.precio_puntos_unit),
        subtotal_dinero: Number(row.subtotal_dinero),
        subtotal_puntos: Number(row.subtotal_puntos),
        puntaje_al_comprar_unitario: row.puntaje_al_comprar_unitario === null ? null : Number(row.puntaje_al_comprar_unitario),
        track_stock: Number(row.track_stock ?? 0),
        sabores: flavorMap.get(Number(row.id)) ?? [],
    }));
}
async function getOrderReceiptConfig(conn = db_1.pool) {
    const rows = await (0, db_1.qAll)(conn, `SELECT clave, valor
     FROM configuracion
     WHERE clave IN (
       'pedido_comprobante_leyenda',
       'empresa_dias_habiles_retiro',
       'empresa_horario_retiro',
       'pedido_efectivo_dias_vigencia'
     )`);
    const values = new Map(rows.map((row) => [row.clave, row.valor]));
    const parsedCashDays = Number(values.get("pedido_efectivo_dias_vigencia") ?? 3);
    return {
        disclaimer: (values.get("pedido_comprobante_leyenda") || "Este documento no es valido como factura.").trim(),
        businessDays: (values.get("empresa_dias_habiles_retiro") || "Lunes a viernes").trim(),
        businessHours: (values.get("empresa_horario_retiro") || "08:00 a 18:00").trim(),
        cashOrderValidityDays: Number.isInteger(parsedCashDays) && parsedCashDays > 0 ? parsedCashDays : 3,
    };
}
function addDaysIso(value, days) {
    const base = new Date(value);
    if (Number.isNaN(base.getTime()))
        return null;
    const next = new Date(base.getTime());
    next.setUTCDate(next.getUTCDate() + Math.max(1, days));
    return next.toISOString();
}
function buildOrderReceiptMeta(order, pago, config) {
    const isCashOrder = pago?.metodo === "cash";
    const direccionEnvio = parseJsonField(order.direccion_envio_json ?? null);
    const isShippingOrder = Boolean(direccionEnvio) &&
        typeof direccionEnvio === "object" &&
        direccionEnvio.metodo_entrega === "envio";
    return {
        leyenda_no_factura: config.disclaimer,
        dias_habiles: config.businessDays,
        horario_habil: config.businessHours,
        dias_vigencia_efectivo: isCashOrder ? config.cashOrderValidityDays : null,
        fecha_limite_efectivo: isCashOrder ? addDaysIso(order.created_at, config.cashOrderValidityDays) : null,
        retiro_en_sucursal: Boolean(order.sucursal_retiro_id) && !isShippingOrder,
    };
}
function queueOrderReceiptEmail(orderId) {
    void (0, email_1.sendOrderReceiptEmail)(orderId).catch((err) => {
        console.error(`[MAIL] Error enviando comprobante orden #${orderId}:`, err instanceof Error ? err.message : err);
    });
}
async function resolveSucursalSeleccionada(conn, sucursalId) {
    const sucursalesActivas = await (0, db_1.qAll)(conn, `SELECT id, nombre, direccion, piso, localidad, provincia
     FROM sucursales
     WHERE activo = 1
     ORDER BY nombre ASC, id ASC`);
    if (!sucursalesActivas.length)
        return null;
    if (sucursalId && Number.isFinite(sucursalId)) {
        const selected = sucursalesActivas.find((s) => Number(s.id) === Number(sucursalId));
        if (!selected) {
            throw new HttpError(400, "La sucursal seleccionada no está disponible.");
        }
        return selected;
    }
    if (sucursalesActivas.length === 1)
        return sucursalesActivas[0];
    return null;
}
async function getCanjeItemsByCanjeIds(conn, canjeIds) {
    const map = new Map();
    if (!canjeIds.length)
        return map;
    const placeholders = canjeIds.map(() => "?").join(", ");
    const rows = await (0, db_1.qAll)(conn, `SELECT ci.canje_id, ci.producto_id, p.nombre AS producto_nombre, p.imagen_url AS producto_imagen,
            ci.cantidad, ci.puntos_unitarios, ci.puntos_total
     FROM canje_items ci
     JOIN productos p ON p.id = ci.producto_id
     WHERE ci.canje_id IN (${placeholders})
     ORDER BY ci.canje_id ASC, ci.id ASC`, canjeIds);
    for (const row of rows) {
        const current = map.get(row.canje_id) ?? [];
        current.push({
            producto_id: Number(row.producto_id),
            producto_nombre: row.producto_nombre,
            producto_imagen: row.producto_imagen ?? null,
            cantidad: Number(row.cantidad),
            puntos_unitarios: Number(row.puntos_unitarios),
            puntos_total: Number(row.puntos_total),
        });
        map.set(row.canje_id, current);
    }
    return map;
}
async function crearCanjeCarrito(conn, { usuarioId, items, sucursalId, }) {
    const itemsNormalizados = normalizeCanjeItems(items);
    if (!itemsNormalizados.length) {
        throw new HttpError(400, "Debes agregar al menos un producto al carrito.");
    }
    const pricingProfile = await (0, customerPricing_1.getActiveClientePricingProfile)(conn, usuarioId);
    const purchaseLimit = await (0, purchaseLimits_1.getPurchaseQuantityLimit)(conn, pricingProfile?.tipoCliente ?? "cliente");
    for (const item of itemsNormalizados) {
        assertWithinPurchaseLimit(item.cantidad, purchaseLimit);
    }
    const productoIds = itemsNormalizados.map((item) => item.producto_id);
    const placeholders = productoIds.map(() => "?").join(", ");
    const productos = await (0, db_1.qAll)(conn, `SELECT id, nombre, COALESCE(puntos_para_canjear, precio_puntos, puntos_requeridos) AS precio_puntos_effectivo, imagen_url
     FROM productos
     WHERE activo = 1
       AND tipo_producto IN ('canje', 'mixto')
       AND id IN (${placeholders})`, productoIds);
    const productosMap = new Map();
    for (const producto of productos) {
        productosMap.set(Number(producto.id), {
            id: Number(producto.id),
            nombre: producto.nombre,
            precio_puntos_effectivo: Number(producto.precio_puntos_effectivo),
            imagen_url: producto.imagen_url ?? null,
        });
    }
    const faltantes = productoIds.filter((id) => !productosMap.has(id));
    if (faltantes.length > 0) {
        throw new HttpError(400, "Algunos productos del carrito no existen o estan inactivos.");
    }
    const itemsDetalle = [];
    let puntosTotales = 0;
    for (const item of itemsNormalizados) {
        const producto = productosMap.get(item.producto_id);
        if (!producto) {
            throw new HttpError(400, "No se pudo validar el carrito de canje.");
        }
        const puntosUnitarios = Number(producto.precio_puntos_effectivo);
        if (!Number.isFinite(puntosUnitarios) || puntosUnitarios <= 0) {
            throw new HttpError(400, `El producto ${producto.nombre} no tiene precio de canje configurado.`);
        }
        const puntosTotal = puntosUnitarios * item.cantidad;
        puntosTotales += puntosTotal;
        itemsDetalle.push({
            producto_id: item.producto_id,
            producto_nombre: producto.nombre,
            producto_imagen: producto.imagen_url ?? null,
            cantidad: item.cantidad,
            puntos_unitarios: puntosUnitarios,
            puntos_total: puntosTotal,
        });
    }
    if (puntosTotales <= 0) {
        throw new HttpError(400, "El carrito no tiene productos validos para canjear.");
    }
    await (0, points_1.recalcularSaldoPuntosUsuario)(conn, usuarioId);
    const usuario = await (0, db_1.qOne)(conn, "SELECT puntos_saldo FROM usuarios WHERE id = ? FOR UPDATE", [usuarioId]);
    const saldo = Number(usuario?.puntos_saldo ?? 0);
    if (saldo < puntosTotales) {
        throw new HttpError(400, `Puntos insuficientes. Tenes ${saldo}, necesitas ${puntosTotales}`);
    }
    const diasRow = await (0, db_1.qOne)(conn, "SELECT valor FROM configuracion WHERE clave = 'dias_limite_retiro'");
    const dias = Number.parseInt(diasRow?.valor ?? "7", 10);
    const diasLimite = Number.isFinite(dias) && dias > 0 ? dias : 7;
    const sucursalesActivas = await (0, db_1.qAll)(conn, `SELECT id, nombre, direccion, piso, localidad, provincia
     FROM sucursales
     WHERE activo = 1
     ORDER BY nombre ASC, id ASC`);
    if (sucursalesActivas.length === 0) {
        throw new HttpError(400, "No hay sucursales de retiro disponibles. Contacta a la administracion.");
    }
    let sucursalSeleccionada;
    if (sucursalId && Number.isFinite(sucursalId)) {
        sucursalSeleccionada = sucursalesActivas.find((item) => item.id === Number(sucursalId));
        if (!sucursalSeleccionada) {
            throw new HttpError(400, "La sucursal seleccionada no esta disponible.");
        }
    }
    else if (sucursalesActivas.length === 1) {
        sucursalSeleccionada = sucursalesActivas[0];
    }
    else {
        throw new HttpError(400, "Debes seleccionar una sucursal para retirar el producto.");
    }
    const fechaLimite = new Date();
    fechaLimite.setDate(fechaLimite.getDate() + diasLimite);
    const codigoRetiro = await uniqueRedeemCode(conn);
    const productoPrincipalId = itemsDetalle[0].producto_id;
    const { insertId: canjeId } = await (0, db_1.qRun)(conn, `INSERT INTO canjes (usuario_id, producto_id, sucursal_id, codigo_retiro, puntos_usados, estado, fecha_limite_retiro)
     VALUES (?, ?, ?, ?, ?, 'pendiente', ?)`, [usuarioId, productoPrincipalId, sucursalSeleccionada.id, codigoRetiro, puntosTotales, fechaLimite]);
    for (const item of itemsDetalle) {
        await (0, db_1.qRun)(conn, `INSERT INTO canje_items (canje_id, producto_id, cantidad, puntos_unitarios, puntos_total)
       VALUES (?, ?, ?, ?, ?)`, [canjeId, item.producto_id, item.cantidad, item.puntos_unitarios, item.puntos_total]);
    }
    try {
        await (0, stock_1.reserveStockForCanje)(conn, {
            sucursalId: sucursalSeleccionada.id,
            items: itemsDetalle.map((item) => ({ producto_id: item.producto_id, cantidad: item.cantidad })),
            canjeId,
        });
    }
    catch (error) {
        const rawMessage = error instanceof Error ? error.message : "No se pudo reservar stock para el canje.";
        const message = rawMessage.toLowerCase().includes("stock insuficiente")
            ? "No hay stock suficiente en la sucursal seleccionada para completar el canje."
            : rawMessage;
        throw new HttpError(400, message);
    }
    const descripcionItems = itemsDetalle.map((item) => `${item.producto_nombre} x${item.cantidad}`).join(", ");
    const descripcionMovimiento = descripcionItems.length > 210 ? `Canje carrito: ${descripcionItems.slice(0, 207)}...` : `Canje carrito: ${descripcionItems}`;
    await (0, points_1.registrarMovimientoPuntos)(conn, {
        usuarioId,
        tipo: 'canje_producto',
        puntos: -puntosTotales,
        descripcion: descripcionMovimiento,
        referenciaId: canjeId,
        referenciaTipo: 'canjes'
    });
    const totalUnidades = itemsDetalle.reduce((acc, item) => acc + item.cantidad, 0);
    return {
        ok: true,
        canje_id: canjeId,
        canje_codigo: codigoRetiro,
        codigo_retiro: codigoRetiro,
        puntos_usados: puntosTotales,
        nuevo_saldo: saldo - puntosTotales,
        dias_limite_retiro: diasLimite,
        fecha_limite_retiro: fechaLimite,
        sucursal_id: sucursalSeleccionada.id,
        sucursal: sucursalSeleccionada,
        lugar_retiro: buildLugarRetiro(sucursalSeleccionada),
        total_items: itemsDetalle.length,
        total_unidades: totalUnidades,
        items: itemsDetalle,
    };
}
router.get("/me", async (req, res) => {
    const usuarioId = req.user.id;
    // Recalcular saldo antes de devolver los datos (Option A)
    try {
        const conn = await db_1.pool.getConnection();
        try {
            const saldoCalculado = await (0, points_1.recalcularSaldoPuntosUsuario)(conn, usuarioId);
            const actualEnDB = await (0, db_1.qOne)(conn, "SELECT puntos_saldo FROM usuarios WHERE id = ?", [usuarioId]);
            console.log(`[CLIENTE/ME] Recalculo de puntos`, {
                usuario_id: usuarioId,
                saldo_en_usuarios: actualEnDB?.puntos_saldo,
                saldo_calculado_por_movimientos: saldoCalculado,
                iguales: actualEnDB?.puntos_saldo === saldoCalculado
            });
        }
        finally {
            conn.release();
        }
    }
    catch (err) {
        console.error(`[CLIENTE/ME] Error recalculando saldo:`, err);
    }
    const user = await (0, db_1.qOne)(db_1.pool, "SELECT id, nombre, email, dni, telefono, fecha_nacimiento, localidad, provincia, puntos_saldo, codigo_invitacion, referido_por FROM usuarios WHERE id = ?", [usuarioId]);
    res.json(normalizeClienteUserRow(user));
});
router.patch("/perfil", async (req, res) => {
    const schema = zod_1.z.object({
        nombre: zod_1.z.string().min(1).max(100).optional(),
        dni: zod_1.z.string().regex(/^\d{6,15}$/, "El DNI debe contener solo numeros (6 a 15 digitos)").optional(),
        telefono: zod_1.z.string().regex(/^[0-9+\-()\s]{7,25}$/, "Telefono invalido").optional(),
        fecha_nacimiento: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha_nacimiento debe tener formato YYYY-MM-DD").optional(),
        localidad: zod_1.z.string().min(2).max(120).optional(),
        provincia: zod_1.z.string().min(2).max(120).optional(),
    }).refine((value) => value.nombre !== undefined ||
        value.dni !== undefined ||
        value.telefono !== undefined ||
        value.fecha_nacimiento !== undefined ||
        value.localidad !== undefined ||
        value.provincia !== undefined, {
        message: "Debes enviar al menos un campo para actualizar",
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0].message });
        return;
    }
    const { nombre, dni, telefono, fecha_nacimiento, localidad, provincia } = parsed.data;
    const usuarioId = req.user.id;
    if (fecha_nacimiento !== undefined) {
        const birthDate = parseBirthDate(fecha_nacimiento);
        if (!birthDate || !isAtLeastAge(birthDate, MINIMUM_ALLOWED_AGE_YEARS)) {
            res.status(400).json({ error: `Debes tener al menos ${MINIMUM_ALLOWED_AGE_YEARS} años.` });
            return;
        }
    }
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        const current = await (0, db_1.qOne)(conn, "SELECT id, rol FROM usuarios WHERE id = ? FOR UPDATE", [usuarioId]);
        if (!current) {
            await conn.rollback();
            res.status(404).json({ error: "Usuario no encontrado" });
            return;
        }
        if (dni !== undefined && current.rol !== "cliente") {
            await conn.rollback();
            res.status(400).json({ error: "Solo los clientes pueden actualizar DNI" });
            return;
        }
        if (dni !== undefined) {
            const dniDup = await (0, db_1.qOne)(conn, "SELECT id FROM usuarios WHERE dni = ? AND id <> ? LIMIT 1", [dni, usuarioId]);
            if (dniDup) {
                await conn.rollback();
                res.status(409).json({ error: "El DNI ya esta en uso por otro usuario" });
                return;
            }
        }
        await (0, db_1.qRun)(conn, `UPDATE usuarios
       SET nombre = COALESCE(?, nombre),
           dni = COALESCE(?, dni),
           telefono = COALESCE(?, telefono),
           fecha_nacimiento = COALESCE(?, fecha_nacimiento),
           localidad = COALESCE(?, localidad),
           provincia = COALESCE(?, provincia)
        WHERE id = ?`, [
            nombre ?? null,
            dni ?? null,
            telefono ?? null,
            fecha_nacimiento ?? null,
            localidad ?? null,
            provincia ?? null,
            usuarioId
        ]);
        // Recalcular saldo antes de devolver los datos actualizados
        await (0, points_1.recalcularSaldoPuntosUsuario)(conn, usuarioId);
        const updated = await (0, db_1.qOne)(conn, "SELECT id, nombre, email, rol, dni, telefono, fecha_nacimiento, localidad, provincia, puntos_saldo, codigo_invitacion, referido_por FROM usuarios WHERE id = ?", [usuarioId]);
        await conn.commit();
        res.json({ ok: true, user: normalizeClienteUserRow(updated) });
    }
    catch (err) {
        await conn.rollback();
        throw err;
    }
    finally {
        conn.release();
    }
});
router.post("/usar-codigo-invitacion", async (req, res) => {
    const schema = zod_1.z.object({ codigo: zod_1.z.string().min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: "Codigo de invitacion requerido" });
        return;
    }
    const usuarioId = req.user.id;
    const codigo = parsed.data.codigo.trim().toUpperCase();
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        const longitudCodigo = await getInviteCodeLength(conn);
        if (!isValidInviteCode(codigo, longitudCodigo)) {
            await conn.rollback();
            res.status(400).json({ error: `El codigo de invitacion debe tener ${longitudCodigo} caracteres alfanumericos` });
            return;
        }
        const usuario = await (0, db_1.qOne)(conn, "SELECT id, nombre, referido_por, codigo_invitacion FROM usuarios WHERE id = ? FOR UPDATE", [usuarioId]);
        if (!usuario) {
            await conn.rollback();
            res.status(404).json({ error: "Usuario no encontrado" });
            return;
        }
        if (usuario.referido_por) {
            await conn.rollback();
            res.status(400).json({ error: "Ya usaste un codigo de invitacion anteriormente" });
            return;
        }
        if (usuario.codigo_invitacion && usuario.codigo_invitacion.toUpperCase() === codigo) {
            await conn.rollback();
            res.status(400).json({ error: "No puedes usar tu propio codigo de invitacion" });
            return;
        }
        const invitador = await (0, db_1.qOne)(conn, `SELECT id, nombre
       FROM usuarios
       WHERE codigo_invitacion = ? AND rol = 'cliente' AND activo = 1
       LIMIT 1
       FOR UPDATE`, [codigo]);
        if (!invitador) {
            await conn.rollback();
            res.status(404).json({ error: "Codigo de invitacion invalido" });
            return;
        }
        if (invitador.id === usuarioId) {
            await conn.rollback();
            res.status(400).json({ error: "No puedes usar tu propio codigo de invitacion" });
            return;
        }
        const relationExists = await (0, db_1.qOne)(conn, "SELECT id FROM referidos WHERE invitado_id = ? LIMIT 1", [usuarioId]);
        if (relationExists) {
            await conn.rollback();
            res.status(400).json({ error: "Ya usaste un codigo de invitacion anteriormente" });
            return;
        }
        const { pointsInvitador, pointsInvitado } = await getReferralPointsConfig(conn);
        const { insertId: refId } = await (0, db_1.qRun)(conn, `INSERT INTO referidos (invitador_id, invitado_id, puntos_invitador, puntos_invitado)
       VALUES (?, ?, ?, ?)`, [invitador.id, usuarioId, pointsInvitador, pointsInvitado]);
        const updateRef = await (0, db_1.qRun)(conn, "UPDATE usuarios SET referido_por = ? WHERE id = ? AND referido_por IS NULL", [invitador.id, usuarioId]);
        if (updateRef.affectedRows === 0) {
            await conn.rollback();
            res.status(400).json({ error: "Ya usaste un codigo de invitacion anteriormente" });
            return;
        }
        await (0, points_1.registrarMovimientoPuntos)(conn, {
            usuarioId: Number(invitador.id),
            tipo: 'referido_invitador',
            puntos: pointsInvitador,
            descripcion: `${usuario.nombre || "Un cliente"} uso tu codigo de invitacion`,
            referenciaId: Number(refId),
            referenciaTipo: 'referidos'
        });
        await (0, points_1.registrarMovimientoPuntos)(conn, {
            usuarioId: usuarioId,
            tipo: 'referido_invitado',
            puntos: pointsInvitado,
            descripcion: `Bono por usar el codigo de ${invitador.nombre}`,
            referenciaId: Number(refId),
            referenciaTipo: 'referidos'
        });
        await conn.commit();
        const updated = await (0, db_1.qOne)(db_1.pool, "SELECT puntos_saldo FROM usuarios WHERE id = ?", [usuarioId]);
        res.json({
            ok: true,
            invitador: invitador.nombre,
            puntos_ganados: pointsInvitado,
            nuevo_saldo: updated?.puntos_saldo ?? 0,
        });
    }
    catch (err) {
        await conn.rollback();
        const dbErr = err;
        if (dbErr.code === "ER_DUP_ENTRY") {
            res.status(400).json({ error: "Ya usaste un codigo de invitacion anteriormente" });
            return;
        }
        throw err;
    }
    finally {
        conn.release();
    }
});
router.get("/mi-codigo", async (req, res) => {
    const user = await (0, db_1.qOne)(db_1.pool, "SELECT codigo_invitacion FROM usuarios WHERE id = ?", [req.user.id]);
    const total = await (0, db_1.qOne)(db_1.pool, "SELECT COUNT(*) AS c FROM referidos WHERE invitador_id = ?", [req.user.id]);
    res.json({ codigo: user?.codigo_invitacion, total_invitados: total?.c ?? 0 });
});
router.get("/puntos/proximos-vencer", async (req, res) => {
    const summary = await (0, points_1.getUpcomingPointExpirations)(db_1.pool, req.user.id);
    res.json({
        ventana_dias: summary.windowDays,
        ventana_valor: summary.windowValue,
        ventana_unidad: summary.windowUnit,
        total_puntos: summary.totalPoints,
        proximo_vencimiento: summary.nextExpirationAt,
        lotes: summary.items.map((item) => ({
            expires_at: item.expiresAt,
            puntos: item.puntos,
        })),
    });
});
router.get("/movimientos", async (req, res) => {
    const rows = await (0, db_1.qAll)(db_1.pool, `SELECT mp.id,
            CASE
              WHEN mp.tipo = 'ajuste' AND mp.referencia_tipo = 'ordenes_cancelacion'
                THEN 'cancelacion_compra'
              ELSE mp.tipo
            END AS tipo,
            mp.puntos,
            CASE
              WHEN mp.tipo = 'ajuste' AND mp.referencia_tipo = 'ordenes_cancelacion'
                THEN COALESCE(NULLIF(mp.descripcion, ''), CONCAT('Anulacion de puntos por cancelacion de compra #', mp.referencia_id))
              ELSE mp.descripcion
            END AS descripcion,
            mp.referencia_tipo,
            mp.created_at
     FROM movimientos_puntos mp
     WHERE mp.usuario_id = ?
       AND NOT (
         mp.tipo = 'acreditacion_compra'
         AND mp.referencia_tipo = 'ordenes'
         AND EXISTS (
           SELECT 1
           FROM movimientos_puntos cancelacion
           WHERE cancelacion.usuario_id = mp.usuario_id
             AND cancelacion.referencia_tipo = 'ordenes_cancelacion'
             AND cancelacion.referencia_id = mp.referencia_id
             AND cancelacion.tipo = 'ajuste'
         )
       )
     ORDER BY mp.created_at DESC LIMIT 100`, [req.user.id]);
    res.json(rows);
});
router.get("/canjes", async (req, res) => {
    const rows = await (0, db_1.qAll)(db_1.pool, `SELECT c.id, c.codigo_retiro, c.puntos_usados, c.estado, c.fecha_limite_retiro, c.notas, c.created_at,
            p.nombre AS producto_nombre, p.imagen_url AS producto_imagen,
            s.id AS sucursal_id, s.nombre AS sucursal_nombre, s.direccion AS sucursal_direccion,
            s.piso AS sucursal_piso, s.localidad AS sucursal_localidad, s.provincia AS sucursal_provincia
     FROM canjes c
     JOIN productos p ON p.id = c.producto_id
     LEFT JOIN sucursales s ON s.id = c.sucursal_id
     WHERE c.usuario_id = ? ORDER BY c.created_at DESC`, [req.user.id]);
    if (!rows.length) {
        res.json([]);
        return;
    }
    const itemsMap = await getCanjeItemsByCanjeIds(db_1.pool, rows.map((row) => Number(row.id)));
    const payload = rows.map((row) => {
        const fallbackItem = {
            producto_id: 0,
            producto_nombre: row.producto_nombre,
            producto_imagen: row.producto_imagen ?? null,
            cantidad: 1,
            puntos_unitarios: Number(row.puntos_usados),
            puntos_total: Number(row.puntos_usados),
        };
        const items = itemsMap.get(Number(row.id)) ?? [fallbackItem];
        const totalUnidades = items.reduce((acc, item) => acc + Number(item.cantidad), 0);
        const productosDetalle = items.map((item) => `${item.producto_nombre} x${item.cantidad}`).join(" | ");
        const primerItem = items[0];
        const productoNombreVista = items.length > 1 ? `${primerItem.producto_nombre} +${items.length - 1} mas` : primerItem.producto_nombre;
        return {
            ...row,
            producto_nombre: productoNombreVista,
            producto_imagen: primerItem.producto_imagen ?? row.producto_imagen ?? null,
            items,
            total_items: items.length,
            total_unidades: totalUnidades,
            productos_detalle: productosDetalle,
        };
    });
    res.json(payload);
});
router.get("/canjes/:id", async (req, res) => {
    const canjeId = Number(req.params.id);
    if (!Number.isFinite(canjeId) || canjeId <= 0) {
        res.status(400).json({ error: "ID de canje inválido." });
        return;
    }
    const row = await (0, db_1.qOne)(db_1.pool, `SELECT c.id, c.codigo_retiro, c.puntos_usados, c.estado, c.fecha_limite_retiro, c.notas, c.created_at,
            p.nombre AS producto_nombre, p.imagen_url AS producto_imagen,
            s.id AS sucursal_id, s.nombre AS sucursal_nombre, s.direccion AS sucursal_direccion,
            s.piso AS sucursal_piso, s.localidad AS sucursal_localidad, s.provincia AS sucursal_provincia
     FROM canjes c
     JOIN productos p ON p.id = c.producto_id
     LEFT JOIN sucursales s ON s.id = c.sucursal_id
     WHERE c.id = ? AND c.usuario_id = ?
     LIMIT 1`, [canjeId, req.user.id]);
    if (!row) {
        res.status(404).json({ error: "Canje no encontrado." });
        return;
    }
    const itemsMap = await getCanjeItemsByCanjeIds(db_1.pool, [Number(row.id)]);
    const fallbackItem = {
        producto_id: 0,
        producto_nombre: row.producto_nombre,
        producto_imagen: row.producto_imagen ?? null,
        cantidad: 1,
        puntos_unitarios: Number(row.puntos_usados),
        puntos_total: Number(row.puntos_usados),
    };
    const items = itemsMap.get(Number(row.id)) ?? [fallbackItem];
    const totalUnidades = items.reduce((acc, item) => acc + Number(item.cantidad), 0);
    const productosDetalle = items.map((item) => `${item.producto_nombre} x${item.cantidad}`).join(" | ");
    const primerItem = items[0];
    const productoNombreVista = items.length > 1 ? `${primerItem.producto_nombre} +${items.length - 1} mas` : primerItem.producto_nombre;
    res.json({
        ...row,
        producto_nombre: productoNombreVista,
        producto_imagen: primerItem.producto_imagen ?? row.producto_imagen ?? null,
        items,
        total_items: items.length,
        total_unidades: totalUnidades,
        productos_detalle: productosDetalle,
    });
});
router.get("/sucursales", async (_req, res) => {
    const rows = await (0, db_1.qAll)(db_1.pool, `SELECT id, nombre, direccion, piso, localidad, provincia
     FROM sucursales
     WHERE activo = 1
     ORDER BY nombre ASC, id ASC`);
    res.json(rows);
});
router.get("/carrito", async (req, res) => {
    const items = (await getCarritoItems(db_1.pool, req.user.id)).filter((item) => item.modo_compra === "dinero");
    const totalDinero = toMoney(items.reduce((acc, item) => acc + Number(item.subtotal_dinero || 0), 0));
    const totalUnidades = items.reduce((acc, item) => acc + Number(item.cantidad || 0), 0);
    const totalPuntosGanados = await (0, points_1.calcularPuntosPorMonto)(db_1.pool, totalDinero);
    const envioGratisMontoMinimo = await getFreeShippingMinimum(db_1.pool);
    res.json({
        items,
        resumen: {
            total_items: items.length,
            total_unidades: totalUnidades,
            total_dinero: totalDinero,
            total_puntos: 0,
            total_puntos_ganados: totalPuntosGanados,
            envio_gratis_monto_minimo: envioGratisMontoMinimo,
        },
    });
});
router.post("/carrito/items", async (req, res) => {
    const schema = zod_1.z.object({
        producto_id: zod_1.z.number().int().positive(),
        cantidad: zod_1.z.number().int().positive().max(purchaseLimits_1.MAX_SYSTEM_PURCHASE_QUANTITY),
        modo_compra: zod_1.z.literal("dinero"),
        sucursal_id: zod_1.z.number().int().positive().optional().nullable(),
        sabores: zod_1.z.array(zod_1.z.object({
            sabor_id: zod_1.z.number().int().positive(),
            cantidad: zod_1.z.number().int().positive(),
        })).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0].message });
        return;
    }
    const { producto_id, cantidad, modo_compra, sucursal_id } = parsed.data;
    const saboresSeleccionados = normalizeFlavorSelection(parsed.data.sabores);
    const usuarioId = req.user.id;
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        const carritoId = await ensureActiveCart(conn, usuarioId);
        const producto = await getProductoForCart(conn, producto_id);
        const pricingProfile = await (0, customerPricing_1.getActiveClientePricingProfile)(conn, usuarioId);
        const resolvePrice = await (0, customerPricing_1.createPricingResolver)(conn, { source: "web", profile: pricingProfile });
        validateProductoForMode(producto, modo_compra);
        const configHash = buildFlavorConfigHash(producto_id, saboresSeleccionados);
        const existente = await (0, db_1.qOne)(conn, `SELECT id, cantidad
       FROM carrito_items
       WHERE carrito_id = ? AND producto_id = ? AND modo_compra = ? AND config_hash = ?
       LIMIT 1`, [carritoId, producto_id, modo_compra, configHash]);
        const nuevaCantidad = Number(existente?.cantidad ?? 0) + cantidad;
        const purchaseLimit = await (0, purchaseLimits_1.getPurchaseQuantityLimit)(conn, pricingProfile?.tipoCliente ?? "cliente");
        assertWithinPurchaseLimit(nuevaCantidad, purchaseLimit);
        const saboresDetalle = await validateFlavorSelectionForProduct(conn, {
            producto,
            sabores: saboresSeleccionados,
            cantidadCajas: nuevaCantidad,
            sucursalId: sucursal_id ?? null,
        });
        await assertCartQuantityWithinStock(conn, {
            producto,
            cantidad: nuevaCantidad,
            sucursalId: sucursal_id ?? null,
        });
        const precioDineroUnit = getPrecioDineroConResolver(producto, resolvePrice);
        const precioPuntosUnit = null;
        const subtotalDinero = toMoney(precioDineroUnit * nuevaCantidad);
        const subtotalPuntos = 0;
        if (existente?.id) {
            await (0, db_1.qRun)(conn, `UPDATE carrito_items
         SET cantidad = ?, precio_dinero_unit = ?, precio_puntos_unit = ?,
             subtotal_dinero = ?, subtotal_puntos = ?, puntaje_al_comprar_unitario = ?
         WHERE id = ?`, [nuevaCantidad, precioDineroUnit, precioPuntosUnit, subtotalDinero, subtotalPuntos, producto.puntaje_al_comprar ?? 0, Number(existente.id)]);
            await (0, db_1.qRun)(conn, "DELETE FROM carrito_item_sabores WHERE carrito_item_id = ?", [Number(existente.id)]);
            for (const sabor of saboresDetalle) {
                await (0, db_1.qRun)(conn, `INSERT INTO carrito_item_sabores (carrito_item_id, sabor_id, sabor_nombre, cantidad)
           VALUES (?, ?, ?, ?)`, [Number(existente.id), sabor.sabor_id, sabor.nombre, sabor.cantidad]);
            }
        }
        else {
            const inserted = await (0, db_1.qRun)(conn, `INSERT INTO carrito_items
          (carrito_id, producto_id, cantidad, modo_compra, config_hash, precio_dinero_unit, precio_puntos_unit, subtotal_dinero, subtotal_puntos, puntaje_al_comprar_unitario)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [carritoId, producto_id, nuevaCantidad, modo_compra, configHash, precioDineroUnit, precioPuntosUnit, subtotalDinero, subtotalPuntos, producto.puntaje_al_comprar ?? 0]);
            for (const sabor of saboresDetalle) {
                await (0, db_1.qRun)(conn, `INSERT INTO carrito_item_sabores (carrito_item_id, sabor_id, sabor_nombre, cantidad)
           VALUES (?, ?, ?, ?)`, [inserted.insertId, sabor.sabor_id, sabor.nombre, sabor.cantidad]);
            }
        }
        await (0, db_1.qRun)(conn, "UPDATE carritos SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", [carritoId]);
        await conn.commit();
        res.status(201).json({ ok: true });
    }
    catch (err) {
        await conn.rollback();
        if (err instanceof HttpError) {
            res.status(err.status).json({ error: err.message });
            return;
        }
        throw err;
    }
    finally {
        conn.release();
    }
});
router.patch("/carrito/items/:itemId", async (req, res) => {
    const itemId = Number(req.params.itemId);
    const schema = zod_1.z.object({
        cantidad: zod_1.z.number().int().positive().max(purchaseLimits_1.MAX_SYSTEM_PURCHASE_QUANTITY),
        sucursal_id: zod_1.z.number().int().positive().optional().nullable(),
    });
    const parsed = schema.safeParse(req.body);
    if (!Number.isFinite(itemId) || itemId <= 0) {
        res.status(400).json({ error: "Item inválido." });
        return;
    }
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0].message });
        return;
    }
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        const item = await (0, db_1.qOne)(conn, `SELECT ci.id, ci.carrito_id, ci.producto_id, ci.modo_compra, ci.cantidad, ci.config_hash, p.configuracion_tipo
       FROM carrito_items ci
       JOIN carritos c ON c.id = ci.carrito_id
       JOIN productos p ON p.id = ci.producto_id
       WHERE ci.id = ? AND c.usuario_id = ? AND c.estado = 'activo'
       LIMIT 1`, [itemId, req.user.id]);
        if (!item) {
            await conn.rollback();
            res.status(404).json({ error: "Item de carrito no encontrado." });
            return;
        }
        if (item.modo_compra !== "dinero") {
            throw new HttpError(400, "Este endpoint solo modifica items del carrito de tienda.");
        }
        if (item.config_hash || item.configuracion_tipo === "caja_sabores") {
            throw new HttpError(400, "Para cambiar una caja personalizada, elimina el item y vuelve a elegir los sabores.");
        }
        const producto = await getProductoForCart(conn, Number(item.producto_id));
        const pricingProfile = await (0, customerPricing_1.getActiveClientePricingProfile)(conn, req.user.id);
        const resolvePrice = await (0, customerPricing_1.createPricingResolver)(conn, { source: "web", profile: pricingProfile });
        validateProductoForMode(producto, item.modo_compra);
        const purchaseLimit = await (0, purchaseLimits_1.getPurchaseQuantityLimit)(conn, pricingProfile?.tipoCliente ?? "cliente");
        assertWithinPurchaseLimit(parsed.data.cantidad, purchaseLimit);
        if (parsed.data.cantidad > Number(item.cantidad ?? 0)) {
            await assertCartQuantityWithinStock(conn, {
                producto,
                cantidad: parsed.data.cantidad,
                sucursalId: parsed.data.sucursal_id ?? null,
            });
        }
        const precioDineroUnit = getPrecioDineroConResolver(producto, resolvePrice);
        const precioPuntosUnit = null;
        const subtotalDinero = toMoney(precioDineroUnit * parsed.data.cantidad);
        const subtotalPuntos = 0;
        await (0, db_1.qRun)(conn, `UPDATE carrito_items
       SET cantidad = ?, precio_dinero_unit = ?, precio_puntos_unit = ?,
           subtotal_dinero = ?, subtotal_puntos = ?, puntaje_al_comprar_unitario = ?
       WHERE id = ?`, [parsed.data.cantidad, precioDineroUnit, precioPuntosUnit, subtotalDinero, subtotalPuntos, producto.puntaje_al_comprar ?? 0, itemId]);
        await (0, db_1.qRun)(conn, "UPDATE carritos SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", [Number(item.carrito_id)]);
        await conn.commit();
        res.json({ ok: true });
    }
    catch (err) {
        await conn.rollback();
        if (err instanceof HttpError) {
            res.status(err.status).json({ error: err.message });
            return;
        }
        throw err;
    }
    finally {
        conn.release();
    }
});
router.delete("/carrito/items/:itemId", async (req, res) => {
    const itemId = Number(req.params.itemId);
    if (!Number.isFinite(itemId) || itemId <= 0) {
        res.status(400).json({ error: "Item inválido." });
        return;
    }
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        const item = await (0, db_1.qOne)(conn, `SELECT ci.carrito_id
       FROM carrito_items ci
       JOIN carritos c ON c.id = ci.carrito_id
       WHERE ci.id = ? AND c.usuario_id = ? AND c.estado = 'activo'
       LIMIT 1`, [itemId, req.user.id]);
        if (!item) {
            await conn.rollback();
            res.status(404).json({ error: "Item de carrito no encontrado." });
            return;
        }
        await (0, db_1.qRun)(conn, "DELETE FROM carrito_items WHERE id = ?", [itemId]);
        await (0, db_1.qRun)(conn, "UPDATE carritos SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", [Number(item.carrito_id)]);
        await conn.commit();
        res.json({ ok: true });
    }
    catch (err) {
        await conn.rollback();
        throw err;
    }
    finally {
        conn.release();
    }
});
router.delete("/carrito/vaciar", async (req, res) => {
    const usuarioId = req.user.id;
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        const carrito = await (0, db_1.qOne)(conn, "SELECT id FROM carritos WHERE usuario_id = ? AND estado = 'activo' LIMIT 1", [usuarioId]);
        if (carrito) {
            await (0, db_1.qRun)(conn, "DELETE FROM carrito_items WHERE carrito_id = ?", [carrito.id]);
            await (0, db_1.qRun)(conn, "UPDATE carritos SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", [carrito.id]);
        }
        await conn.commit();
        res.json({ ok: true });
    }
    catch (err) {
        await conn.rollback();
        throw err;
    }
    finally {
        conn.release();
    }
});
router.get("/checkout/shipping-quote", async (req, res) => {
    const direccionId = Number(req.query.direccion_id ?? 0);
    if (!Number.isInteger(direccionId) || direccionId <= 0) {
        res.status(400).json({ error: "Selecciona una direccion de envio." });
        return;
    }
    try {
        const address = await (0, userAddresses_1.getUserAddress)(db_1.pool, req.user.id, direccionId);
        if (!address) {
            res.status(404).json({ error: "Direccion de envio no encontrada." });
            return;
        }
        const quote = await (0, shippingZones_1.quoteShippingForCoordinates)(db_1.pool, address.lat, address.lng);
        const items = (await getCarritoItems(db_1.pool, req.user.id)).filter((item) => item.modo_compra === "dinero");
        const subtotalDineroProductos = toMoney(items.reduce((acc, item) => acc + Number(item.subtotal_dinero || 0), 0));
        const envioGratisMontoMinimo = await getFreeShippingMinimum(db_1.pool);
        res.json(applyFreeShippingToQuote(quote, buildFreeShippingDecision(items, subtotalDineroProductos, envioGratisMontoMinimo)));
    }
    catch (err) {
        if (err instanceof shippingZones_1.ShippingZoneError) {
            res.status(err.status).json({ error: err.message });
            return;
        }
        throw err;
    }
});
router.post("/checkout/preview", async (req, res) => {
    const schema = zod_1.z.object({
        sucursal_id: zod_1.z.number().int().positive().optional().nullable(),
        metodo_entrega: zod_1.z.enum(["retiro", "envio"]).optional().default("retiro"),
        direccion_id: zod_1.z.number().int().positive().optional().nullable(),
        direccion_envio: shippingAddressSchema.optional().nullable(),
    });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0].message });
        return;
    }
    const conn = await db_1.pool.getConnection();
    try {
        const faltantes = await validateProfileForCheckout(req.user.id);
        if (faltantes.length > 0) {
            throw new HttpError(400, `Completa tus datos obligatorios antes de comprar: ${faltantes.join(", ")}`, "PERFIL_INCOMPLETO");
        }
        const carritoId = await getActiveCartId(conn, req.user.id);
        if (!carritoId) {
            res.status(400).json({ error: "No tienes un carrito activo." });
            return;
        }
        const items = (await getCarritoItems(conn, req.user.id)).filter((item) => item.modo_compra === "dinero");
        if (!items.length) {
            res.status(400).json({ error: "Tu carrito está vacío." });
            return;
        }
        const pricingProfile = await (0, customerPricing_1.getActiveClientePricingProfile)(conn, req.user.id);
        const resolvePrice = await (0, customerPricing_1.createPricingResolver)(conn, { source: "web", profile: pricingProfile });
        const sucursalSeleccionada = await resolveSucursalSeleccionada(conn, parsed.data.sucursal_id ?? null);
        const metodoEntrega = parsed.data.metodo_entrega ?? "retiro";
        const direccionEnvio = metodoEntrega === "envio"
            ? await resolveCheckoutShippingAddress(conn, req.user.id, parsed.data.direccion_id ?? null, parsed.data.direccion_envio ?? null)
            : null;
        let shippingQuote = null;
        const requiereStock = items.some((item) => Number(item.track_stock) === 1 || (item.sabores?.length ?? 0) > 0);
        if (requiereStock && !sucursalSeleccionada) {
            throw new HttpError(400, "Debes seleccionar una sucursal para validar stock.");
        }
        if (metodoEntrega === "envio") {
            if (!direccionEnvio) {
                throw new HttpError(400, "Selecciona una direccion de envio para continuar.");
            }
            const noEnviables = items.filter((item) => Number(item.permite_envio ?? 0) !== 1);
            if (noEnviables.length) {
                throw new HttpError(400, `Hay productos que no permiten envio: ${noEnviables.map((item) => item.nombre).join(", ")}.`);
            }
            shippingQuote = await resolveCheckoutShippingQuote(conn, direccionEnvio);
        }
        const stockIssues = [];
        const itemsEvaluados = [];
        for (const item of items) {
            const producto = await getProductoForCart(conn, Number(item.producto_id));
            validateProductoForMode(producto, item.modo_compra);
            let stockDisponibleSucursal = null;
            if (Number(item.track_stock) === 1 && sucursalSeleccionada) {
                const inv = await (0, db_1.qOne)(conn, `SELECT stock_disponible
           FROM inventario_sucursal
           WHERE producto_id = ? AND sucursal_id = ?
           LIMIT 1`, [item.producto_id, sucursalSeleccionada.id]);
                stockDisponibleSucursal = Number(inv?.stock_disponible ?? 0);
                if (stockDisponibleSucursal < item.cantidad) {
                    stockIssues.push(`${item.nombre}: no hay stock suficiente en la sucursal seleccionada.`);
                }
            }
            if ((item.sabores?.length ?? 0) > 0 && sucursalSeleccionada) {
                for (const sabor of item.sabores ?? []) {
                    const invSabor = await (0, db_1.qOne)(conn, `SELECT stock_disponible
             FROM inventario_sabor_sucursal
             WHERE sabor_id = ? AND sucursal_id = ?
             LIMIT 1`, [sabor.sabor_id, sucursalSeleccionada.id]);
                    const disponibleSabor = Number(invSabor?.stock_disponible ?? 0);
                    if (disponibleSabor < Number(sabor.cantidad ?? 0)) {
                        stockIssues.push(`${item.nombre} (${sabor.nombre}): no hay stock suficiente en la sucursal seleccionada.`);
                    }
                }
            }
            const precioDineroUnit = item.modo_compra === "dinero" ? getPrecioDineroConResolver(producto, resolvePrice) : null;
            const precioPuntosUnit = null;
            const subtotalDinero = toMoney((precioDineroUnit ?? 0) * item.cantidad);
            const subtotalPuntos = 0;
            itemsEvaluados.push({
                ...item,
                precio_dinero_unit: precioDineroUnit,
                precio_puntos_unit: precioPuntosUnit,
                subtotal_dinero: subtotalDinero,
                subtotal_puntos: subtotalPuntos,
            });
        }
        const subtotalDineroProductos = toMoney(itemsEvaluados.reduce((acc, item) => acc + Number(item.subtotal_dinero || 0), 0));
        if (shippingQuote) {
            const envioGratisMontoMinimo = await getFreeShippingMinimum(conn);
            shippingQuote = applyFreeShippingToQuote(shippingQuote, buildFreeShippingDecision(itemsEvaluados, subtotalDineroProductos, envioGratisMontoMinimo));
        }
        const costoEnvio = toMoney(shippingQuote?.costo_envio ?? 0);
        const totalDinero = toMoney(subtotalDineroProductos + costoEnvio);
        const totalUnidades = itemsEvaluados.reduce((acc, item) => acc + Number(item.cantidad || 0), 0);
        const stockOk = stockIssues.length === 0;
        const direccionEnvioSnapshot = direccionEnvio && shippingQuote
            ? buildShippingAddressOrderSnapshot(direccionEnvio, shippingQuote)
            : direccionEnvio;
        res.json({
            carrito_id: carritoId,
            items: itemsEvaluados,
            sucursal: sucursalSeleccionada
                ? {
                    ...sucursalSeleccionada,
                    label: buildLugarRetiro(sucursalSeleccionada),
                }
                : null,
            metodo_entrega: metodoEntrega,
            direccion_envio: direccionEnvioSnapshot,
            envio: shippingQuote,
            resumen: {
                total_items: itemsEvaluados.length,
                total_unidades: totalUnidades,
                subtotal_dinero: subtotalDineroProductos,
                costo_envio: costoEnvio,
                total_dinero: totalDinero,
                total_puntos: 0,
            },
            validaciones: {
                puntos_ok: true,
                stock_ok: stockOk,
                saldo_puntos_actual: null,
                puntos_faltantes: 0,
                errores_stock: stockIssues,
            },
            puede_confirmar: stockOk,
        });
    }
    catch (err) {
        if (err instanceof HttpError) {
            res.status(err.status).json({
                error: err.message,
                ...(err.errorCode ? { error_code: err.errorCode } : {}),
            });
            return;
        }
        throw err;
    }
    finally {
        conn.release();
    }
});
router.post("/checkout/confirm", async (req, res) => {
    const schema = zod_1.z.object({
        sucursal_id: zod_1.z.number().int().positive().optional().nullable(),
        metodo_entrega: zod_1.z.enum(["retiro", "envio"]).optional().default("retiro"),
        direccion_id: zod_1.z.number().int().positive().optional().nullable(),
        direccion_envio: shippingAddressSchema.optional().nullable(),
        notas: zod_1.z.string().max(500).optional().nullable(),
        pago: zod_1.z.object({
            provider: zod_1.z.enum(["mercadopago", "efectivo"]),
            method: zod_1.z.enum(["brick", "wallet", "qr", "cash"]).optional(),
        }).optional(),
    });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0].message });
        return;
    }
    const conn = await db_1.pool.getConnection();
    try {
        const faltantes = await validateProfileForCheckout(req.user.id);
        if (faltantes.length > 0) {
            throw new HttpError(400, `Completa tus datos obligatorios antes de comprar: ${faltantes.join(", ")}`, "PERFIL_INCOMPLETO");
        }
        await conn.beginTransaction();
        const carritoId = await getActiveCartId(conn, req.user.id);
        if (!carritoId) {
            throw new HttpError(400, "No tienes un carrito activo.");
        }
        const items = (await getCarritoItems(conn, req.user.id)).filter((item) => item.modo_compra === "dinero");
        if (!items.length) {
            throw new HttpError(400, "Tu carrito está vacío.");
        }
        const pricingProfile = await (0, customerPricing_1.getActiveClientePricingProfile)(conn, req.user.id);
        const resolvePrice = await (0, customerPricing_1.createPricingResolver)(conn, { source: "web", profile: pricingProfile });
        const usuario = await (0, db_1.qOne)(conn, "SELECT nombre, email, puntos_saldo FROM usuarios WHERE id = ?", [req.user.id]);
        const sucursalSeleccionada = await resolveSucursalSeleccionada(conn, parsed.data.sucursal_id ?? null);
        const metodoEntrega = parsed.data.metodo_entrega ?? "retiro";
        const requiereStock = items.some((item) => Number(item.track_stock) === 1 || (item.sabores?.length ?? 0) > 0);
        if (requiereStock && !sucursalSeleccionada) {
            throw new HttpError(400, "Debes seleccionar una sucursal para confirmar la orden.");
        }
        const direccionEnvio = metodoEntrega === "envio"
            ? await resolveCheckoutShippingAddress(conn, req.user.id, parsed.data.direccion_id ?? null, parsed.data.direccion_envio ?? null)
            : null;
        let shippingQuote = null;
        if (metodoEntrega === "envio") {
            if (!direccionEnvio) {
                throw new HttpError(400, "Selecciona una direccion de envio para continuar.");
            }
            const noEnviables = items.filter((item) => Number(item.permite_envio ?? 0) !== 1);
            if (noEnviables.length) {
                throw new HttpError(400, `Hay productos que no permiten envio: ${noEnviables.map((item) => item.nombre).join(", ")}.`);
            }
            shippingQuote = await resolveCheckoutShippingQuote(conn, direccionEnvio);
        }
        const itemsNormalizados = [];
        for (const item of items) {
            const producto = await getProductoForCart(conn, Number(item.producto_id));
            validateProductoForMode(producto, item.modo_compra);
            const precioDineroUnit = getPrecioDineroConResolver(producto, resolvePrice);
            const precioPuntosUnit = null;
            itemsNormalizados.push({
                producto_id: Number(item.producto_id),
                cantidad: Number(item.cantidad),
                modo_compra: item.modo_compra,
                config_hash: item.config_hash ?? "",
                precio_dinero_unit: precioDineroUnit,
                precio_puntos_unit: precioPuntosUnit,
                subtotal_dinero: toMoney((precioDineroUnit ?? 0) * Number(item.cantidad)),
                subtotal_puntos: 0,
                track_stock: Number(item.track_stock ?? 0),
                puntaje_al_comprar_unitario: producto.puntaje_al_comprar ?? 0,
                nombre: item.nombre,
                sabores: item.sabores ?? [],
            });
        }
        const subtotalDineroProductos = toMoney(itemsNormalizados.reduce((acc, item) => acc + item.subtotal_dinero, 0));
        if (shippingQuote) {
            const envioGratisMontoMinimo = await getFreeShippingMinimum(conn);
            shippingQuote = applyFreeShippingToQuote(shippingQuote, buildFreeShippingDecision(items, subtotalDineroProductos, envioGratisMontoMinimo));
        }
        const costoEnvio = toMoney(shippingQuote?.costo_envio ?? 0);
        const totalDinero = toMoney(subtotalDineroProductos + costoEnvio);
        const totalPuntos = 0;
        const totalPuntosGanados = await (0, points_1.calcularPuntosPorMonto)(conn, totalDinero);
        const paymentChoice = totalDinero > 0 ? (0, paymentProviders_1.resolvePaymentChoice)(parsed.data.pago ?? null) : null;
        if (paymentChoice) {
            if (paymentChoice.provider === "efectivo" && metodoEntrega !== "retiro") {
                throw new HttpError(400, "El pago en efectivo solo esta disponible para retiro en sucursal.");
            }
            const availability = (0, paymentProviders_1.isPaymentChoiceAvailable)(paymentChoice);
            if (!availability.ok) {
                throw new HttpError(400, availability.reason || "Medio de pago no disponible.");
            }
        }
        const tipoOrden = "venta";
        const estadoOrden = totalDinero > 0
            ? metodoEntrega === "envio" ? "borrador" : "pendiente_pago"
            : "preparada";
        const envioCotizacionSnapshot = shippingQuote ? (0, shippingZones_1.buildShippingQuoteSnapshot)(shippingQuote) : null;
        const direccionEnvioSnapshot = direccionEnvio && shippingQuote
            ? buildShippingAddressOrderSnapshot(direccionEnvio, shippingQuote)
            : direccionEnvio;
        const { insertId: ordenId } = await (0, db_1.qRun)(conn, `INSERT INTO ordenes
        (usuario_id, carrito_id, canal, tipo_orden, estado, moneda, total_dinero, total_puntos,
         direccion_envio_json, sucursal_retiro_id, envio_zona_id, envio_costo, envio_cotizacion_json, notas)
       VALUES (?, ?, 'web', ?, ?, 'ARS', ?, ?, ?, ?, ?, ?, ?, ?)`, [
            req.user.id,
            carritoId,
            tipoOrden,
            estadoOrden,
            totalDinero,
            totalPuntos,
            direccionEnvioSnapshot ? JSON.stringify({ metodo_entrega: "envio", ...direccionEnvioSnapshot }) : null,
            sucursalSeleccionada?.id ?? null,
            shippingQuote?.zona?.id ?? null,
            costoEnvio,
            envioCotizacionSnapshot ? JSON.stringify(envioCotizacionSnapshot) : null,
            parsed.data.notas ?? null,
        ]);
        if (sucursalSeleccionada) {
            await (0, stock_1.reserveStockForCheckoutItems)(conn, {
                sucursalId: sucursalSeleccionada.id,
                items: itemsNormalizados
                    .filter((item) => item.track_stock === 1)
                    .map((item) => ({
                    producto_id: item.producto_id,
                    cantidad: item.cantidad,
                    origen: "compra",
                    descripcion: `Reserva orden #${ordenId}`,
                })),
                referencia: `orden #${ordenId}`,
                creadoPor: req.user.id,
                ordenId: Number(ordenId),
            });
            await (0, stock_1.reserveFlavorStockForCheckoutItems)(conn, {
                sucursalId: sucursalSeleccionada.id,
                items: itemsNormalizados.flatMap((item) => item.sabores.map((sabor) => ({
                    sabor_id: sabor.sabor_id,
                    cantidad: sabor.cantidad,
                    origen: "compra",
                    descripcion: `Reserva orden #${ordenId}`,
                }))),
                referencia: `orden #${ordenId}`,
                creadoPor: req.user.id,
                ordenId: Number(ordenId),
            });
        }
        for (const item of itemsNormalizados) {
            const insertedItem = await (0, db_1.qRun)(conn, `INSERT INTO orden_items
          (orden_id, producto_id, cantidad, modo_compra, config_hash, precio_dinero_unit, precio_puntos_unit, subtotal_dinero, subtotal_puntos, puntaje_al_comprar_unitario)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                ordenId,
                item.producto_id,
                item.cantidad,
                item.modo_compra,
                item.config_hash,
                item.precio_dinero_unit,
                item.precio_puntos_unit,
                item.subtotal_dinero,
                item.subtotal_puntos,
                item.puntaje_al_comprar_unitario,
            ]);
            for (const sabor of item.sabores) {
                await (0, db_1.qRun)(conn, `INSERT INTO orden_item_sabores (orden_item_id, sabor_id, sabor_nombre, cantidad)
           VALUES (?, ?, ?, ?)`, [insertedItem.insertId, sabor.sabor_id, sabor.nombre, sabor.cantidad]);
            }
        }
        let checkoutUrl = null;
        let paymentStatus = null;
        let paymentMessage = null;
        let paymentProvider = null;
        let paymentMethod = null;
        let paymentProviderId = null;
        let paymentPreferenceId = null;
        let paymentPublicKey = null;
        let paymentQrData = null;
        let paymentQrImage = null;
        let paymentExpiresAt = null;
        if (totalDinero > 0) {
            const choice = paymentChoice ?? { provider: "mercadopago", method: "brick" };
            const paymentFee = await (0, paymentFees_1.resolvePaymentFee)(conn, {
                proveedor: choice.provider,
                metodo: choice.method,
                monto: totalDinero,
            });
            const paymentSession = await (0, paymentProviders_1.createPaymentSession)({
                choice,
                orderId: Number(ordenId),
                amount: totalDinero,
                currency: "ARS",
                buyerName: usuario?.nombre || `Cliente #${req.user.id}`,
                buyerEmail: usuario?.email || "",
                description: `Pedido #${ordenId}`,
            });
            await (0, db_1.qRun)(conn, `INSERT INTO pagos (
           orden_id, proveedor, metodo, estado, monto, comision_porcentaje, comision_monto, monto_neto,
           moneda, provider_payment_id, checkout_url, payload_json
         )
         VALUES (?, ?, ?, 'iniciado', ?, ?, ?, ?, 'ARS', ?, ?, ?)`, [
                ordenId,
                choice.provider,
                choice.method,
                totalDinero,
                paymentFee.porcentaje,
                paymentFee.montoComision,
                paymentFee.montoNeto,
                paymentSession.providerPaymentId,
                paymentSession.checkoutUrl,
                JSON.stringify({
                    ...(paymentSession.payload ?? {}),
                    comision: paymentFee,
                }),
            ]);
            checkoutUrl = paymentSession.checkoutUrl;
            paymentStatus = paymentSession.status;
            paymentMessage = paymentSession.message;
            paymentProvider = choice.provider;
            paymentMethod = choice.method;
            paymentProviderId = paymentSession.providerPaymentId;
            paymentPreferenceId = paymentSession.preferenceId;
            paymentPublicKey = paymentSession.publicKey;
            paymentQrData = paymentSession.qrData ?? null;
            paymentQrImage = paymentSession.qrImage ?? null;
            paymentExpiresAt = paymentSession.expiresAt ?? null;
        }
        await (0, db_1.qRun)(conn, "UPDATE carritos SET estado = 'convertido' WHERE id = ?", [carritoId]);
        await conn.commit();
        (0, realtime_1.emitRealtime)(estadoOrden === "borrador" ? ["inventario", "productos", "stats"] : ["ordenes", "inventario", "productos", "stats"]);
        res.status(201).json({
            ok: true,
            orden_id: ordenId,
            estado: estadoOrden,
            tipo_orden: tipoOrden,
            total_dinero: totalDinero,
            total_dinero_productos: subtotalDineroProductos,
            costo_envio: costoEnvio,
            total_puntos: totalPuntos,
            total_puntos_ganados: totalPuntosGanados,
            pago_pendiente: totalDinero > 0,
            pago: totalDinero > 0 ? {
                proveedor: paymentProvider,
                metodo: paymentMethod,
                estado: "iniciado",
                checkout_url: checkoutUrl,
                preference_id: paymentPreferenceId,
                public_key: paymentPublicKey,
                qr_data: paymentQrData,
                qr_image: paymentQrImage,
                expires_at: paymentExpiresAt,
                provider_payment_id: paymentProviderId,
                setup_status: paymentStatus,
                setup_message: paymentMessage,
            } : null,
            nuevo_saldo_puntos: usuario?.puntos_saldo ?? 0,
            sucursal: sucursalSeleccionada
                ? {
                    ...sucursalSeleccionada,
                    label: buildLugarRetiro(sucursalSeleccionada),
                }
                : null,
            metodo_entrega: metodoEntrega,
            direccion_envio: direccionEnvioSnapshot,
            envio: shippingQuote,
        });
    }
    catch (err) {
        await conn.rollback();
        if (err instanceof HttpError) {
            res.status(err.status).json({
                error: err.message,
                ...(err.errorCode ? { error_code: err.errorCode } : {}),
            });
            return;
        }
        if (err instanceof paymentProviders_1.MercadoPagoQrOrderError) {
            res.status(400).json({
                error: "No se pudo crear la orden QR de Mercado Pago",
                message: "No se pudo crear la orden QR de Mercado Pago",
                mercadoPagoError: err.detail,
                status: err.status,
                cause: err.cause ?? null,
            });
            return;
        }
        const rawMsg = err instanceof Error ? err.message : "No se pudo confirmar el checkout.";
        const msg = rawMsg.toLowerCase().includes("stock insuficiente")
            ? "No hay stock suficiente en la sucursal seleccionada para completar la reserva."
            : rawMsg;
        res.status(400).json({ error: msg });
    }
    finally {
        conn.release();
    }
});
router.post("/checkout/ordenes/:id/process-payment", async (req, res) => {
    const ordenId = Number(req.params.id);
    if (!Number.isInteger(ordenId) || ordenId <= 0) {
        res.status(400).json({ error: "ID de orden invalido." });
        return;
    }
    const schema = zod_1.z.object({
        selected_payment_method: zod_1.z.string().optional().nullable(),
        form_data: zod_1.z.record(zod_1.z.unknown()),
        additional_data: zod_1.z.record(zod_1.z.unknown()).optional().nullable(),
    });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0]?.message || "Datos de pago invalidos." });
        return;
    }
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        const orden = await (0, db_1.qOne)(conn, `SELECT o.id, o.usuario_id, o.estado, o.total_dinero, o.moneda, u.email AS comprador_email
       FROM ordenes o
       JOIN usuarios u ON u.id = o.usuario_id
       WHERE o.id = ? AND o.usuario_id = ?
       LIMIT 1
       FOR UPDATE`, [ordenId, req.user.id]);
        if (!orden) {
            throw new HttpError(404, "Orden no encontrada.");
        }
        if (orden.estado === "pagada") {
            await conn.commit();
            queueOrderReceiptEmail(ordenId);
            res.json({ ok: true, orden_id: ordenId, estado: "pagada", already_paid: true });
            return;
        }
        if (!(orden.estado === "pendiente_pago" || orden.estado === "borrador")) {
            throw new HttpError(400, `No se puede pagar una orden en estado '${orden.estado}'.`);
        }
        const pago = await (0, db_1.qOne)(conn, `SELECT id, proveedor, metodo, estado
       FROM pagos
       WHERE orden_id = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT 1
       FOR UPDATE`, [ordenId]);
        if (!pago || pago.proveedor !== "mercadopago" || pago.metodo !== "brick") {
            throw new HttpError(400, "Esta orden no fue iniciada para pago con tarjeta en Mercado Pago.");
        }
        if (pago.estado !== "iniciado") {
            throw new HttpError(400, `El pago de esta orden esta en estado '${pago.estado}'.`);
        }
        const total = toMoney(Number(orden.total_dinero ?? 0));
        if (total <= 0) {
            throw new HttpError(400, "La orden no tiene monto pendiente en dinero.");
        }
        const totalPuntosGanados = await (0, points_1.calcularPuntosPorMonto)(conn, total);
        const mpResult = await (0, paymentProviders_1.processMercadoPagoApiPayment)({
            orderId: ordenId,
            amount: total,
            currency: orden.moneda || "ARS",
            buyerEmail: orden.comprador_email || "",
            description: `Pedido #${ordenId}`,
            formData: parsed.data.form_data,
        });
        const payload = {
            mercado_pago: mpResult.payload,
            selected_payment_method: parsed.data.selected_payment_method ?? null,
            additional_data: parsed.data.additional_data ?? null,
        };
        if (mpResult.status === "approved") {
            const result = await (0, orderLifecycle_1.approvePaidOrder)(conn, {
                orderId: ordenId,
                provider: "mercadopago",
                providerPaymentId: mpResult.providerPaymentId,
                payload,
            });
            await conn.commit();
            (0, realtime_1.emitRealtime)(["ordenes", "inventario", "productos", "stats", "puntos"]);
            queueOrderReceiptEmail(ordenId);
            res.json({
                ok: true,
                orden_id: ordenId,
                estado: result.state,
                pago_estado: "aprobado",
                provider_payment_id: mpResult.providerPaymentId,
                status_detail: mpResult.statusDetail,
            });
            return;
        }
        await (0, db_1.qRun)(conn, `UPDATE pagos
       SET estado = ?, provider_payment_id = ?, payload_json = ?
       WHERE id = ? AND estado = 'iniciado'`, [
            ["rejected", "cancelled", "canceled"].includes(mpResult.status) ? "rechazado" : "iniciado",
            mpResult.providerPaymentId,
            JSON.stringify(payload),
            pago.id,
        ]);
        await conn.commit();
        res.json({
            ok: false,
            orden_id: ordenId,
            estado: orden.estado,
            pago_estado: mpResult.status,
            provider_payment_id: mpResult.providerPaymentId,
            status_detail: mpResult.statusDetail,
        });
    }
    catch (err) {
        await conn.rollback();
        if (err instanceof HttpError) {
            res.status(err.status).json({ error: err.message });
            return;
        }
        const msg = err instanceof Error ? err.message : "No se pudo procesar el pago.";
        res.status(400).json({ error: msg });
    }
    finally {
        conn.release();
    }
});
router.post("/checkout/ordenes/:id/change-payment-method", async (req, res) => {
    const ordenId = Number(req.params.id);
    if (!Number.isInteger(ordenId) || ordenId <= 0) {
        res.status(400).json({ error: "ID de orden invalido." });
        return;
    }
    const schema = zod_1.z.object({
        pago: zod_1.z.object({
            provider: zod_1.z.enum(["mercadopago", "efectivo"]),
            method: zod_1.z.enum(["brick", "wallet", "qr", "cash"]).optional(),
        }),
    });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0]?.message || "Medio de pago invalido." });
        return;
    }
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        const orden = await (0, db_1.qOne)(conn, `SELECT o.id, o.usuario_id, o.estado, o.total_dinero, o.moneda, o.direccion_envio_json,
              u.nombre AS comprador_nombre, u.email AS comprador_email,
              (SELECT COALESCE(SUM(cantidad * puntaje_al_comprar_unitario), 0)
               FROM orden_items
               WHERE orden_id = o.id AND modo_compra = 'dinero') AS total_puntos_ganados
       FROM ordenes o
       JOIN usuarios u ON u.id = o.usuario_id
       WHERE o.id = ? AND o.usuario_id = ?
       LIMIT 1
       FOR UPDATE`, [ordenId, req.user.id]);
        if (!orden) {
            throw new HttpError(404, "Orden no encontrada.");
        }
        if (!(orden.estado === "pendiente_pago" || orden.estado === "borrador")) {
            throw new HttpError(400, `La orden esta en estado '${orden.estado}' y no permite cambiar el medio de pago.`);
        }
        const total = toMoney(Number(orden.total_dinero ?? 0));
        if (total <= 0) {
            throw new HttpError(400, "La orden no tiene monto pendiente en dinero.");
        }
        const totalPuntosGanados = await (0, points_1.calcularPuntosPorMonto)(conn, total);
        const direccionEnvio = parseJsonField(orden.direccion_envio_json);
        const isShippingOrder = Boolean(direccionEnvio);
        const paymentChoice = (0, paymentProviders_1.resolvePaymentChoice)(parsed.data.pago);
        if (paymentChoice.provider === "efectivo" && isShippingOrder) {
            throw new HttpError(400, "El pago en efectivo no esta disponible para envios.");
        }
        const availability = (0, paymentProviders_1.isPaymentChoiceAvailable)(paymentChoice);
        if (!availability.ok) {
            throw new HttpError(400, availability.reason || "Medio de pago no disponible.");
        }
        const paymentFee = await (0, paymentFees_1.resolvePaymentFee)(conn, {
            proveedor: paymentChoice.provider,
            metodo: paymentChoice.method,
            monto: total,
        });
        const paymentSession = await (0, paymentProviders_1.createPaymentSession)({
            choice: paymentChoice,
            orderId: ordenId,
            amount: total,
            currency: orden.moneda || "ARS",
            buyerName: orden.comprador_nombre || `Cliente #${req.user.id}`,
            buyerEmail: orden.comprador_email || "",
            description: `Pedido #${ordenId}`,
        });
        await (0, db_1.qRun)(conn, "UPDATE pagos SET estado = 'rechazado' WHERE orden_id = ? AND estado = 'iniciado'", [ordenId]);
        await (0, db_1.qRun)(conn, `INSERT INTO pagos (
         orden_id, proveedor, metodo, estado, monto, comision_porcentaje, comision_monto, monto_neto,
         moneda, provider_payment_id, checkout_url, payload_json
       )
       VALUES (?, ?, ?, 'iniciado', ?, ?, ?, ?, ?, ?, ?, ?)`, [
            ordenId,
            paymentChoice.provider,
            paymentChoice.method,
            total,
            paymentFee.porcentaje,
            paymentFee.montoComision,
            paymentFee.montoNeto,
            orden.moneda || "ARS",
            paymentSession.providerPaymentId,
            paymentSession.checkoutUrl,
            JSON.stringify({
                ...(paymentSession.payload ?? {}),
                comision: paymentFee,
            }),
        ]);
        await conn.commit();
        if (orden.estado !== "borrador") {
            (0, realtime_1.emitRealtime)(["ordenes"]);
        }
        res.json({
            ok: true,
            orden_id: ordenId,
            estado: orden.estado,
            total_dinero: total,
            total_puntos_ganados: totalPuntosGanados,
            pago_pendiente: true,
            metodo_entrega: isShippingOrder ? "envio" : "retiro",
            pago: {
                proveedor: paymentChoice.provider,
                metodo: paymentChoice.method,
                estado: "iniciado",
                checkout_url: paymentSession.checkoutUrl,
                preference_id: paymentSession.preferenceId,
                public_key: paymentSession.publicKey,
                qr_data: paymentSession.qrData ?? null,
                qr_image: paymentSession.qrImage ?? null,
                expires_at: paymentSession.expiresAt ?? null,
                provider_payment_id: paymentSession.providerPaymentId,
                setup_status: paymentSession.status,
                setup_message: paymentSession.message,
            },
        });
    }
    catch (err) {
        await conn.rollback();
        if (err instanceof HttpError) {
            res.status(err.status).json({ error: err.message });
            return;
        }
        if (err instanceof paymentProviders_1.MercadoPagoQrOrderError) {
            res.status(400).json({
                error: "No se pudo crear la orden QR de Mercado Pago",
                message: "No se pudo crear la orden QR de Mercado Pago",
                mercadoPagoError: err.detail,
                status: err.status,
                cause: err.cause ?? null,
            });
            return;
        }
        const msg = err instanceof Error ? err.message : "No se pudo cambiar el medio de pago.";
        res.status(400).json({ error: msg });
    }
    finally {
        conn.release();
    }
});
router.get("/checkout/ordenes/:id/resume-payment", async (req, res) => {
    const ordenId = Number(req.params.id);
    if (!Number.isInteger(ordenId) || ordenId <= 0) {
        res.status(400).json({ error: "ID de orden invalido." });
        return;
    }
    const orden = await (0, db_1.qOne)(db_1.pool, `SELECT id, estado, total_dinero, direccion_envio_json,
            (SELECT COALESCE(SUM(cantidad * puntaje_al_comprar_unitario), 0)
             FROM orden_items
             WHERE orden_id = ordenes.id AND modo_compra = 'dinero') AS total_puntos_ganados
     FROM ordenes
     WHERE id = ? AND usuario_id = ?
     LIMIT 1`, [ordenId, req.user.id]);
    if (!orden) {
        res.status(404).json({ error: "Orden no encontrada." });
        return;
    }
    if (!(orden.estado === "pendiente_pago" || orden.estado === "borrador")) {
        res.status(400).json({ error: `La orden esta en estado '${orden.estado}' y no tiene un pago pendiente para reanudar.` });
        return;
    }
    const pago = await (0, db_1.qOne)(db_1.pool, `SELECT id, orden_id, proveedor, metodo, estado, monto, moneda, provider_payment_id, checkout_url,
            payload_json, created_at, updated_at
     FROM pagos
     WHERE orden_id = ?
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`, [ordenId]);
    if (!pago || pago.proveedor !== "mercadopago") {
        res.status(400).json({ error: "Esta orden no tiene un pago de Mercado Pago pendiente para reanudar." });
        return;
    }
    if (pago.estado !== "iniciado") {
        res.status(400).json({ error: `El pago de esta orden esta en estado '${pago.estado}'.` });
        return;
    }
    const payload = parseJsonField(pago.payload_json);
    const payloadRecord = payload && typeof payload === "object" && !Array.isArray(payload)
        ? payload
        : {};
    const preferenceId = firstNonEmptyString(payloadRecord.id, payloadRecord.preference_id);
    const qrData = firstNonEmptyString(payloadRecord.qr_data);
    const qrImage = firstNonEmptyString(payloadRecord.qr_image);
    const direccionEnvio = parseJsonField(orden.direccion_envio_json);
    const totalPuntosGanados = await (0, points_1.calcularPuntosPorMonto)(db_1.pool, Number(orden.total_dinero));
    res.json({
        orden_id: ordenId,
        estado: orden.estado,
        total_dinero: Number(orden.total_dinero),
        total_puntos_ganados: totalPuntosGanados,
        pago_pendiente: true,
        metodo_entrega: direccionEnvio ? "envio" : "retiro",
        pago: {
            proveedor: pago.proveedor,
            metodo: pago.metodo,
            estado: pago.estado,
            checkout_url: pago.checkout_url,
            preference_id: preferenceId,
            public_key: pago.metodo === "brick" ? (0, paymentProviders_1.getMercadoPagoPublicKey)() : null,
            qr_data: qrData,
            qr_image: qrImage,
            expires_at: null,
            provider_payment_id: pago.provider_payment_id,
            setup_status: "ready",
            setup_message: null,
        },
    });
});
router.get("/checkout/ordenes/:id/payment-status", async (req, res) => {
    const ordenId = Number(req.params.id);
    if (!Number.isInteger(ordenId) || ordenId <= 0) {
        res.status(400).json({ error: "ID de orden invalido." });
        return;
    }
    const conn = await db_1.pool.getConnection();
    let transactionOpen = false;
    try {
        const orden = await (0, db_1.qOne)(conn, `SELECT id, usuario_id, estado, total_dinero,
              (SELECT COALESCE(SUM(cantidad * puntaje_al_comprar_unitario), 0)
               FROM orden_items
               WHERE orden_id = ordenes.id AND modo_compra = 'dinero') AS total_puntos_ganados
       FROM ordenes
       WHERE id = ? AND usuario_id = ?
       LIMIT 1`, [ordenId, req.user.id]);
        if (!orden) {
            throw new HttpError(404, "Orden no encontrada.");
        }
        const totalPuntosGanados = await (0, points_1.calcularPuntosPorMonto)(conn, Number(orden.total_dinero ?? 0));
        const pago = await (0, db_1.qOne)(conn, `SELECT id, proveedor, metodo, estado, provider_payment_id, payload_json
       FROM pagos
       WHERE orden_id = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`, [ordenId]);
        if (!pago || !(orden.estado === "pendiente_pago" || orden.estado === "borrador")) {
            if (orden.estado === "pagada")
                queueOrderReceiptEmail(ordenId);
            res.json({
                ok: orden.estado === "pagada",
                orden_id: ordenId,
                estado: orden.estado,
                total_puntos_ganados: totalPuntosGanados,
                pago_estado: pago?.estado ?? null,
                provider_payment_id: pago?.provider_payment_id ?? null,
                status_detail: null,
            });
            return;
        }
        if (pago.proveedor !== "mercadopago" || pago.metodo !== "qr" || !pago.provider_payment_id) {
            res.json({
                ok: false,
                orden_id: ordenId,
                estado: orden.estado,
                total_puntos_ganados: totalPuntosGanados,
                pago_estado: pago.estado,
                provider_payment_id: pago.provider_payment_id,
                status_detail: null,
            });
            return;
        }
        const mpOrder = await (0, paymentProviders_1.getMercadoPagoQrOrder)(pago.provider_payment_id);
        const status = normalizeMercadoPagoStatus(mpOrder.status === "processed" ? "approved" : mpOrder.status);
        await conn.beginTransaction();
        transactionOpen = true;
        if (status === "approved") {
            const result = await (0, orderLifecycle_1.approvePaidOrder)(conn, {
                orderId: ordenId,
                provider: "mercadopago",
                providerPaymentId: mpOrder.providerPaymentId ?? pago.provider_payment_id,
                payload: {
                    qr_order_lookup: mpOrder.payload,
                },
            });
            await conn.commit();
            (0, realtime_1.emitRealtime)(["ordenes", "inventario", "productos", "stats", "puntos"]);
            transactionOpen = false;
            queueOrderReceiptEmail(ordenId);
            res.json({
                ok: true,
                orden_id: ordenId,
                estado: result.state,
                pago_estado: mpOrder.status,
                provider_payment_id: mpOrder.providerPaymentId ?? pago.provider_payment_id,
                status_detail: mpOrder.statusDetail,
            });
            return;
        }
        if (status === "rejected" || status === "expired") {
            const result = await (0, orderLifecycle_1.rejectOrExpirePendingOrder)(conn, {
                orderId: ordenId,
                nextState: status === "expired" ? "expirada" : "cancelada",
                provider: "mercadopago",
                providerPaymentId: mpOrder.providerPaymentId ?? pago.provider_payment_id,
                payload: {
                    qr_order_lookup: mpOrder.payload,
                },
            });
            await conn.commit();
            transactionOpen = false;
            res.json({
                ok: false,
                orden_id: ordenId,
                estado: result.state,
                pago_estado: mpOrder.status,
                provider_payment_id: mpOrder.providerPaymentId ?? pago.provider_payment_id,
                status_detail: mpOrder.statusDetail,
            });
            return;
        }
        await conn.commit();
        transactionOpen = false;
        res.json({
            ok: false,
            orden_id: ordenId,
            estado: orden.estado,
            pago_estado: mpOrder.status,
            provider_payment_id: mpOrder.providerPaymentId ?? pago.provider_payment_id,
            status_detail: mpOrder.statusDetail,
        });
    }
    catch (err) {
        if (transactionOpen) {
            await conn.rollback();
        }
        if (err instanceof HttpError) {
            res.status(err.status).json({ error: err.message });
            return;
        }
        const msg = err instanceof Error ? err.message : "No se pudo consultar el estado del pago.";
        res.status(400).json({ error: msg });
    }
    finally {
        conn.release();
    }
});
router.post("/checkout/mercadopago/confirm-return", async (req, res) => {
    const schema = zod_1.z.object({
        payment_id: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]).optional().nullable(),
        external_reference: zod_1.z.string().optional().nullable(),
        status: zod_1.z.string().optional().nullable(),
    });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0]?.message || "Datos de retorno invalidos." });
        return;
    }
    const externalReference = firstNonEmptyString(parsed.data.external_reference);
    const fallbackOrderId = parseOrderIdFromReference(externalReference);
    const hintedStatus = normalizeMercadoPagoStatus(parsed.data.status ?? null);
    const conn = await db_1.pool.getConnection();
    let transactionOpen = false;
    try {
        let paymentId = firstNonEmptyString(parsed.data.payment_id);
        if (!paymentId && fallbackOrderId) {
            const existingPayment = await (0, db_1.qOne)(conn, `SELECT p.provider_payment_id
         FROM ordenes o
         LEFT JOIN pagos p ON p.orden_id = o.id AND p.proveedor = 'mercadopago'
         WHERE o.id = ? AND o.usuario_id = ?
         ORDER BY p.updated_at DESC, p.id DESC
         LIMIT 1`, [fallbackOrderId, req.user.id]);
            paymentId = firstNonEmptyString(existingPayment?.provider_payment_id);
        }
        if (!paymentId && !fallbackOrderId) {
            throw new HttpError(400, "No pudimos identificar el pago devuelto por Mercado Pago.");
        }
        const payment = paymentId ? await (0, paymentProviders_1.getMercadoPagoPayment)(paymentId) : null;
        const resolvedOrderId = payment?.orderId ?? fallbackOrderId;
        const resolvedStatus = normalizeMercadoPagoStatus(payment?.status ?? hintedStatus);
        if (!resolvedOrderId) {
            throw new HttpError(400, "Mercado Pago no devolvio una referencia valida de la orden.");
        }
        await conn.beginTransaction();
        transactionOpen = true;
        const orden = await (0, db_1.qOne)(conn, `SELECT id, estado
       FROM ordenes
       WHERE id = ? AND usuario_id = ?
       LIMIT 1
       FOR UPDATE`, [resolvedOrderId, req.user.id]);
        if (!orden) {
            throw new HttpError(404, "Orden no encontrada.");
        }
        if (orden.estado === "pagada") {
            await conn.commit();
            transactionOpen = false;
            queueOrderReceiptEmail(resolvedOrderId);
            res.json({
                ok: true,
                orden_id: resolvedOrderId,
                estado: "pagada",
                already_paid: true,
                pago_estado: payment?.status ?? hintedStatus ?? "approved",
                provider_payment_id: payment?.providerPaymentId ?? paymentId ?? null,
                status_detail: payment?.statusDetail ?? null,
            });
            return;
        }
        if (!payment) {
            await conn.commit();
            transactionOpen = false;
            res.json({
                ok: false,
                orden_id: resolvedOrderId,
                estado: orden.estado,
                pago_estado: hintedStatus ?? "pending",
                provider_payment_id: paymentId ?? null,
                status_detail: null,
                pending_lookup: true,
            });
            return;
        }
        if (resolvedStatus === "approved") {
            const result = await (0, orderLifecycle_1.approvePaidOrder)(conn, {
                orderId: resolvedOrderId,
                provider: "mercadopago",
                providerPaymentId: payment?.providerPaymentId ?? paymentId ?? null,
                payload: {
                    return_params: parsed.data,
                    payment_lookup: payment?.payload ?? null,
                },
            });
            await conn.commit();
            transactionOpen = false;
            (0, realtime_1.emitRealtime)(["ordenes", "inventario", "productos", "stats", "puntos"]);
            queueOrderReceiptEmail(resolvedOrderId);
            res.json({
                ok: true,
                orden_id: resolvedOrderId,
                estado: result.state,
                pago_estado: "approved",
                provider_payment_id: payment?.providerPaymentId ?? paymentId ?? null,
                status_detail: payment?.statusDetail ?? null,
            });
            return;
        }
        if (resolvedStatus === "rejected" || resolvedStatus === "expired") {
            const result = await (0, orderLifecycle_1.rejectOrExpirePendingOrder)(conn, {
                orderId: resolvedOrderId,
                nextState: resolvedStatus === "expired" ? "expirada" : "cancelada",
                provider: "mercadopago",
                providerPaymentId: payment?.providerPaymentId ?? paymentId ?? null,
                payload: {
                    return_params: parsed.data,
                    payment_lookup: payment?.payload ?? null,
                },
            });
            await conn.commit();
            transactionOpen = false;
            res.json({
                ok: false,
                orden_id: resolvedOrderId,
                estado: result.state,
                pago_estado: payment?.status ?? hintedStatus ?? resolvedStatus,
                provider_payment_id: payment?.providerPaymentId ?? paymentId ?? null,
                status_detail: payment?.statusDetail ?? null,
            });
            return;
        }
        await conn.commit();
        transactionOpen = false;
        res.json({
            ok: false,
            orden_id: resolvedOrderId,
            estado: orden.estado,
            pago_estado: payment?.status ?? hintedStatus ?? "pending",
            provider_payment_id: payment?.providerPaymentId ?? paymentId ?? null,
            status_detail: payment?.statusDetail ?? null,
        });
    }
    catch (err) {
        if (transactionOpen) {
            await conn.rollback();
        }
        if (err instanceof HttpError) {
            res.status(err.status).json({ error: err.message });
            return;
        }
        const msg = err instanceof Error ? err.message : "No se pudo validar el retorno de Mercado Pago.";
        res.status(400).json({ error: msg });
    }
    finally {
        conn.release();
    }
});
router.get("/checkout/payment-options", async (_req, res) => {
    res.json({
        options: (0, paymentProviders_1.listPaymentOptions)(),
        default_option: "mercadopago_brick",
    });
});
router.get("/ordenes", async (req, res) => {
    const rows = await (0, db_1.qAll)(db_1.pool, `SELECT o.id, o.estado, o.tipo_orden, o.total_dinero, o.total_puntos, o.moneda,
            o.direccion_envio_json, o.sucursal_retiro_id, o.notas, o.created_at, o.updated_at,
            s.nombre AS sucursal_nombre, s.direccion AS sucursal_direccion,
            s.piso AS sucursal_piso, s.localidad AS sucursal_localidad, s.provincia AS sucursal_provincia
     FROM ordenes o
     LEFT JOIN sucursales s ON s.id = o.sucursal_retiro_id
     WHERE o.usuario_id = ?
     ORDER BY o.created_at DESC, o.id DESC`, [req.user.id]);
    if (!rows.length) {
        res.json([]);
        return;
    }
    const orderIds = rows.map((r) => Number(r.id));
    const placeholders = orderIds.map(() => "?").join(", ");
    const config = await getOrderReceiptConfig(db_1.pool);
    const itemRows = await (0, db_1.qAll)(db_1.pool, `SELECT oi.orden_id, COUNT(*) AS total_items, COALESCE(SUM(oi.cantidad),0) AS total_unidades
     FROM orden_items oi
     WHERE oi.orden_id IN (${placeholders})
     GROUP BY oi.orden_id`, orderIds);
    const orderItemsRows = await (0, db_1.qAll)(db_1.pool, `SELECT oi.id, oi.orden_id, oi.producto_id, oi.cantidad, oi.modo_compra,
            oi.precio_dinero_unit, oi.precio_puntos_unit, oi.subtotal_dinero, oi.subtotal_puntos,
            oi.puntaje_al_comprar_unitario,
            p.nombre, p.imagen_url, p.track_stock
     FROM orden_items oi
     JOIN productos p ON p.id = oi.producto_id
     WHERE oi.orden_id IN (${placeholders})
     ORDER BY oi.orden_id ASC, oi.id ASC`, orderIds);
    const paymentRows = await (0, db_1.qAll)(db_1.pool, `SELECT p.id, p.orden_id, p.proveedor, p.metodo, p.estado, p.monto, p.moneda,
            p.provider_payment_id, p.checkout_url, p.created_at, p.updated_at
     FROM pagos p
     JOIN (
       SELECT orden_id, MAX(id) AS latest_id
       FROM pagos
       WHERE orden_id IN (${placeholders})
       GROUP BY orden_id
     ) latest ON latest.latest_id = p.id`, orderIds);
    const summaryMap = new Map();
    const itemsMap = new Map();
    const paymentsMap = new Map();
    for (const row of itemRows) {
        summaryMap.set(Number(row.orden_id), {
            total_items: Number(row.total_items ?? 0),
            total_unidades: Number(row.total_unidades ?? 0),
        });
    }
    for (const row of orderItemsRows) {
        const list = itemsMap.get(Number(row.orden_id)) ?? [];
        list.push({
            ...row,
            orden_id: Number(row.orden_id),
            producto_id: Number(row.producto_id),
            cantidad: Number(row.cantidad),
            precio_dinero_unit: row.precio_dinero_unit === null ? null : Number(row.precio_dinero_unit),
            precio_puntos_unit: row.precio_puntos_unit === null ? null : Number(row.precio_puntos_unit),
            subtotal_dinero: Number(row.subtotal_dinero),
            subtotal_puntos: Number(row.subtotal_puntos),
            puntaje_al_comprar_unitario: row.puntaje_al_comprar_unitario === null ? null : Number(row.puntaje_al_comprar_unitario),
            track_stock: Number(row.track_stock ?? 0),
        });
        itemsMap.set(Number(row.orden_id), list);
    }
    for (const row of paymentRows) {
        paymentsMap.set(Number(row.orden_id), {
            ...row,
            orden_id: Number(row.orden_id),
            monto: Number(row.monto),
        });
    }
    res.json(rows.map((row) => {
        const sucursal = row.sucursal_retiro_id
            ? {
                id: Number(row.sucursal_retiro_id),
                nombre: row.sucursal_nombre,
                direccion: row.sucursal_direccion,
                piso: row.sucursal_piso,
                localidad: row.sucursal_localidad,
                provincia: row.sucursal_provincia,
            }
            : null;
        const pago = paymentsMap.get(Number(row.id)) ?? null;
        return {
            ...row,
            total_dinero: Number(row.total_dinero),
            total_puntos: Number(row.total_puntos),
            direccion_envio: parseJsonField(row.direccion_envio_json),
            sucursal,
            items: itemsMap.get(Number(row.id)) ?? [],
            pago,
            comprobante: buildOrderReceiptMeta(row, pago, config),
            ...(summaryMap.get(Number(row.id)) ?? { total_items: 0, total_unidades: 0 }),
        };
    }));
});
router.get("/ordenes/:id", async (req, res) => {
    const ordenId = Number(req.params.id);
    if (!Number.isFinite(ordenId) || ordenId <= 0) {
        res.status(400).json({ error: "ID de orden inválido." });
        return;
    }
    const orden = await (0, db_1.qOne)(db_1.pool, `SELECT o.id, o.estado, o.tipo_orden, o.total_dinero, o.total_puntos, o.moneda,
            o.direccion_envio_json, o.sucursal_retiro_id, o.notas, o.created_at, o.updated_at,
            s.nombre AS sucursal_nombre, s.direccion AS sucursal_direccion,
            s.piso AS sucursal_piso, s.localidad AS sucursal_localidad, s.provincia AS sucursal_provincia
     FROM ordenes o
     LEFT JOIN sucursales s ON s.id = o.sucursal_retiro_id
     WHERE o.id = ? AND o.usuario_id = ?
     LIMIT 1`, [ordenId, req.user.id]);
    if (!orden) {
        res.status(404).json({ error: "Orden no encontrada." });
        return;
    }
    const items = await getOrdenItems(db_1.pool, ordenId);
    const config = await getOrderReceiptConfig(db_1.pool);
    const totalPuntosGanados = await (0, points_1.calcularPuntosPorMonto)(db_1.pool, Number(orden.total_dinero ?? 0));
    const pago = await (0, db_1.qOne)(db_1.pool, `SELECT id, proveedor, metodo, estado, monto, moneda, provider_payment_id, checkout_url, created_at, updated_at
     FROM pagos
     WHERE orden_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT 1`, [ordenId]);
    res.json({
        ...orden,
        total_dinero: Number(orden.total_dinero),
        total_puntos: Number(orden.total_puntos),
        total_puntos_ganados: totalPuntosGanados,
        direccion_envio: parseJsonField(orden.direccion_envio_json),
        items,
        pago: pago
            ? {
                ...pago,
                monto: Number(pago.monto),
            }
            : null,
        comprobante: buildOrderReceiptMeta(orden, pago, config),
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
    });
});
router.post("/ordenes/:id/cancelar", async (req, res) => {
    const ordenId = Number(req.params.id);
    if (!Number.isFinite(ordenId) || ordenId <= 0) {
        res.status(400).json({ error: "ID de orden inválido." });
        return;
    }
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        const orden = await (0, db_1.qOne)(conn, `SELECT id, usuario_id, estado, total_puntos, sucursal_retiro_id
       FROM ordenes
       WHERE id = ? AND usuario_id = ?
       LIMIT 1
       FOR UPDATE`, [ordenId, req.user.id]);
        if (!orden) {
            throw new HttpError(404, "Orden no encontrada.");
        }
        if (!(orden.estado === "borrador" || orden.estado === "pendiente_pago" || orden.estado === "preparada")) {
            throw new HttpError(400, `No se puede cancelar una orden en estado '${orden.estado}'.`);
        }
        const result = await (0, orderLifecycle_1.rejectOrExpirePendingOrder)(conn, {
            orderId: ordenId,
            nextState: "cancelada",
            creadoPor: req.user.id
        });
        await conn.commit();
        (0, realtime_1.emitRealtime)(["ordenes", "inventario", "productos", "stats", "puntos"]);
        res.json({ ok: true, orden_id: ordenId, estado: "cancelada" });
    }
    catch (err) {
        await conn.rollback();
        if (err instanceof HttpError) {
            res.status(err.status).json({ error: err.message });
            return;
        }
        const msg = err instanceof Error ? err.message : "No se pudo cancelar la orden.";
        res.status(400).json({ error: msg });
    }
    finally {
        conn.release();
    }
});
router.post("/canjear-codigo", async (req, res) => {
    const schema = zod_1.z.object({ codigo: zod_1.z.string().min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: "Codigo requerido" });
        return;
    }
    const codigo = parsed.data.codigo.toUpperCase().trim();
    const usuarioId = req.user.id;
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        const c = await (0, db_1.qOne)(conn, "SELECT id, puntos_valor, usos_maximos, usos_actuales, fecha_expiracion, activo FROM codigos_puntos WHERE codigo = ?", [codigo]);
        if (!c) {
            await conn.rollback();
            res.status(404).json({ error: "Codigo no encontrado" });
            return;
        }
        if (!c.activo) {
            await conn.rollback();
            res.status(400).json({ error: "Codigo inactivo" });
            return;
        }
        if (c.fecha_expiracion && new Date(c.fecha_expiracion) < new Date()) {
            await conn.rollback();
            res.status(400).json({ error: "El codigo expiro" });
            return;
        }
        if (c.usos_maximos > 0 && c.usos_actuales >= c.usos_maximos) {
            await conn.rollback();
            res.status(400).json({ error: "El codigo ya alcanzo su limite de usos" });
            return;
        }
        const yaUsado = await (0, db_1.qOne)(conn, "SELECT id FROM usos_codigos WHERE codigo_id = ? AND usuario_id = ?", [c.id, usuarioId]);
        if (yaUsado) {
            await conn.rollback();
            res.status(400).json({ error: "Ya usaste este codigo" });
            return;
        }
        await (0, db_1.qRun)(conn, "INSERT INTO usos_codigos (codigo_id, usuario_id) VALUES (?, ?)", [c.id, usuarioId]);
        await (0, db_1.qRun)(conn, "UPDATE codigos_puntos SET usos_actuales = usos_actuales + 1 WHERE id = ?", [c.id]);
        await (0, points_1.registrarMovimientoPuntos)(conn, {
            usuarioId,
            tipo: 'codigo_canje',
            puntos: c.puntos_valor,
            descripcion: `Codigo canjeado: ${codigo}`,
            referenciaId: c.id,
            referenciaTipo: 'codigos_puntos'
        });
        await conn.commit();
        (0, realtime_1.emitRealtime)(["puntos"]);
        const updated = await (0, db_1.qOne)(db_1.pool, "SELECT puntos_saldo FROM usuarios WHERE id = ?", [usuarioId]);
        res.json({ ok: true, puntos_ganados: c.puntos_valor, nuevo_saldo: updated?.puntos_saldo });
    }
    catch (err) {
        await conn.rollback();
        throw err;
    }
    finally {
        conn.release();
    }
});
router.post("/canjear-carrito", async (req, res) => {
    const schema = zod_1.z.object({
        items: zod_1.z.array(zod_1.z.object({
            producto_id: zod_1.z.number().int().positive(),
            cantidad: zod_1.z.number().int().positive().max(purchaseLimits_1.MAX_SYSTEM_PURCHASE_QUANTITY),
        })).min(1).max(40),
        sucursal_id: zod_1.z.number().int().positive().optional().nullable(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0]?.message || "Carrito de canje invalido" });
        return;
    }
    const { items, sucursal_id } = parsed.data;
    const usuarioId = req.user.id;
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        const result = await crearCanjeCarrito(conn, {
            usuarioId,
            items,
            sucursalId: sucursal_id,
        });
        await conn.commit();
        (0, realtime_1.emitRealtime)(["canjes", "inventario", "productos", "stats", "puntos"]);
        res.status(201).json(result);
    }
    catch (err) {
        await conn.rollback();
        if (err instanceof HttpError) {
            res.status(err.status).json({
                error: err.message,
                ...(err.errorCode ? { error_code: err.errorCode } : {}),
            });
            return;
        }
        throw err;
    }
    finally {
        conn.release();
    }
});
router.post("/canjear-producto", async (req, res) => {
    const schema = zod_1.z.object({
        producto_id: zod_1.z.number().int().positive(),
        sucursal_id: zod_1.z.number().int().positive().optional().nullable(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: "producto_id requerido" });
        return;
    }
    const { producto_id, sucursal_id } = parsed.data;
    const usuarioId = req.user.id;
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        const result = await crearCanjeCarrito(conn, {
            usuarioId,
            items: [{ producto_id, cantidad: 1 }],
            sucursalId: sucursal_id,
        });
        await conn.commit();
        (0, realtime_1.emitRealtime)(["canjes", "inventario", "productos", "stats", "puntos"]);
        res.status(201).json(result);
    }
    catch (err) {
        await conn.rollback();
        if (err instanceof HttpError) {
            res.status(err.status).json({
                error: err.message,
                ...(err.errorCode ? { error_code: err.errorCode } : {}),
            });
            return;
        }
        throw err;
    }
    finally {
        conn.release();
    }
});
exports.default = router;
