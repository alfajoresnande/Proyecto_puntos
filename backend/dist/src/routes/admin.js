"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const multer_1 = __importDefault(require("multer"));
const uuid_1 = require("uuid");
const zod_1 = require("zod");
const db_1 = require("../db");
const auth_1 = require("../auth");
const urlSafety_1 = require("../urlSafety");
const securityMonitor_1 = require("../securityMonitor");
const uploadSecurity_1 = require("../uploadSecurity");
const backup_1 = require("../services/backup");
const stock_1 = require("../services/stock");
const DEFAULT_INVITE_CODE_LENGTH = 9;
const MIN_INVITE_CODE_LENGTH = 6;
const MAX_INVITE_CODE_LENGTH = 20;
const MINIMUM_ALLOWED_AGE_YEARS = 13;
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
// ── Configuración de multer para subida de imágenes ──────
const MIME_TO_EXT = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
};
const storage = multer_1.default.diskStorage({
    destination: path_1.default.join(__dirname, "../../uploads"),
    filename: (_req, file, cb) => {
        const ext = MIME_TO_EXT[file.mimetype];
        if (!ext)
            return cb(new Error("Tipo de archivo no permitido"), "");
        cb(null, `${(0, uuid_1.v4)()}-${Date.now()}${ext}`);
    },
});
const upload = (0, multer_1.default)({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB máx
    fileFilter: (_req, file, cb) => {
        if (MIME_TO_EXT[file.mimetype])
            cb(null, true);
        else
            cb(new Error("Solo se permiten imágenes JPG, PNG o WEBP"));
    },
});
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth, (0, auth_1.requireRole)("admin"));
const strongPasswordSchema = zod_1.z
    .string()
    .min(8, "La contrasena debe tener al menos 8 caracteres")
    .regex(/(?:.*\d){3,}/, "La contrasena debe incluir al menos 3 numeros")
    .regex(/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/, "La contrasena debe incluir al menos 1 caracter especial");
const sucursalSchema = zod_1.z.object({
    nombre: zod_1.z.string().min(2).max(120),
    direccion: zod_1.z.string().min(3).max(180),
    piso: zod_1.z.string().max(30).optional().nullable(),
    localidad: zod_1.z.string().min(2).max(120),
    provincia: zod_1.z.string().min(2).max(120),
});
function makeInviteCode(length) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from({ length }, () => chars[crypto_1.default.randomInt(chars.length)]).join("");
}
async function uniqueInviteCode(length) {
    while (true) {
        const code = makeInviteCode(length);
        const exists = await (0, db_1.qOne)(db_1.pool, "SELECT id FROM usuarios WHERE codigo_invitacion = ?", [code]);
        if (!exists)
            return code;
    }
}
async function getInviteCodeLength() {
    const row = await (0, db_1.qOne)(db_1.pool, "SELECT valor FROM configuracion WHERE clave = 'longitud_codigo_invitacion' LIMIT 1");
    const parsed = Number(row?.valor ?? DEFAULT_INVITE_CODE_LENGTH);
    if (!Number.isInteger(parsed))
        return DEFAULT_INVITE_CODE_LENGTH;
    return Math.max(MIN_INVITE_CODE_LENGTH, Math.min(MAX_INVITE_CODE_LENGTH, parsed));
}
function normalizeProductImages(imagenes, imagenUrlFallback) {
    const clean = (imagenes ?? [])
        .map((url) => (0, urlSafety_1.normalizeSafeImageUrl)(url))
        .filter((url) => Boolean(url))
        .slice(0, 3);
    if (clean.length > 0)
        return clean;
    const fallback = (0, urlSafety_1.normalizeSafeImageUrl)(imagenUrlFallback);
    if (fallback)
        return [fallback];
    return [];
}
async function replaceProductImages(conn, productoId, imagenes) {
    await (0, db_1.qRun)(conn, "DELETE FROM producto_imagenes WHERE producto_id = ?", [productoId]);
    for (let index = 0; index < imagenes.length; index += 1) {
        await (0, db_1.qRun)(conn, "INSERT INTO producto_imagenes (producto_id, imagen_url, orden) VALUES (?, ?, ?)", [productoId, imagenes[index], index + 1]);
    }
}
async function getCanjeItemsByCanjeIds(canjeIds) {
    const map = new Map();
    if (!canjeIds.length)
        return map;
    const placeholders = canjeIds.map(() => "?").join(", ");
    const rows = await (0, db_1.qAll)(db_1.pool, `SELECT ci.canje_id, ci.producto_id, p.nombre AS producto_nombre, p.imagen_url AS producto_imagen,
            ci.cantidad, ci.puntos_unitarios, ci.puntos_total
     FROM canje_items ci
     JOIN productos p ON p.id = ci.producto_id
     WHERE ci.canje_id IN (${placeholders})
     ORDER BY ci.canje_id ASC, ci.id ASC`, canjeIds);
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
async function getOrdenItemsByOrdenIds(orderIds) {
    const map = new Map();
    if (!orderIds.length)
        return map;
    const placeholders = orderIds.map(() => "?").join(", ");
    const rows = await (0, db_1.qAll)(db_1.pool, `SELECT oi.id, oi.orden_id, oi.producto_id, oi.cantidad, oi.modo_compra,
            oi.subtotal_dinero, oi.subtotal_puntos, p.nombre, p.track_stock
     FROM orden_items oi
     JOIN productos p ON p.id = oi.producto_id
     WHERE oi.orden_id IN (${placeholders})
     ORDER BY oi.orden_id ASC, oi.id ASC`, orderIds);
    const MINIMUM_ALLOWED_AGE_YEARS = 13;
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
    for (const row of rows) {
        const list = map.get(Number(row.orden_id)) ?? [];
        list.push({
            ...row,
            orden_id: Number(row.orden_id),
            producto_id: Number(row.producto_id),
            cantidad: Number(row.cantidad),
            subtotal_dinero: Number(row.subtotal_dinero),
            subtotal_puntos: Number(row.subtotal_puntos),
            track_stock: Number(row.track_stock ?? 0),
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
        (0, db_1.qOne)(db_1.pool, "SELECT COUNT(*) AS c FROM usuarios WHERE rol='cliente'"),
        (0, db_1.qOne)(db_1.pool, "SELECT COUNT(*) AS c FROM productos WHERE activo=1"),
        (0, db_1.qOne)(db_1.pool, "SELECT COUNT(*) AS c FROM codigos_puntos WHERE activo=1"),
        (0, db_1.qOne)(db_1.pool, "SELECT COUNT(*) AS c FROM canjes WHERE estado='pendiente'"),
        (0, db_1.qOne)(db_1.pool, "SELECT COALESCE(SUM(puntos),0) AS s FROM movimientos_puntos WHERE puntos > 0"),
    ]);
    res.json({
        clientes: clientes?.c ?? 0,
        productos: productos?.c ?? 0,
        codigos_activos: codigos?.c ?? 0,
        canjes_pendientes: canjesPend?.c ?? 0,
        puntos_emitidos: ptsEmitidos?.s ?? 0,
    });
});
router.get("/security/monitor", async (req, res) => {
    const requested = Number(req.query.limit ?? 50);
    const limit = Number.isFinite(requested) ? requested : 50;
    const snapshot = (0, securityMonitor_1.getSecurityMonitorSnapshot)();
    const persistidos = await (0, securityMonitor_1.getPersistedSecurityEvents)(limit);
    res.json({ ...snapshot, persistidos });
});
router.post("/backup/full", async (req, res) => {
    try {
        const backup = await (0, backup_1.createFullBackupArchive)();
        (0, securityMonitor_1.recordSecurityEvent)("backup_full_generado", req, {
            archivo: backup.fileName,
            tamano_bytes: backup.sizeBytes,
        });
        res.download(backup.archivePath, backup.fileName);
    }
    catch (error) {
        const internalMessage = error instanceof Error ? error.message : "No se pudo generar el backup";
        (0, securityMonitor_1.recordSecurityEvent)("backup_full_error", req, { error: internalMessage });
        res.status(500).json({ error: "No se pudo generar el backup en este momento" });
    }
});
// ════════════════════════════════════════════════════════
//  USUARIOS
// ════════════════════════════════════════════════════════
router.get("/usuarios", async (_req, res) => {
    const rows = await (0, db_1.qAll)(db_1.pool, "SELECT id, nombre, email, rol, dni, telefono, fecha_nacimiento, localidad, provincia, puntos_saldo, codigo_invitacion, activo, created_at FROM usuarios ORDER BY created_at DESC");
    res.json(rows);
});
router.post("/usuarios", async (req, res) => {
    const schema = zod_1.z.object({
        nombre: zod_1.z.string().min(1).max(100),
        email: zod_1.z.string().email(),
        password: strongPasswordSchema,
        rol: zod_1.z.enum(["cliente", "vendedor", "admin"]),
        dni: zod_1.z.string().min(6).optional(),
        fecha_nacimiento: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
        localidad: zod_1.z.string().min(2).max(120).optional().nullable(),
        provincia: zod_1.z.string().min(2).max(120).optional().nullable(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0].message });
        return;
    }
    const { nombre, email, password, rol, dni, fecha_nacimiento, localidad, provincia } = parsed.data;
    if (rol === "cliente" && !dni) {
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
        const hash = await bcryptjs_1.default.hash(password, 10);
        let codigo = null;
        if (rol === "cliente") {
            const longitud = await getInviteCodeLength();
            codigo = await uniqueInviteCode(longitud);
        }
        const { insertId } = await (0, db_1.qRun)(db_1.pool, `INSERT INTO usuarios (nombre, email, password_hash, rol, dni, telefono, fecha_nacimiento, localidad, provincia, codigo_invitacion)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`, [nombre, email, hash, rol, dni ?? null, fecha_nacimiento ?? null, localidad?.trim() || null, provincia?.trim() || null, codigo]);
        res.status(201).json({ id: insertId });
    }
    catch (err) {
        if (err.code === "ER_DUP_ENTRY") {
            res.status(409).json({ error: "Email o DNI ya registrado" });
            return;
        }
        throw err;
    }
});
router.put("/usuarios/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
        res.status(400).json({ error: "ID de usuario inválido" });
        return;
    }
    const schema = zod_1.z.object({
        nombre: zod_1.z.string().min(1).max(100),
        email: zod_1.z.string().email(),
        rol: zod_1.z.enum(["cliente", "vendedor", "admin"]),
        dni: zod_1.z.string().min(6).max(20).optional().nullable(),
        telefono: zod_1.z.string().max(25).optional().nullable(),
        fecha_nacimiento: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
        localidad: zod_1.z.string().min(2).max(120).optional().nullable(),
        provincia: zod_1.z.string().min(2).max(120).optional().nullable(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0].message });
        return;
    }
    const { nombre, email, rol, dni, telefono, fecha_nacimiento, localidad, provincia } = parsed.data;
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
        const { affectedRows } = await (0, db_1.qRun)(db_1.pool, `UPDATE usuarios
       SET nombre = ?, email = ?, rol = ?, dni = ?, telefono = ?, fecha_nacimiento = ?, localidad = ?, provincia = ?
        WHERE id = ?`, [
            nombre.trim(),
            email.trim().toLowerCase(),
            rol,
            dni?.trim() || null,
            telefono?.trim() || null,
            fecha_nacimiento ?? null,
            localidad?.trim() || null,
            provincia?.trim() || null,
            id,
        ]);
        if (affectedRows === 0) {
            res.status(404).json({ error: "Usuario no encontrado" });
            return;
        }
        res.json({ ok: true });
    }
    catch (err) {
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
    if (typeof activo !== "boolean") {
        res.status(400).json({ error: "activo debe ser boolean" });
        return;
    }
    await (0, db_1.qRun)(db_1.pool, "UPDATE usuarios SET activo = ? WHERE id = ?", [activo ? 1 : 0, id]);
    res.json({ ok: true });
});
// ════════════════════════════════════════════════════════
//  PUNTOS MANUALES
// ════════════════════════════════════════════════════════
router.post("/puntos", async (req, res) => {
    const schema = zod_1.z.object({
        usuario_id: zod_1.z.number().int().positive(),
        puntos: zod_1.z.number().int().refine((n) => n !== 0, "No puede ser 0"),
        descripcion: zod_1.z.string().max(255).optional(),
        tipo: zod_1.z.enum(["asignacion_manual", "ajuste"]).default("asignacion_manual"),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0].message });
        return;
    }
    const { usuario_id, puntos, descripcion, tipo } = parsed.data;
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        const userRow = await (0, db_1.qOne)(conn, "SELECT id, puntos_saldo FROM usuarios WHERE id = ? AND rol = 'cliente'", [usuario_id]);
        if (!userRow) {
            res.status(404).json({ error: "Cliente no encontrado" });
            return;
        }
        const nuevoSaldo = userRow.puntos_saldo + puntos;
        if (nuevoSaldo < 0) {
            res.status(400).json({ error: "El saldo no puede quedar negativo" });
            return;
        }
        await (0, db_1.qRun)(conn, `INSERT INTO movimientos_puntos (usuario_id, tipo, puntos, descripcion, creado_por) VALUES (?, ?, ?, ?, ?)`, [usuario_id, tipo, puntos, descripcion ?? null, req.user.id]);
        await (0, db_1.qRun)(conn, "UPDATE usuarios SET puntos_saldo = puntos_saldo + ? WHERE id = ?", [puntos, usuario_id]);
        await conn.commit();
        res.json({ ok: true, nuevo_saldo: nuevoSaldo });
    }
    catch (err) {
        await conn.rollback();
        throw err;
    }
    finally {
        conn.release();
    }
});
// ════════════════════════════════════════════════════════
//  CÓDIGOS DE PUNTOS
// ════════════════════════════════════════════════════════
router.get("/codigos", async (_req, res) => {
    const rows = await (0, db_1.qAll)(db_1.pool, `SELECT c.id, c.codigo, c.puntos_valor, c.usos_maximos, c.usos_actuales,
            c.fecha_expiracion, c.activo, c.created_at, u.nombre AS creado_por_nombre
     FROM codigos_puntos c JOIN usuarios u ON u.id = c.creado_por
     ORDER BY c.created_at DESC`);
    res.json(rows);
});
router.get("/codigos/:id/usos", async (req, res) => {
    const rows = await (0, db_1.qAll)(db_1.pool, `SELECT u.nombre, u.email, u.dni, uc.created_at AS usado_en
     FROM usos_codigos uc JOIN usuarios u ON u.id = uc.usuario_id
     WHERE uc.codigo_id = ? ORDER BY uc.created_at DESC`, [Number(req.params.id)]);
    res.json(rows);
});
router.post("/codigos", async (req, res) => {
    const schema = zod_1.z.object({
        codigo: zod_1.z.string().min(3).max(50).transform((s) => s.toUpperCase().trim()),
        puntos_valor: zod_1.z.number().int().positive(),
        usos_maximos: zod_1.z.number().int().min(0).default(1),
        fecha_expiracion: zod_1.z.string().datetime({ offset: true }).optional().nullable(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0].message });
        return;
    }
    const { codigo, puntos_valor, usos_maximos, fecha_expiracion } = parsed.data;
    let fechaExpMysql = null;
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
        const { insertId } = await (0, db_1.qRun)(db_1.pool, `INSERT INTO codigos_puntos (codigo, puntos_valor, usos_maximos, fecha_expiracion, creado_por)
       VALUES (?, ?, ?, ?, ?)`, [codigo, puntos_valor, usos_maximos, fechaExpMysql, req.user.id]);
        res.status(201).json({ id: insertId, codigo });
    }
    catch (err) {
        if (err.code === "ER_DUP_ENTRY") {
            res.status(409).json({ error: "Ya existe un código con ese nombre" });
            return;
        }
        console.error("POST /admin/codigos:", err);
        res.status(500).json({ error: "No se pudo crear el código" });
    }
});
router.patch("/codigos/:id", async (req, res) => {
    const id = Number(req.params.id);
    const { activo } = req.body;
    if (typeof activo !== "boolean") {
        res.status(400).json({ error: "activo (boolean) requerido" });
        return;
    }
    await (0, db_1.qRun)(db_1.pool, "UPDATE codigos_puntos SET activo = ? WHERE id = ?", [activo ? 1 : 0, id]);
    res.json({ ok: true });
});
// ════════════════════════════════════════════════════════
//  CANJES
// ════════════════════════════════════════════════════════
router.get("/canjes", async (_req, res) => {
    const rows = await (0, db_1.qAll)(db_1.pool, `SELECT c.id, c.codigo_retiro, c.puntos_usados, c.estado, c.fecha_limite_retiro, c.notas,
            c.created_at, c.updated_at,
            u.nombre AS cliente_nombre, u.email AS cliente_email, u.dni AS cliente_dni,
            p.nombre AS producto_nombre,
            s.id AS sucursal_id, s.nombre AS sucursal_nombre, s.direccion AS sucursal_direccion,
            s.piso AS sucursal_piso, s.localidad AS sucursal_localidad, s.provincia AS sucursal_provincia
     FROM canjes c
     JOIN usuarios u ON u.id = c.usuario_id
     JOIN productos p ON p.id = c.producto_id
     LEFT JOIN sucursales s ON s.id = c.sucursal_id
     ORDER BY c.created_at DESC`);
    if (!rows.length) {
        res.json([]);
        return;
    }
    const itemsMap = await getCanjeItemsByCanjeIds(rows.map((row) => Number(row.id)));
    const payload = rows.map((row) => {
        const fallbackItem = {
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
        const productoNombreVista = items.length > 1 ? `${primerItem.producto_nombre} +${items.length - 1} mas` : primerItem.producto_nombre;
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
    const schema = zod_1.z.object({
        estado: zod_1.z.enum(["pendiente", "entregado", "no_disponible", "expirado", "cancelado"]),
        notas: zod_1.z.string().max(1000).optional().nullable(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0].message });
        return;
    }
    const { estado, notas } = parsed.data;
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        const canje = await (0, db_1.qOne)(conn, "SELECT id, usuario_id, puntos_usados, estado, sucursal_id, producto_id FROM canjes WHERE id = ? FOR UPDATE", [id]);
        if (!canje) {
            res.status(404).json({ error: "Canje no encontrado" });
            return;
        }
        if (canje.estado === estado) {
            await conn.commit();
            res.json({ ok: true, unchanged: true });
            return;
        }
        if (canje.estado !== "pendiente") {
            res.status(400).json({ error: `No se puede modificar un canje en estado '${canje.estado}'` });
            return;
        }
        const canjeItems = await (0, stock_1.getCanjeItemsStock)(conn, id);
        const itemsForStock = canjeItems.length
            ? canjeItems
            : [{ producto_id: Number(canje.producto_id), cantidad: 1 }];
        if (Number(canje.sucursal_id) > 0) {
            if (estado === "entregado") {
                await (0, stock_1.finalizeReservedStockForCanje)(conn, {
                    sucursalId: Number(canje.sucursal_id),
                    items: itemsForStock,
                    canjeId: id,
                    creadoPor: req.user.id,
                });
            }
            else if (estado === "no_disponible" || estado === "cancelado" || estado === "expirado") {
                await (0, stock_1.releaseReservedStockForCanje)(conn, {
                    sucursalId: Number(canje.sucursal_id),
                    items: itemsForStock,
                    canjeId: id,
                    strict: false,
                    creadoPor: req.user.id,
                });
            }
        }
        await (0, db_1.qRun)(conn, "UPDATE canjes SET estado = ?, notas = ? WHERE id = ?", [estado, notas ?? null, id]);
        if (estado === "no_disponible" || estado === "cancelado") {
            const motivo = estado === "cancelado" ? "cancelado" : "no disponible";
            await (0, db_1.qRun)(conn, `INSERT INTO movimientos_puntos
           (usuario_id, tipo, puntos, descripcion, referencia_id, referencia_tipo, creado_por)
         VALUES (?, 'devolucion_canje', ?, ?, ?, 'canjes', ?)`, [canje.usuario_id, canje.puntos_usados, `Devolucion por canje ${motivo}`, id, req.user.id]);
            await (0, db_1.qRun)(conn, "UPDATE usuarios SET puntos_saldo = puntos_saldo + ? WHERE id = ?", [canje.puntos_usados, canje.usuario_id]);
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
// ════════════════════════════════════════════════════════
//  MOVIMIENTOS (historial global)
// ════════════════════════════════════════════════════════
router.get("/ordenes", async (_req, res) => {
    const rows = await (0, db_1.qAll)(db_1.pool, `SELECT o.id, o.usuario_id, u.nombre AS cliente_nombre, u.email AS cliente_email,
            o.estado, o.tipo_orden, o.total_dinero, o.total_puntos, o.moneda,
            o.sucursal_retiro_id, s.nombre AS sucursal_nombre, o.created_at, o.updated_at
     FROM ordenes o
     JOIN usuarios u ON u.id = o.usuario_id
     LEFT JOIN sucursales s ON s.id = o.sucursal_retiro_id
     ORDER BY o.created_at DESC, o.id DESC`);
    const orderIds = rows.map((row) => Number(row.id));
    const itemMap = await getOrdenItemsByOrdenIds(orderIds);
    const payments = orderIds.length
        ? await (0, db_1.qAll)(db_1.pool, `SELECT p.orden_id, p.estado, p.proveedor, p.metodo, p.monto, p.moneda
         FROM pagos p
         JOIN (
            SELECT orden_id, MAX(id) AS last_id
            FROM pagos
            WHERE orden_id IN (${orderIds.map(() => "?").join(", ")})
            GROUP BY orden_id
          ) latest ON latest.last_id = p.id`, orderIds)
        : [];
    const payMap = new Map();
    for (const payment of payments) {
        payMap.set(Number(payment.orden_id), {
            estado: payment.estado,
            proveedor: payment.proveedor,
            metodo: payment.metodo ?? null,
            monto: Number(payment.monto ?? 0),
            moneda: payment.moneda,
        });
    }
    res.json(rows.map((row) => {
        const items = itemMap.get(Number(row.id)) ?? [];
        return {
            ...row,
            total_dinero: Number(row.total_dinero ?? 0),
            total_puntos: Number(row.total_puntos ?? 0),
            total_items: items.length,
            total_unidades: items.reduce((acc, item) => acc + Number(item.cantidad), 0),
            pago: payMap.get(Number(row.id)) ?? null,
        };
    }));
});
router.patch("/ordenes/:id", async (req, res) => {
    const orderId = Number(req.params.id);
    if (!Number.isFinite(orderId) || orderId <= 0) {
        res.status(400).json({ error: "ID de orden invalido" });
        return;
    }
    const schema = zod_1.z.object({
        estado: zod_1.z.enum(["pendiente_pago", "pagada", "preparada", "entregada", "cancelada", "expirada"]),
        notas: zod_1.z.string().max(1000).optional().nullable(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0].message });
        return;
    }
    const { estado, notas } = parsed.data;
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        const orden = await (0, db_1.qOne)(conn, `SELECT id, usuario_id, estado, total_puntos, sucursal_retiro_id, total_dinero
       FROM ordenes
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`, [orderId]);
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
        const itemsByOrder = await (0, db_1.qAll)(conn, `SELECT oi.id, oi.orden_id, oi.producto_id, oi.cantidad, oi.modo_compra,
              oi.subtotal_dinero, oi.subtotal_puntos, p.nombre, p.track_stock
       FROM orden_items oi
       JOIN productos p ON p.id = oi.producto_id
       WHERE oi.orden_id = ?
       ORDER BY oi.id ASC`, [orderId]);
        if (orden.sucursal_retiro_id) {
            const stockItems = itemsByOrder
                .filter((item) => Number(item.track_stock ?? 0) === 1)
                .map((item) => ({
                producto_id: Number(item.producto_id),
                cantidad: Number(item.cantidad),
                origen: item.modo_compra === "dinero" ? "compra" : "canje",
                descripcion: `Orden #${orderId} -> ${estado}`,
            }));
            if (stockItems.length) {
                if (estado === "entregada") {
                    await (0, stock_1.finalizeStockForCheckoutItems)(conn, {
                        sucursalId: Number(orden.sucursal_retiro_id),
                        items: stockItems,
                        referencia: `orden #${orderId}`,
                        creadoPor: req.user.id,
                    });
                }
                else if (estado === "cancelada" || estado === "expirada") {
                    await (0, stock_1.releaseStockForCheckoutItems)(conn, {
                        sucursalId: Number(orden.sucursal_retiro_id),
                        items: stockItems,
                        referencia: `orden #${orderId}`,
                        creadoPor: req.user.id,
                    });
                }
            }
        }
        if ((estado === "cancelada" || estado === "expirada") && Number(orden.total_puntos ?? 0) > 0) {
            await (0, db_1.qRun)(conn, `INSERT INTO movimientos_puntos
          (usuario_id, tipo, puntos, descripcion, referencia_id, referencia_tipo, creado_por)
         VALUES (?, 'devolucion_canje', ?, ?, ?, 'ordenes', ?)`, [
                Number(orden.usuario_id),
                Number(orden.total_puntos),
                `Devolucion puntos por ${estado} orden #${orderId}`,
                orderId,
                req.user.id,
            ]);
            await (0, db_1.qRun)(conn, "UPDATE usuarios SET puntos_saldo = puntos_saldo + ? WHERE id = ?", [
                Number(orden.total_puntos),
                Number(orden.usuario_id),
            ]);
        }
        await (0, db_1.qRun)(conn, "UPDATE ordenes SET estado = ?, notas = COALESCE(?, notas) WHERE id = ?", [
            estado,
            notas ?? null,
            orderId,
        ]);
        if (Number(orden.total_dinero ?? 0) > 0) {
            if (estado === "pagada") {
                await (0, db_1.qRun)(conn, "UPDATE pagos SET estado = 'aprobado' WHERE orden_id = ? AND estado = 'iniciado'", [orderId]);
            }
            else if (estado === "cancelada" || estado === "expirada") {
                await (0, db_1.qRun)(conn, "UPDATE pagos SET estado = 'rechazado' WHERE orden_id = ? AND estado = 'iniciado'", [orderId]);
            }
        }
        await conn.commit();
        res.json({ ok: true });
    }
    catch (err) {
        await conn.rollback();
        res.status(400).json({ error: err?.message || "No se pudo actualizar la orden." });
    }
    finally {
        conn.release();
    }
});
router.get("/movimientos", async (_req, res) => {
    const rows = await (0, db_1.qAll)(db_1.pool, `SELECT m.id, m.tipo, m.puntos, m.descripcion, m.referencia_tipo, m.created_at,
            u.nombre AS usuario_nombre, u.email AS usuario_email,
            a.nombre AS admin_nombre
     FROM movimientos_puntos m
     JOIN usuarios u ON u.id = m.usuario_id
     LEFT JOIN usuarios a ON a.id = m.creado_por
     ORDER BY m.created_at DESC LIMIT 500`);
    res.json(rows);
});
// ════════════════════════════════════════════════════════
//  PRODUCTOS (ABM completo)
// ════════════════════════════════════════════════════════
router.get("/productos", async (_req, res) => {
    const rows = await (0, db_1.qAll)(db_1.pool, `SELECT id, nombre, sku, descripcion, imagen_url, categoria, tipo_producto,
            precio_dinero, precio_puntos, puntos_para_canjear, stock_disponible, stock_reservado,
            track_stock, permite_envio, permite_retiro_local,
            puntos_requeridos, puntos_acumulables, puntaje_al_comprar, activo, created_at
     FROM productos
     ORDER BY created_at DESC`);
    if (!rows.length) {
        res.json([]);
        return;
    }
    const ids = rows.map((row) => row.id);
    const placeholders = ids.map(() => "?").join(", ");
    const imageRows = await (0, db_1.qAll)(db_1.pool, `SELECT producto_id, imagen_url, orden
     FROM producto_imagenes
     WHERE producto_id IN (${placeholders})
     ORDER BY producto_id ASC, orden ASC`, ids);
    const imageMap = new Map();
    for (const image of imageRows) {
        const current = imageMap.get(image.producto_id) ?? [];
        current.push(image.imagen_url);
        imageMap.set(image.producto_id, current);
    }
    res.json(rows.map((row) => {
        const imagenes = normalizeProductImages(imageMap.get(row.id), row.imagen_url);
        return {
            ...row,
            activo: Boolean(row.activo),
            track_stock: Boolean(row.track_stock),
            permite_envio: Boolean(row.permite_envio),
            permite_retiro_local: Boolean(row.permite_retiro_local),
            imagenes,
            imagen_url: imagenes[0] ?? null,
        };
    }));
});
// POST /admin/productos/upload — recibe imagen y devuelve la URL pública
router.post("/productos/upload", (req, res, next) => {
    upload.single("imagen")(req, res, async (err) => {
        if (err) {
            res.status(400).json({ error: err.message });
            return;
        }
        if (!req.file) {
            res.status(400).json({ error: "No se recibió ningún archivo" });
            return;
        }
        const check = await (0, uploadSecurity_1.verifyUploadedImageFile)(req.file);
        if (!check.ok) {
            (0, securityMonitor_1.recordSecurityEvent)("upload_bloqueado_firma_invalida", req, {
                mimeDeclarado: req.file.mimetype,
                mimeDetectado: check.detectedMime,
            });
            res.status(400).json({ error: "Archivo de imagen inválido" });
            return;
        }
        res.json({ url: `/uploads/${req.file.filename}` });
    });
});
router.post("/productos", async (req, res) => {
    const schema = zod_1.z.object({
        nombre: zod_1.z.string().min(1).max(150),
        sku: zod_1.z.string().max(64).optional().nullable(),
        descripcion: zod_1.z.string().max(1000).optional().nullable(),
        imagen_url: zod_1.z.string().min(1).optional().nullable(),
        imagenes: zod_1.z.array(zod_1.z.string().min(1)).max(3).optional().nullable(),
        categoria: zod_1.z.string().max(100).optional().nullable(),
        tipo_producto: zod_1.z.enum(["canje", "venta", "mixto"]).optional(),
        precio_dinero: zod_1.z.number().positive().optional().nullable(),
        precio_puntos: zod_1.z.number().int().positive().optional().nullable(),
        puntos_para_canjear: zod_1.z.number().int().positive().optional().nullable(),
        puntos_requeridos: zod_1.z.number().int().min(0).optional().nullable(),
        puntos_acumulables: zod_1.z.number().int().positive().optional().nullable(),
        puntaje_al_comprar: zod_1.z.number().int().positive().optional().nullable(),
        stock_disponible: zod_1.z.number().int().min(0).optional(),
        track_stock: zod_1.z.boolean().optional(),
        permite_envio: zod_1.z.boolean().optional(),
        permite_retiro_local: zod_1.z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0].message });
        return;
    }
    const { nombre, sku, descripcion, imagen_url, imagenes, categoria, tipo_producto, precio_dinero, precio_puntos, puntos_para_canjear, puntos_requeridos, puntos_acumulables, puntaje_al_comprar, stock_disponible, track_stock, permite_envio, permite_retiro_local, } = parsed.data;
    const imageUrls = normalizeProductImages(imagenes, imagen_url);
    const tipoProducto = tipo_producto ?? "canje";
    const precioPuntosFinal = puntos_para_canjear ?? precio_puntos ?? puntos_requeridos ?? null;
    const puntosRequeridosLegacy = precioPuntosFinal ?? 0;
    const precioDineroFinal = precio_dinero ?? null;
    const puntajeComprarFinal = puntaje_al_comprar ?? puntos_acumulables ?? null;
    if ((tipoProducto === "canje" || tipoProducto === "mixto") && (!precioPuntosFinal || precioPuntosFinal <= 0)) {
        res.status(400).json({ error: "Debes indicar un precio de puntos valido para canje/mixto." });
        return;
    }
    if ((tipoProducto === "venta" || tipoProducto === "mixto") && (!precioDineroFinal || precioDineroFinal <= 0)) {
        res.status(400).json({ error: "Debes indicar un precio en dinero valido para venta/mixto." });
        return;
    }
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        const { insertId } = await (0, db_1.qRun)(conn, `INSERT INTO productos
        (nombre, sku, descripcion, imagen_url, categoria, tipo_producto,
         precio_dinero, precio_puntos, puntos_para_canjear, puntos_requeridos, puntos_acumulables, puntaje_al_comprar,
         stock_disponible, stock_reservado, track_stock, permite_envio, permite_retiro_local)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`, [
            nombre,
            sku?.trim() || null,
            descripcion ?? null,
            imageUrls[0] ?? null,
            categoria ?? null,
            tipoProducto,
            precioDineroFinal,
            precioPuntosFinal,
            precioPuntosFinal,
            puntosRequeridosLegacy,
            puntos_acumulables ?? null,
            puntajeComprarFinal,
            stock_disponible ?? 0,
            track_stock === undefined ? 1 : (track_stock ? 1 : 0),
            permite_envio ? 1 : 0,
            permite_retiro_local === undefined ? 1 : (permite_retiro_local ? 1 : 0),
        ]);
        await replaceProductImages(conn, insertId, imageUrls);
        await conn.commit();
        res.status(201).json({ id: insertId });
    }
    catch (error) {
        await conn.rollback();
        throw error;
    }
    finally {
        conn.release();
    }
});
router.put("/productos/:id", async (req, res) => {
    const id = Number(req.params.id);
    const schema = zod_1.z.object({
        nombre: zod_1.z.string().min(1).max(150),
        sku: zod_1.z.string().max(64).optional().nullable(),
        descripcion: zod_1.z.string().max(1000).optional().nullable(),
        imagen_url: zod_1.z.string().min(1).optional().nullable(),
        imagenes: zod_1.z.array(zod_1.z.string().min(1)).max(3).optional().nullable(),
        categoria: zod_1.z.string().max(100).optional().nullable(),
        tipo_producto: zod_1.z.enum(["canje", "venta", "mixto"]).optional(),
        precio_dinero: zod_1.z.number().positive().optional().nullable(),
        precio_puntos: zod_1.z.number().int().positive().optional().nullable(),
        puntos_para_canjear: zod_1.z.number().int().positive().optional().nullable(),
        puntos_requeridos: zod_1.z.number().int().min(0).optional().nullable(),
        puntos_acumulables: zod_1.z.number().int().positive().optional().nullable(),
        puntaje_al_comprar: zod_1.z.number().int().positive().optional().nullable(),
        stock_disponible: zod_1.z.number().int().min(0).optional(),
        track_stock: zod_1.z.boolean().optional(),
        permite_envio: zod_1.z.boolean().optional(),
        permite_retiro_local: zod_1.z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0].message });
        return;
    }
    const { nombre, sku, descripcion, imagen_url, imagenes, categoria, tipo_producto, precio_dinero, precio_puntos, puntos_para_canjear, puntos_requeridos, puntos_acumulables, puntaje_al_comprar, stock_disponible, track_stock, permite_envio, permite_retiro_local, } = parsed.data;
    const imageUrls = normalizeProductImages(imagenes, imagen_url);
    const tipoProducto = tipo_producto ?? "canje";
    const precioPuntosFinal = puntos_para_canjear ?? precio_puntos ?? puntos_requeridos ?? null;
    const puntosRequeridosLegacy = precioPuntosFinal ?? 0;
    const precioDineroFinal = precio_dinero ?? null;
    const puntajeComprarFinal = puntaje_al_comprar ?? puntos_acumulables ?? null;
    if ((tipoProducto === "canje" || tipoProducto === "mixto") && (!precioPuntosFinal || precioPuntosFinal <= 0)) {
        res.status(400).json({ error: "Debes indicar un precio de puntos valido para canje/mixto." });
        return;
    }
    if ((tipoProducto === "venta" || tipoProducto === "mixto") && (!precioDineroFinal || precioDineroFinal <= 0)) {
        res.status(400).json({ error: "Debes indicar un precio en dinero valido para venta/mixto." });
        return;
    }
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        const { affectedRows } = await (0, db_1.qRun)(conn, `UPDATE productos
       SET nombre=?, sku=?, descripcion=?, imagen_url=?, categoria=?, tipo_producto=?,
           precio_dinero=?, precio_puntos=?, puntos_para_canjear=?, puntos_requeridos=?, puntos_acumulables=?, puntaje_al_comprar=?,
           stock_disponible=?, track_stock=?, permite_envio=?, permite_retiro_local=?
       WHERE id=?`, [
            nombre,
            sku?.trim() || null,
            descripcion ?? null,
            imageUrls[0] ?? null,
            categoria ?? null,
            tipoProducto,
            precioDineroFinal,
            precioPuntosFinal,
            precioPuntosFinal,
            puntosRequeridosLegacy,
            puntos_acumulables ?? null,
            puntajeComprarFinal,
            stock_disponible ?? 0,
            track_stock === undefined ? 1 : (track_stock ? 1 : 0),
            permite_envio ? 1 : 0,
            permite_retiro_local === undefined ? 1 : (permite_retiro_local ? 1 : 0),
            id,
        ]);
        if (affectedRows === 0) {
            await conn.rollback();
            res.status(404).json({ error: "Producto no encontrado" });
            return;
        }
        await replaceProductImages(conn, id, imageUrls);
        await conn.commit();
        res.json({ ok: true });
    }
    catch (error) {
        await conn.rollback();
        throw error;
    }
    finally {
        conn.release();
    }
});
router.patch("/productos/:id/activo", async (req, res) => {
    const id = Number(req.params.id);
    const { activo } = req.body;
    if (typeof activo !== "boolean") {
        res.status(400).json({ error: "activo debe ser boolean" });
        return;
    }
    await (0, db_1.qRun)(db_1.pool, "UPDATE productos SET activo = ? WHERE id = ?", [activo ? 1 : 0, id]);
    res.json({ ok: true });
});
// ════════════════════════════════════════════════════════
//  CATEGORÍAS (ABM)
// ════════════════════════════════════════════════════════
router.get("/categorias", async (_req, res) => {
    const rows = await (0, db_1.qAll)(db_1.pool, "SELECT id, nombre, created_at FROM categorias ORDER BY nombre ASC");
    res.json(rows);
});
router.post("/categorias", async (req, res) => {
    const schema = zod_1.z.object({ nombre: zod_1.z.string().min(1).max(100) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0].message });
        return;
    }
    try {
        const { insertId } = await (0, db_1.qRun)(db_1.pool, "INSERT INTO categorias (nombre) VALUES (?)", [parsed.data.nombre]);
        res.status(201).json({ id: insertId });
    }
    catch (err) {
        if (err.code === "ER_DUP_ENTRY") {
            res.status(409).json({ error: "Ya existe una categoría con ese nombre" });
            return;
        }
        throw err;
    }
});
router.put("/categorias/:id", async (req, res) => {
    const id = Number(req.params.id);
    const schema = zod_1.z.object({ nombre: zod_1.z.string().min(1).max(100) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0].message });
        return;
    }
    try {
        const { affectedRows } = await (0, db_1.qRun)(db_1.pool, "UPDATE categorias SET nombre=? WHERE id=?", [parsed.data.nombre, id]);
        if (affectedRows === 0) {
            res.status(404).json({ error: "Categoría no encontrada" });
            return;
        }
        res.json({ ok: true });
    }
    catch (err) {
        if (err.code === "ER_DUP_ENTRY") {
            res.status(409).json({ error: "Ya existe otra categoría con ese nombre" });
            return;
        }
        throw err;
    }
});
// ════════════════════════════════════════════════════════
//  CONFIGURACIÓN
// ════════════════════════════════════════════════════════
router.get("/sucursales", async (_req, res) => {
    const rows = await (0, db_1.qAll)(db_1.pool, `SELECT id, nombre, direccion, piso, localidad, provincia, activo, created_at, updated_at
     FROM sucursales
     ORDER BY activo DESC, nombre ASC, id ASC`);
    res.json(rows);
});
router.post("/sucursales", async (req, res) => {
    const parsed = sucursalSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0].message });
        return;
    }
    const { nombre, direccion, piso, localidad, provincia } = parsed.data;
    const { insertId } = await (0, db_1.qRun)(db_1.pool, `INSERT INTO sucursales (nombre, direccion, piso, localidad, provincia, activo)
     VALUES (?, ?, ?, ?, ?, 1)`, [nombre.trim(), direccion.trim(), piso?.trim() || null, localidad.trim(), provincia.trim()]);
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
    const { affectedRows } = await (0, db_1.qRun)(db_1.pool, `UPDATE sucursales
     SET nombre = ?, direccion = ?, piso = ?, localidad = ?, provincia = ?
     WHERE id = ?`, [nombre.trim(), direccion.trim(), piso?.trim() || null, localidad.trim(), provincia.trim(), id]);
    if (affectedRows === 0) {
        res.status(404).json({ error: "Sucursal no encontrada" });
        return;
    }
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
        const totalActivas = await (0, db_1.qOne)(db_1.pool, "SELECT COUNT(*) AS c FROM sucursales WHERE activo = 1 AND id <> ?", [id]);
        if (Number(totalActivas?.c ?? 0) <= 0) {
            res.status(400).json({ error: "Debe quedar al menos una sucursal activa." });
            return;
        }
    }
    const { affectedRows } = await (0, db_1.qRun)(db_1.pool, "UPDATE sucursales SET activo = ? WHERE id = ?", [activo ? 1 : 0, id]);
    if (affectedRows === 0) {
        res.status(404).json({ error: "Sucursal no encontrada" });
        return;
    }
    res.json({ ok: true });
});
router.get("/inventario", async (req, res) => {
    const productoId = Number(req.query.producto_id ?? 0);
    const sucursalId = Number(req.query.sucursal_id ?? 0);
    const conditions = [];
    const params = [];
    if (Number.isFinite(productoId) && productoId > 0) {
        conditions.push("i.producto_id = ?");
        params.push(productoId);
    }
    if (Number.isFinite(sucursalId) && sucursalId > 0) {
        conditions.push("i.sucursal_id = ?");
        params.push(sucursalId);
    }
    const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = await (0, db_1.qAll)(db_1.pool, `SELECT i.id, i.producto_id, p.nombre AS producto_nombre, p.sku, p.tipo_producto,
            i.sucursal_id, s.nombre AS sucursal_nombre,
            i.stock_disponible, i.stock_reservado, i.updated_at
     FROM inventario_sucursal i
     JOIN productos p ON p.id = i.producto_id
     JOIN sucursales s ON s.id = i.sucursal_id
     ${whereSql}
     ORDER BY p.nombre ASC, s.nombre ASC`, params);
    res.json(rows);
});
router.patch("/inventario/ajuste", async (req, res) => {
    const schema = zod_1.z.object({
        producto_id: zod_1.z.number().int().positive(),
        sucursal_id: zod_1.z.number().int().positive(),
        nuevo_stock_disponible: zod_1.z.number().int().min(0),
        descripcion: zod_1.z.string().max(255).optional().nullable(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0].message });
        return;
    }
    const { producto_id, sucursal_id, nuevo_stock_disponible, descripcion } = parsed.data;
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        await (0, stock_1.adjustStockBySucursal)(conn, {
            productoId: producto_id,
            sucursalId: sucursal_id,
            nuevoStockDisponible: nuevo_stock_disponible,
            descripcion: descripcion ?? null,
            creadoPor: req.user.id,
        });
        await conn.commit();
        res.json({ ok: true });
    }
    catch (err) {
        await conn.rollback();
        res.status(400).json({ error: err?.message || "No se pudo ajustar el inventario." });
    }
    finally {
        conn.release();
    }
});
router.get("/configuracion", async (_req, res) => {
    const rows = await (0, db_1.qAll)(db_1.pool, "SELECT clave, valor, descripcion FROM configuracion");
    res.json(rows);
});
router.put("/configuracion/:clave", async (req, res) => {
    const { clave } = req.params;
    const { valor, descripcion } = req.body;
    if (valor === undefined || valor === null) {
        res.status(400).json({ error: "valor requerido" });
        return;
    }
    await (0, db_1.qRun)(db_1.pool, `INSERT INTO configuracion (clave, valor, descripcion)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       valor = VALUES(valor),
       descripcion = COALESCE(NULLIF(VALUES(descripcion), ''), configuracion.descripcion)`, [clave, String(valor), typeof descripcion === "string" ? descripcion : null]);
    res.json({ ok: true });
});
// ════════════════════════════════════════════════════════
//  PÁGINAS DE CONTENIDO (Sobre Nosotros, Términos, etc.)
// ════════════════════════════════════════════════════════
router.get("/paginas", async (_req, res) => {
    const rows = await (0, db_1.qAll)(db_1.pool, "SELECT slug, titulo, updated_at FROM paginas_contenido");
    res.json(rows);
});
router.get("/paginas/:slug", async (req, res) => {
    const page = await (0, db_1.qOne)(db_1.pool, "SELECT slug, titulo, contenido, updated_at FROM paginas_contenido WHERE slug = ?", [req.params.slug]);
    if (!page) {
        res.status(404).json({ error: "Página no encontrada" });
        return;
    }
    res.json(page);
});
router.put("/paginas/:slug", async (req, res) => {
    const schema = zod_1.z.object({
        titulo: zod_1.z.string().min(1).max(200),
        contenido: zod_1.z.string().min(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0].message });
        return;
    }
    const { titulo, contenido } = parsed.data;
    const { affectedRows } = await (0, db_1.qRun)(db_1.pool, "UPDATE paginas_contenido SET titulo = ?, contenido = ? WHERE slug = ?", [titulo, contenido, req.params.slug]);
    if (affectedRows === 0) {
        res.status(404).json({ error: "Página no encontrada" });
        return;
    }
    res.json({ ok: true });
});
exports.default = router;
