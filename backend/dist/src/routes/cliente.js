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
const stock_1 = require("../services/stock");
const paymentProviders_1 = require("../services/paymentProviders");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth, (0, auth_1.requireRole)("cliente"));
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
        return ["nombre", "email", "dni"];
    const missing = [];
    if (!perfil.nombre || !perfil.nombre.trim())
        missing.push("nombre");
    if (!perfil.email || !perfil.email.includes("@"))
        missing.push("email");
    if (!perfil.dni || perfil.dni.trim().length < 6)
        missing.push("dni");
    if (!perfil.fecha_nacimiento)
        missing.push("fecha_nacimiento");
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
    const perfil = await (0, db_1.qOne)(db_1.pool, "SELECT id, nombre, email, dni, fecha_nacimiento, localidad, provincia FROM usuarios WHERE id = ?", [usuarioId]);
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
    const producto = await (0, db_1.qOne)(conn, `SELECT id, nombre, activo, tipo_producto, precio_dinero,
            COALESCE(puntos_para_canjear, precio_puntos, puntos_requeridos) AS precio_puntos_effectivo,
            track_stock, imagen_url
     FROM productos
     WHERE id = ?
     LIMIT 1`, [productoId]);
    if (!producto)
        throw new HttpError(404, "Producto no encontrado.");
    return {
        ...producto,
        activo: Number(producto.activo ?? 0),
        precio_dinero: producto.precio_dinero === null ? null : Number(producto.precio_dinero),
        precio_puntos_effectivo: producto.precio_puntos_effectivo === null ? null : Number(producto.precio_puntos_effectivo),
        track_stock: Number(producto.track_stock ?? 0),
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
async function getCarritoItems(conn, usuarioId) {
    const rows = await (0, db_1.qAll)(conn, `SELECT ci.id, ci.carrito_id, ci.producto_id, ci.cantidad, ci.modo_compra,
            ci.precio_dinero_unit, ci.precio_puntos_unit, ci.subtotal_dinero, ci.subtotal_puntos,
            p.nombre, p.tipo_producto, p.imagen_url, p.track_stock
     FROM carrito_items ci
     JOIN carritos c ON c.id = ci.carrito_id
     JOIN productos p ON p.id = ci.producto_id
     WHERE c.usuario_id = ? AND c.estado = 'activo'
     ORDER BY ci.created_at ASC, ci.id ASC`, [usuarioId]);
    return rows.map((row) => ({
        ...row,
        carrito_id: Number(row.carrito_id),
        producto_id: Number(row.producto_id),
        cantidad: Number(row.cantidad),
        precio_dinero_unit: row.precio_dinero_unit === null ? null : Number(row.precio_dinero_unit),
        precio_puntos_unit: row.precio_puntos_unit === null ? null : Number(row.precio_puntos_unit),
        subtotal_dinero: Number(row.subtotal_dinero),
        subtotal_puntos: Number(row.subtotal_puntos),
        track_stock: Number(row.track_stock ?? 0),
    }));
}
async function getOrdenItems(conn, ordenId) {
    const rows = await (0, db_1.qAll)(conn, `SELECT oi.id, oi.orden_id, oi.producto_id, oi.cantidad, oi.modo_compra,
            oi.precio_dinero_unit, oi.precio_puntos_unit, oi.subtotal_dinero, oi.subtotal_puntos,
            p.nombre, p.imagen_url, p.track_stock
     FROM orden_items oi
     JOIN productos p ON p.id = oi.producto_id
     WHERE oi.orden_id = ?
     ORDER BY oi.id ASC`, [ordenId]);
    return rows.map((row) => ({
        ...row,
        orden_id: Number(row.orden_id),
        producto_id: Number(row.producto_id),
        cantidad: Number(row.cantidad),
        precio_dinero_unit: row.precio_dinero_unit === null ? null : Number(row.precio_dinero_unit),
        precio_puntos_unit: row.precio_puntos_unit === null ? null : Number(row.precio_puntos_unit),
        subtotal_dinero: Number(row.subtotal_dinero),
        subtotal_puntos: Number(row.subtotal_puntos),
        track_stock: Number(row.track_stock ?? 0),
    }));
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
        const message = error instanceof Error ? error.message : "No se pudo reservar stock para el canje.";
        throw new HttpError(400, message);
    }
    const descripcionItems = itemsDetalle.map((item) => `${item.producto_nombre} x${item.cantidad}`).join(", ");
    const descripcionMovimiento = descripcionItems.length > 210 ? `Canje carrito: ${descripcionItems.slice(0, 207)}...` : `Canje carrito: ${descripcionItems}`;
    await (0, db_1.qRun)(conn, `INSERT INTO movimientos_puntos (usuario_id, tipo, puntos, descripcion, referencia_id, referencia_tipo)
     VALUES (?, 'canje_producto', ?, ?, ?, 'canjes')`, [usuarioId, -puntosTotales, descripcionMovimiento, canjeId]);
    await (0, db_1.qRun)(conn, "UPDATE usuarios SET puntos_saldo = puntos_saldo - ? WHERE id = ?", [puntosTotales, usuarioId]);
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
    const user = await (0, db_1.qOne)(db_1.pool, "SELECT id, nombre, email, dni, telefono, fecha_nacimiento, localidad, provincia, puntos_saldo, codigo_invitacion, referido_por FROM usuarios WHERE id = ?", [req.user.id]);
    res.json(user);
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
        const updated = await (0, db_1.qOne)(conn, "SELECT id, nombre, email, rol, dni, telefono, fecha_nacimiento, localidad, provincia, puntos_saldo, codigo_invitacion, referido_por FROM usuarios WHERE id = ?", [usuarioId]);
        await conn.commit();
        res.json({ ok: true, user: updated });
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
        await (0, db_1.qRun)(conn, `INSERT INTO movimientos_puntos (usuario_id, tipo, puntos, descripcion, referencia_id, referencia_tipo)
       VALUES (?, 'referido_invitador', ?, ?, ?, 'referidos')`, [invitador.id, pointsInvitador, `${usuario.nombre || "Un cliente"} uso tu codigo de invitacion`, refId]);
        await (0, db_1.qRun)(conn, `INSERT INTO movimientos_puntos (usuario_id, tipo, puntos, descripcion, referencia_id, referencia_tipo)
       VALUES (?, 'referido_invitado', ?, ?, ?, 'referidos')`, [usuarioId, pointsInvitado, `Bono por usar el codigo de ${invitador.nombre}`, refId]);
        await (0, db_1.qRun)(conn, "UPDATE usuarios SET puntos_saldo = puntos_saldo + ? WHERE id = ?", [pointsInvitador, invitador.id]);
        await (0, db_1.qRun)(conn, "UPDATE usuarios SET puntos_saldo = puntos_saldo + ? WHERE id = ?", [pointsInvitado, usuarioId]);
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
router.get("/movimientos", async (req, res) => {
    const rows = await (0, db_1.qAll)(db_1.pool, `SELECT id, tipo, puntos, descripcion, referencia_tipo, created_at
     FROM movimientos_puntos WHERE usuario_id = ?
     ORDER BY created_at DESC LIMIT 100`, [req.user.id]);
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
router.get("/sucursales", async (_req, res) => {
    const rows = await (0, db_1.qAll)(db_1.pool, `SELECT id, nombre, direccion, piso, localidad, provincia
     FROM sucursales
     WHERE activo = 1
     ORDER BY nombre ASC, id ASC`);
    res.json(rows);
});
router.get("/carrito", async (req, res) => {
    const items = await getCarritoItems(db_1.pool, req.user.id);
    const totalDinero = toMoney(items.reduce((acc, item) => acc + Number(item.subtotal_dinero || 0), 0));
    const totalPuntos = items.reduce((acc, item) => acc + Number(item.subtotal_puntos || 0), 0);
    const totalUnidades = items.reduce((acc, item) => acc + Number(item.cantidad || 0), 0);
    res.json({
        items,
        resumen: {
            total_items: items.length,
            total_unidades: totalUnidades,
            total_dinero: totalDinero,
            total_puntos: totalPuntos,
        },
    });
});
router.post("/carrito/items", async (req, res) => {
    const schema = zod_1.z.object({
        producto_id: zod_1.z.number().int().positive(),
        cantidad: zod_1.z.number().int().positive().max(100),
        modo_compra: zod_1.z.enum(["dinero", "puntos"]),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0].message });
        return;
    }
    const { producto_id, cantidad, modo_compra } = parsed.data;
    const usuarioId = req.user.id;
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        const carritoId = await ensureActiveCart(conn, usuarioId);
        const producto = await getProductoForCart(conn, producto_id);
        validateProductoForMode(producto, modo_compra);
        const existente = await (0, db_1.qOne)(conn, `SELECT id, cantidad
       FROM carrito_items
       WHERE carrito_id = ? AND producto_id = ? AND modo_compra = ?
       LIMIT 1`, [carritoId, producto_id, modo_compra]);
        const nuevaCantidad = Number(existente?.cantidad ?? 0) + cantidad;
        if (nuevaCantidad > 200) {
            throw new HttpError(400, "No puedes agregar más de 200 unidades del mismo producto por modo.");
        }
        const precioDineroUnit = modo_compra === "dinero" ? Number(producto.precio_dinero ?? 0) : null;
        const precioPuntosUnit = modo_compra === "puntos" ? Number(producto.precio_puntos_effectivo ?? 0) : null;
        const subtotalDinero = toMoney((precioDineroUnit ?? 0) * nuevaCantidad);
        const subtotalPuntos = (precioPuntosUnit ?? 0) * nuevaCantidad;
        if (existente?.id) {
            await (0, db_1.qRun)(conn, `UPDATE carrito_items
         SET cantidad = ?, precio_dinero_unit = ?, precio_puntos_unit = ?,
             subtotal_dinero = ?, subtotal_puntos = ?
         WHERE id = ?`, [nuevaCantidad, precioDineroUnit, precioPuntosUnit, subtotalDinero, subtotalPuntos, Number(existente.id)]);
        }
        else {
            await (0, db_1.qRun)(conn, `INSERT INTO carrito_items
          (carrito_id, producto_id, cantidad, modo_compra, precio_dinero_unit, precio_puntos_unit, subtotal_dinero, subtotal_puntos)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [carritoId, producto_id, nuevaCantidad, modo_compra, precioDineroUnit, precioPuntosUnit, subtotalDinero, subtotalPuntos]);
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
        cantidad: zod_1.z.number().int().positive().max(200),
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
        const item = await (0, db_1.qOne)(conn, `SELECT ci.id, ci.carrito_id, ci.producto_id, ci.modo_compra
       FROM carrito_items ci
       JOIN carritos c ON c.id = ci.carrito_id
       WHERE ci.id = ? AND c.usuario_id = ? AND c.estado = 'activo'
       LIMIT 1`, [itemId, req.user.id]);
        if (!item) {
            await conn.rollback();
            res.status(404).json({ error: "Item de carrito no encontrado." });
            return;
        }
        const producto = await getProductoForCart(conn, Number(item.producto_id));
        validateProductoForMode(producto, item.modo_compra);
        const precioDineroUnit = item.modo_compra === "dinero" ? Number(producto.precio_dinero ?? 0) : null;
        const precioPuntosUnit = item.modo_compra === "puntos" ? Number(producto.precio_puntos_effectivo ?? 0) : null;
        const subtotalDinero = toMoney((precioDineroUnit ?? 0) * parsed.data.cantidad);
        const subtotalPuntos = (precioPuntosUnit ?? 0) * parsed.data.cantidad;
        await (0, db_1.qRun)(conn, `UPDATE carrito_items
       SET cantidad = ?, precio_dinero_unit = ?, precio_puntos_unit = ?,
           subtotal_dinero = ?, subtotal_puntos = ?
       WHERE id = ?`, [parsed.data.cantidad, precioDineroUnit, precioPuntosUnit, subtotalDinero, subtotalPuntos, itemId]);
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
router.post("/checkout/preview", async (req, res) => {
    const schema = zod_1.z.object({
        sucursal_id: zod_1.z.number().int().positive().optional().nullable(),
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
        const items = await getCarritoItems(conn, req.user.id);
        if (!items.length) {
            res.status(400).json({ error: "Tu carrito está vacío." });
            return;
        }
        const usuario = await (0, db_1.qOne)(conn, "SELECT puntos_saldo FROM usuarios WHERE id = ?", [req.user.id]);
        const saldoPuntos = Number(usuario?.puntos_saldo ?? 0);
        const sucursalSeleccionada = await resolveSucursalSeleccionada(conn, parsed.data.sucursal_id ?? null);
        const requiereStock = items.some((item) => Number(item.track_stock) === 1);
        if (requiereStock && !sucursalSeleccionada) {
            throw new HttpError(400, "Debes seleccionar una sucursal para validar stock.");
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
                    stockIssues.push(`${item.nombre}: solicitaste ${item.cantidad}, disponible ${stockDisponibleSucursal} en ${sucursalSeleccionada.nombre}.`);
                }
            }
            const precioDineroUnit = item.modo_compra === "dinero" ? Number(producto.precio_dinero ?? 0) : null;
            const precioPuntosUnit = item.modo_compra === "puntos" ? Number(producto.precio_puntos_effectivo ?? 0) : null;
            const subtotalDinero = toMoney((precioDineroUnit ?? 0) * item.cantidad);
            const subtotalPuntos = (precioPuntosUnit ?? 0) * item.cantidad;
            itemsEvaluados.push({
                ...item,
                precio_dinero_unit: precioDineroUnit,
                precio_puntos_unit: precioPuntosUnit,
                subtotal_dinero: subtotalDinero,
                subtotal_puntos: subtotalPuntos,
                stock_disponible_sucursal: stockDisponibleSucursal,
            });
        }
        const totalDinero = toMoney(itemsEvaluados.reduce((acc, item) => acc + Number(item.subtotal_dinero || 0), 0));
        const totalPuntos = itemsEvaluados.reduce((acc, item) => acc + Number(item.subtotal_puntos || 0), 0);
        const totalUnidades = itemsEvaluados.reduce((acc, item) => acc + Number(item.cantidad || 0), 0);
        const puntosOk = saldoPuntos >= totalPuntos;
        const stockOk = stockIssues.length === 0;
        res.json({
            carrito_id: carritoId,
            items: itemsEvaluados,
            sucursal: sucursalSeleccionada
                ? {
                    ...sucursalSeleccionada,
                    label: buildLugarRetiro(sucursalSeleccionada),
                }
                : null,
            resumen: {
                total_items: itemsEvaluados.length,
                total_unidades: totalUnidades,
                total_dinero: totalDinero,
                total_puntos: totalPuntos,
            },
            validaciones: {
                puntos_ok: puntosOk,
                stock_ok: stockOk,
                saldo_puntos_actual: saldoPuntos,
                puntos_faltantes: Math.max(0, totalPuntos - saldoPuntos),
                errores_stock: stockIssues,
            },
            puede_confirmar: puntosOk && stockOk,
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
        notas: zod_1.z.string().max(500).optional().nullable(),
        pago: zod_1.z.object({
            provider: zod_1.z.enum(["mercadopago", "pagos360"]),
            method: zod_1.z.enum(["wallet", "qr", "credit_card", "debit_card"]).optional(),
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
        const items = await getCarritoItems(conn, req.user.id);
        if (!items.length) {
            throw new HttpError(400, "Tu carrito está vacío.");
        }
        const usuario = await (0, db_1.qOne)(conn, "SELECT nombre, email, puntos_saldo FROM usuarios WHERE id = ? FOR UPDATE", [req.user.id]);
        const saldoPuntos = Number(usuario?.puntos_saldo ?? 0);
        const sucursalSeleccionada = await resolveSucursalSeleccionada(conn, parsed.data.sucursal_id ?? null);
        const requiereStock = items.some((item) => Number(item.track_stock) === 1);
        if (requiereStock && !sucursalSeleccionada) {
            throw new HttpError(400, "Debes seleccionar una sucursal para confirmar la orden.");
        }
        const itemsNormalizados = [];
        for (const item of items) {
            const producto = await getProductoForCart(conn, Number(item.producto_id));
            validateProductoForMode(producto, item.modo_compra);
            const precioDineroUnit = item.modo_compra === "dinero" ? Number(producto.precio_dinero ?? 0) : null;
            const precioPuntosUnit = item.modo_compra === "puntos" ? Number(producto.precio_puntos_effectivo ?? 0) : null;
            itemsNormalizados.push({
                producto_id: Number(item.producto_id),
                cantidad: Number(item.cantidad),
                modo_compra: item.modo_compra,
                precio_dinero_unit: precioDineroUnit,
                precio_puntos_unit: precioPuntosUnit,
                subtotal_dinero: toMoney((precioDineroUnit ?? 0) * Number(item.cantidad)),
                subtotal_puntos: (precioPuntosUnit ?? 0) * Number(item.cantidad),
                track_stock: Number(item.track_stock ?? 0),
                nombre: item.nombre,
            });
        }
        const totalDinero = toMoney(itemsNormalizados.reduce((acc, item) => acc + item.subtotal_dinero, 0));
        const totalPuntos = itemsNormalizados.reduce((acc, item) => acc + item.subtotal_puntos, 0);
        const paymentChoice = totalDinero > 0 ? (0, paymentProviders_1.resolvePaymentChoice)(parsed.data.pago ?? null) : null;
        if (saldoPuntos < totalPuntos) {
            throw new HttpError(400, `Puntos insuficientes. Tenés ${saldoPuntos}, necesitás ${totalPuntos}.`);
        }
        if (paymentChoice) {
            const availability = (0, paymentProviders_1.isPaymentChoiceAvailable)(paymentChoice);
            if (!availability.ok) {
                throw new HttpError(400, availability.reason || "Medio de pago no disponible.");
            }
        }
        if (sucursalSeleccionada) {
            await (0, stock_1.reserveStockForCheckoutItems)(conn, {
                sucursalId: sucursalSeleccionada.id,
                items: itemsNormalizados
                    .filter((item) => item.track_stock === 1)
                    .map((item) => ({
                    producto_id: item.producto_id,
                    cantidad: item.cantidad,
                    origen: item.modo_compra === "dinero" ? "compra" : "canje",
                    descripcion: `Reserva checkout cliente #${req.user.id}`,
                })),
                referencia: `checkout carrito #${carritoId}`,
                creadoPor: req.user.id,
            });
        }
        const tipoOrden = totalDinero > 0 && totalPuntos > 0 ? "mixta"
            : totalDinero > 0 ? "venta"
                : "canje";
        const estadoOrden = totalDinero > 0 ? "pendiente_pago" : "preparada";
        const { insertId: ordenId } = await (0, db_1.qRun)(conn, `INSERT INTO ordenes
        (usuario_id, carrito_id, canal, tipo_orden, estado, moneda, total_dinero, total_puntos, sucursal_retiro_id, notas)
       VALUES (?, ?, 'web', ?, ?, 'ARS', ?, ?, ?, ?)`, [
            req.user.id,
            carritoId,
            tipoOrden,
            estadoOrden,
            totalDinero,
            totalPuntos,
            sucursalSeleccionada?.id ?? null,
            parsed.data.notas ?? null,
        ]);
        for (const item of itemsNormalizados) {
            await (0, db_1.qRun)(conn, `INSERT INTO orden_items
          (orden_id, producto_id, cantidad, modo_compra, precio_dinero_unit, precio_puntos_unit, subtotal_dinero, subtotal_puntos)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
                ordenId,
                item.producto_id,
                item.cantidad,
                item.modo_compra,
                item.precio_dinero_unit,
                item.precio_puntos_unit,
                item.subtotal_dinero,
                item.subtotal_puntos,
            ]);
        }
        if (totalPuntos > 0) {
            await (0, db_1.qRun)(conn, `INSERT INTO movimientos_puntos
          (usuario_id, tipo, puntos, descripcion, referencia_id, referencia_tipo)
         VALUES (?, 'canje_producto', ?, ?, ?, 'ordenes')`, [req.user.id, -totalPuntos, `Checkout carrito #${carritoId}`, ordenId]);
            await (0, db_1.qRun)(conn, "UPDATE usuarios SET puntos_saldo = puntos_saldo - ? WHERE id = ?", [totalPuntos, req.user.id]);
        }
        let checkoutUrl = null;
        let paymentStatus = null;
        let paymentMessage = null;
        let paymentProvider = null;
        let paymentMethod = null;
        let paymentProviderId = null;
        if (totalDinero > 0) {
            const choice = paymentChoice ?? { provider: "mercadopago", method: "wallet" };
            const paymentSession = await (0, paymentProviders_1.createPaymentSession)({
                choice,
                orderId: Number(ordenId),
                amount: totalDinero,
                currency: "ARS",
                buyerName: usuario?.nombre || `Cliente #${req.user.id}`,
                buyerEmail: usuario?.email || "",
                description: `Pedido #${ordenId}`,
            });
            await (0, db_1.qRun)(conn, `INSERT INTO pagos (orden_id, proveedor, metodo, estado, monto, moneda, provider_payment_id, checkout_url, payload_json)
         VALUES (?, ?, ?, 'iniciado', ?, 'ARS', ?, ?, ?)`, [
                ordenId,
                choice.provider,
                choice.method,
                totalDinero,
                paymentSession.providerPaymentId,
                paymentSession.checkoutUrl,
                paymentSession.payload ? JSON.stringify(paymentSession.payload) : null,
            ]);
            checkoutUrl = paymentSession.checkoutUrl;
            paymentStatus = paymentSession.status;
            paymentMessage = paymentSession.message;
            paymentProvider = choice.provider;
            paymentMethod = choice.method;
            paymentProviderId = paymentSession.providerPaymentId;
        }
        await (0, db_1.qRun)(conn, "UPDATE carritos SET estado = 'convertido' WHERE id = ?", [carritoId]);
        await conn.commit();
        res.status(201).json({
            ok: true,
            orden_id: ordenId,
            estado: estadoOrden,
            tipo_orden: tipoOrden,
            total_dinero: totalDinero,
            total_puntos: totalPuntos,
            pago_pendiente: totalDinero > 0,
            pago: totalDinero > 0 ? {
                proveedor: paymentProvider,
                metodo: paymentMethod,
                estado: "iniciado",
                checkout_url: checkoutUrl,
                provider_payment_id: paymentProviderId,
                setup_status: paymentStatus,
                setup_message: paymentMessage,
            } : null,
            nuevo_saldo_puntos: saldoPuntos - totalPuntos,
            sucursal: sucursalSeleccionada
                ? {
                    ...sucursalSeleccionada,
                    label: buildLugarRetiro(sucursalSeleccionada),
                }
                : null,
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
        const msg = err instanceof Error ? err.message : "No se pudo confirmar el checkout.";
        res.status(400).json({ error: msg });
    }
    finally {
        conn.release();
    }
});
router.get("/checkout/payment-options", async (_req, res) => {
    res.json({
        options: (0, paymentProviders_1.listPaymentOptions)(),
        default_option: "mercadopago_wallet",
    });
});
router.get("/ordenes", async (req, res) => {
    const rows = await (0, db_1.qAll)(db_1.pool, `SELECT o.id, o.estado, o.tipo_orden, o.total_dinero, o.total_puntos, o.moneda,
            o.sucursal_retiro_id, o.notas, o.created_at, o.updated_at,
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
    const itemRows = await (0, db_1.qAll)(db_1.pool, `SELECT oi.orden_id, COUNT(*) AS total_items, COALESCE(SUM(oi.cantidad),0) AS total_unidades
     FROM orden_items oi
     WHERE oi.orden_id IN (${placeholders})
     GROUP BY oi.orden_id`, orderIds);
    const summaryMap = new Map();
    for (const row of itemRows) {
        summaryMap.set(Number(row.orden_id), {
            total_items: Number(row.total_items ?? 0),
            total_unidades: Number(row.total_unidades ?? 0),
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
        return {
            ...row,
            total_dinero: Number(row.total_dinero),
            total_puntos: Number(row.total_puntos),
            sucursal,
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
            o.sucursal_retiro_id, o.notas, o.created_at, o.updated_at,
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
    const pago = await (0, db_1.qOne)(db_1.pool, `SELECT id, proveedor, metodo, estado, monto, moneda, provider_payment_id, checkout_url, created_at, updated_at
     FROM pagos
     WHERE orden_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT 1`, [ordenId]);
    res.json({
        ...orden,
        total_dinero: Number(orden.total_dinero),
        total_puntos: Number(orden.total_puntos),
        items,
        pago: pago
            ? {
                ...pago,
                monto: Number(pago.monto),
            }
            : null,
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
        if (!(orden.estado === "pendiente_pago" || orden.estado === "preparada")) {
            throw new HttpError(400, `No se puede cancelar una orden en estado '${orden.estado}'.`);
        }
        const items = await getOrdenItems(conn, ordenId);
        if (orden.sucursal_retiro_id && items.length) {
            await (0, stock_1.releaseStockForCheckoutItems)(conn, {
                sucursalId: Number(orden.sucursal_retiro_id),
                items: items
                    .filter((item) => Number(item.track_stock) === 1)
                    .map((item) => ({
                    producto_id: Number(item.producto_id),
                    cantidad: Number(item.cantidad),
                    origen: item.modo_compra === "dinero" ? "compra" : "canje",
                    descripcion: `Cancelación de orden #${ordenId}`,
                })),
                referencia: `cancelación orden #${ordenId}`,
                creadoPor: req.user.id,
            });
        }
        const totalPuntos = Number(orden.total_puntos ?? 0);
        if (totalPuntos > 0) {
            await (0, db_1.qRun)(conn, `INSERT INTO movimientos_puntos
          (usuario_id, tipo, puntos, descripcion, referencia_id, referencia_tipo)
         VALUES (?, 'devolucion_canje', ?, ?, ?, 'ordenes')`, [req.user.id, totalPuntos, `Devolucion por cancelacion orden #${ordenId}`, ordenId]);
            await (0, db_1.qRun)(conn, "UPDATE usuarios SET puntos_saldo = puntos_saldo + ? WHERE id = ?", [totalPuntos, req.user.id]);
        }
        await (0, db_1.qRun)(conn, "UPDATE ordenes SET estado = 'cancelada' WHERE id = ?", [ordenId]);
        await (0, db_1.qRun)(conn, "UPDATE pagos SET estado = 'rechazado' WHERE orden_id = ? AND estado IN ('iniciado')", [ordenId]);
        await conn.commit();
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
        await (0, db_1.qRun)(conn, `INSERT INTO movimientos_puntos (usuario_id, tipo, puntos, descripcion, referencia_id, referencia_tipo)
       VALUES (?, 'codigo_canje', ?, ?, ?, 'codigos_puntos')`, [usuarioId, c.puntos_valor, `Codigo canjeado: ${codigo}`, c.id]);
        await (0, db_1.qRun)(conn, "UPDATE usuarios SET puntos_saldo = puntos_saldo + ? WHERE id = ?", [c.puntos_valor, usuarioId]);
        await conn.commit();
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
            cantidad: zod_1.z.number().int().positive().max(100),
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
