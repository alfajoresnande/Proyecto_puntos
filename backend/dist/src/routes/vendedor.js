"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../db");
const auth_1 = require("../auth");
const realtime_1 = require("../realtime");
const cashRegister_1 = require("../services/cashRegister");
const customerPricing_1 = require("../services/customerPricing");
const points_1 = require("../services/points");
const orderLifecycle_1 = require("../services/orderLifecycle");
const email_1 = require("../services/email");
const localSales_1 = require("../services/localSales");
const supportNotifications_1 = require("../services/supportNotifications");
const shippingZones_1 = require("../services/shippingZones");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth, (0, auth_1.requireRole)("vendedor", "admin", "superAdmin"));
function queueOrderReceiptEmail(orderId) {
    void (0, email_1.sendOrderReceiptEmail)(orderId).catch((err) => {
        console.error(`[MAIL] Error enviando comprobante orden #${orderId}:`, err instanceof Error ? err.message : err);
    });
}
const dniManualSchema = zod_1.z
    .string()
    .trim()
    .regex(/^\d{6,10}$/, "El DNI manual debe tener solo numeros y entre 6 y 10 digitos.");
const telefonoManualSchema = zod_1.z
    .string()
    .trim()
    .max(25)
    .refine((value) => value === "" || /^[0-9+()\-\s]+$/.test(value), {
    message: "El telefono manual solo puede contener numeros, espacios, +, guiones o parentesis.",
})
    .refine((value) => {
    if (value === "")
        return true;
    const digits = value.replace(/\D/g, "");
    return digits.length >= 6 && digits.length <= 15;
}, "El telefono manual debe tener entre 6 y 15 numeros.");
const clienteLocalPayloadSchema = zod_1.z.object({
    nombre: zod_1.z.string().min(2).max(120),
    dni: dniManualSchema,
    telefono: telefonoManualSchema.optional().nullable(),
});
const cajaAperturaSchema = zod_1.z.object({
    sucursal_id: zod_1.z.number().int().positive(),
    monto_apertura: zod_1.z.number().min(0),
    observaciones: zod_1.z.string().max(2000).optional().nullable(),
});
const cajaCierreSchema = zod_1.z.object({
    monto_cierre_declarado: zod_1.z.number().min(0),
    observaciones: zod_1.z.string().max(2000).optional().nullable(),
});
const gastoSchema = zod_1.z.object({
    sucursal_id: zod_1.z.number().int().positive(),
    proveedor_id: zod_1.z.number().int().positive().optional().nullable(),
    tercero_nombre: zod_1.z.string().max(160).optional().nullable(),
    categoria: zod_1.z.string().min(2).max(120),
    descripcion: zod_1.z.string().min(2).max(255),
    medio_pago: zod_1.z.enum(["cash", "transferencia", "tarjeta", "qr", "otro"]).default("cash"),
    monto: zod_1.z.number().positive(),
    fecha_gasto: zod_1.z.string().datetime().optional().nullable(),
    notas: zod_1.z.string().max(2000).optional().nullable(),
});
const envioZonaSchema = zod_1.z.object({
    nombre: zod_1.z.string().min(1).max(120),
    descripcion: zod_1.z.string().max(1000).optional().nullable(),
    precio: zod_1.z.coerce.number(),
    prioridad: zod_1.z.coerce.number().int().optional().nullable(),
    color: zod_1.z.string().max(16).optional().nullable(),
    polygon_geojson: zod_1.z.unknown().refine((value) => value !== undefined && value !== null, {
        message: "El poligono de la zona es obligatorio.",
    }),
    activo: zod_1.z.boolean().optional().nullable(),
});
const proveedorSchema = zod_1.z.object({
    nombre: zod_1.z.string().min(2).max(160),
    contacto: zod_1.z.string().max(160).optional().nullable(),
    telefono: zod_1.z.string().max(25).optional().nullable(),
    email: zod_1.z.string().email().max(160).optional().nullable().or(zod_1.z.literal("")),
    notas: zod_1.z.string().max(2000).optional().nullable(),
});
const cancelacionUrgenteOrdenSchema = zod_1.z.object({
    motivo: zod_1.z.string().trim().min(8).max(1000),
    mensaje_devolucion: zod_1.z.string().trim().max(1000).optional().nullable(),
});
async function getCajaSesionPayload(conn, sessionId) {
    const session = await (0, db_1.qOne)(conn, `SELECT cs.id, cs.sucursal_id, s.nombre AS sucursal_nombre,
            cs.usuario_id, u.nombre AS usuario_nombre,
            cs.fecha_operativa, cs.estado, cs.monto_apertura, cs.monto_cierre_sistema,
            cs.monto_cierre_declarado, cs.diferencia_cierre, cs.observaciones_apertura,
            cs.observaciones_cierre, cs.apertura_at, cs.cierre_at
     FROM caja_sesiones cs
     JOIN sucursales s ON s.id = cs.sucursal_id
     JOIN usuarios u ON u.id = cs.usuario_id
     WHERE cs.id = ?
     LIMIT 1`, [sessionId]);
    if (!session)
        return null;
    const summary = await (0, cashRegister_1.getCajaSesionSummary)(conn, sessionId);
    return {
        ...session,
        fecha_operativa: (0, cashRegister_1.formatCashDateStamp)(session.fecha_operativa),
        monto_apertura: Number(session.monto_apertura ?? 0),
        monto_cierre_sistema: session.monto_cierre_sistema === null ? null : Number(session.monto_cierre_sistema),
        monto_cierre_declarado: session.monto_cierre_declarado === null ? null : Number(session.monto_cierre_declarado),
        diferencia_cierre: session.diferencia_cierre === null ? null : Number(session.diferencia_cierre),
        summary,
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
    const rows = await (0, db_1.qAll)(db_1.pool, `SELECT oi.id, oi.orden_id, oi.producto_id, oi.cantidad, oi.modo_compra,
            oi.precio_dinero_unit, oi.puntaje_al_comprar_unitario,
            oi.subtotal_dinero, oi.subtotal_puntos, p.nombre, p.track_stock
     FROM orden_items oi
     JOIN productos p ON p.id = oi.producto_id
     WHERE oi.orden_id IN (${orderIds.map(() => "?").join(", ")})
     ORDER BY oi.orden_id ASC, oi.id ASC`, orderIds);
    const flavorMap = new Map();
    if (rows.length) {
        const itemIds = rows.map((row) => Number(row.id));
        const itemPlaceholders = itemIds.map(() => "?").join(", ");
        const flavorRows = await (0, db_1.qAll)(db_1.pool, `SELECT orden_item_id, sabor_id, sabor_nombre, cantidad
       FROM orden_item_sabores
       WHERE orden_item_id IN (${itemPlaceholders})
       ORDER BY orden_item_id ASC, id ASC`, itemIds);
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
        const cliente = await (0, db_1.qOne)(db_1.pool, "SELECT id, nombre, dni, email, puntos_saldo AS puntos FROM usuarios WHERE dni = ? AND rol = 'cliente'", [req.params.dni]);
        if (!cliente) {
            res.status(404).json({ error: "Cliente no encontrado" });
            return;
        }
        res.json(cliente);
    }
    catch (err) {
        next(err);
    }
});
// Buscar clientes por nombre o DNI (real-time search)
router.get("/clientes/buscar", async (req, res, next) => {
    try {
        const q = req.query.q;
        if (!q || typeof q !== "string") {
            return res.json([]);
        }
        const cleanQ = q.trim();
        if (cleanQ.length < 2) {
            return res.json([]);
        }
        const term = `%${cleanQ}%`;
        const rows = await (0, db_1.qAll)(db_1.pool, `SELECT id, nombre, dni, email, puntos_saldo AS puntos, tipo_cliente, descuento_porcentaje
       FROM usuarios 
       WHERE rol = 'cliente' 
         AND (nombre LIKE ? OR dni LIKE ?)
       LIMIT 10`, [term, term]);
        res.json(rows);
    }
    catch (err) {
        next(err);
    }
});
// Cargar puntos usando productos del catálogo como referencia
router.get("/productos-locales", async (_req, res, next) => {
    try {
        const clienteUsuarioId = Number(_req.query.usuario_id ?? 0);
        const pricingProfile = Number.isInteger(clienteUsuarioId) && clienteUsuarioId > 0
            ? await (0, customerPricing_1.getActiveClientePricingProfile)(db_1.pool, clienteUsuarioId)
            : null;
        const resolvePrice = await (0, customerPricing_1.createPricingResolver)(db_1.pool, { source: "local", profile: pricingProfile });
        const productos = await (0, db_1.qAll)(db_1.pool, `SELECT id, nombre, descripcion, imagen_url, categoria, tipo_producto,
              configuracion_tipo, capacidad_sabores, precio_dinero,
              puntaje_al_comprar, activo
       FROM productos
       WHERE activo = 1
         AND tipo_producto IN ('venta', 'mixto')
         AND COALESCE(precio_dinero, 0) > 0
       ORDER BY nombre ASC, id ASC`);
        if (!productos.length) {
            res.json([]);
            return;
        }
        const ids = productos.map((producto) => Number(producto.id));
        const placeholders = ids.map(() => "?").join(", ");
        const sabores = await (0, db_1.qAll)(db_1.pool, `SELECT ps.producto_id, s.id, s.nombre
       FROM producto_sabores ps
       JOIN sabores s ON s.id = ps.sabor_id
       WHERE ps.producto_id IN (${placeholders}) AND ps.activo = 1 AND s.activo = 1
       ORDER BY ps.producto_id ASC, ps.orden ASC, s.nombre ASC`, ids);
        const flavorMap = new Map();
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
    }
    catch (err) {
        next(err);
    }
});
const cargarSchema = zod_1.z.object({
    dni: zod_1.z.string().min(6),
    items: zod_1.z.array(zod_1.z.object({
        producto_id: zod_1.z.number().int().positive(),
        cantidad: zod_1.z.number().int().positive(),
    })).min(1),
    descripcion: zod_1.z.string().optional(),
});
router.post("/cargar", async (req, res, next) => {
    const parsed = cargarSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0].message });
        return;
    }
    const { dni, items, descripcion } = parsed.data;
    let conn;
    try {
        conn = await db_1.pool.getConnection();
        await conn.beginTransaction();
        const cliente = await (0, db_1.qOne)(conn, "SELECT id, puntos_saldo FROM usuarios WHERE dni = ? AND rol = 'cliente'", [dni]);
        if (!cliente) {
            res.status(404).json({ error: "Cliente no encontrado" });
            await conn.rollback();
            return;
        }
        let totalPuntos = 0;
        for (const item of items) {
            const prod = await (0, db_1.qOne)(conn, "SELECT id, puntos_acumulables FROM productos WHERE id = ? AND activo = 1", [item.producto_id]);
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
        await (0, points_1.registrarMovimientoPuntos)(conn, {
            usuarioId: Number(cliente.id),
            tipo: 'asignacion_manual',
            puntos: totalPuntos,
            descripcion: descripcion || `Carga de puntos — ${items.length} producto(s)`,
            creadoPor: req.user.id
        });
        await conn.commit();
        (0, realtime_1.emitRealtime)(["puntos"]);
        res.status(201).json({
            ok: true,
            cliente_id: cliente.id,
            puntos_acreditados: totalPuntos,
            nuevo_saldo: cliente.puntos_saldo + totalPuntos,
        });
    }
    catch (err) {
        if (conn)
            await conn.rollback();
        next(err);
    }
    finally {
        if (conn)
            conn.release();
    }
});
// Buscar canje por código de retiro
router.get("/canje/:codigo", async (req, res, next) => {
    try {
        const codigo = req.params.codigo.trim().toUpperCase();
        const canje = await (0, db_1.qOne)(db_1.pool, `SELECT c.id, c.codigo_retiro, c.puntos_usados, c.estado, c.fecha_limite_retiro, c.notas,
              u.nombre AS cliente_nombre, u.dni AS cliente_dni,
              p.nombre AS producto_nombre,
              s.id AS sucursal_id, s.nombre AS sucursal_nombre, s.direccion AS sucursal_direccion,
              s.piso AS sucursal_piso, s.localidad AS sucursal_localidad, s.provincia AS sucursal_provincia
       FROM canjes c
       JOIN usuarios u ON u.id = c.usuario_id
       JOIN productos p ON p.id = c.producto_id
       LEFT JOIN sucursales s ON s.id = c.sucursal_id
       WHERE c.codigo_retiro = ?`, [codigo]);
        if (!canje) {
            res.status(404).json({ error: "Código de retiro no encontrado" });
            return;
        }
        const itemsMap = await getCanjeItemsByCanjeIds([Number(canje.id)]);
        const fallbackItem = {
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
    }
    catch (err) {
        next(err);
    }
});
// Actualizar estado de un canje (entregado / no_disponible / cancelado)
router.patch("/canje/:codigo", async (req, res, next) => {
    const codigo = req.params.codigo.trim().toUpperCase();
    const schema = zod_1.z.object({
        estado: zod_1.z.enum(["entregado", "no_disponible", "cancelado"]),
        notas: zod_1.z.string().max(500).optional(),
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
        const canje = await (0, db_1.qOne)(conn, "SELECT id, usuario_id, puntos_usados, estado FROM canjes WHERE codigo_retiro = ? FOR UPDATE", [codigo]);
        if (!canje) {
            await conn.rollback();
            res.status(404).json({ error: "Código de retiro no encontrado" });
            return;
        }
        if (canje.estado === "entregado" || canje.estado === "cancelado") {
            await conn.rollback();
            res.status(400).json({ error: `El canje ya está en estado '${canje.estado}'` });
            return;
        }
        await (0, db_1.qRun)(conn, "UPDATE canjes SET estado = ?, notas = ? WHERE id = ?", [estado, notas ?? null, canje.id]);
        if (estado === "no_disponible" || estado === "cancelado") {
            const motivo = estado === "cancelado" ? "cancelado" : "no disponible";
            await (0, db_1.qRun)(conn, `INSERT INTO movimientos_puntos
           (usuario_id, tipo, puntos, descripcion, referencia_id, referencia_tipo, creado_por)
         VALUES (?, 'devolucion_canje', ?, ?, ?, 'canjes', ?)`, [canje.usuario_id, canje.puntos_usados, `Devolución por canje ${motivo}`, canje.id, req.user.id]);
            await (0, points_1.recalcularSaldoPuntosUsuario)(conn, Number(canje.usuario_id));
        }
        await conn.commit();
        (0, realtime_1.emitRealtime)(["canjes", "inventario", "stats", "puntos"]);
        res.json({ ok: true, estado });
    }
    catch (err) {
        await conn.rollback();
        next(err);
    }
    finally {
        conn.release();
    }
});
const ventaLocalItemSchema = zod_1.z.object({
    producto_id: zod_1.z.number().int().positive(),
    cantidad: zod_1.z.number().int().positive().max(200),
    sabores: zod_1.z.array(zod_1.z.object({
        sabor_id: zod_1.z.number().int().positive(),
        cantidad: zod_1.z.number().int().positive().max(200),
    })).optional(),
});
const ventaLocalSchema = zod_1.z.object({
    usuario_id: zod_1.z.number().int().positive().optional().nullable(),
    cliente_local: clienteLocalPayloadSchema.optional().nullable(),
    sucursal_id: zod_1.z.number().int().positive(),
    metodo_pago: zod_1.z.enum(["cash", "transferencia", "tarjeta", "qr", "otro"]).default("cash"),
    acreditar_puntos: zod_1.z.boolean().optional().default(false),
    notas: zod_1.z.string().max(1000).optional().nullable(),
    items: zod_1.z.array(ventaLocalItemSchema).min(1).max(80),
});
router.post("/ventas-locales", async (req, res, next) => {
    const parsed = ventaLocalSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0].message });
        return;
    }
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        if (!parsed.data.usuario_id && !parsed.data.cliente_local) {
            throw new Error("Selecciona un cliente web o completa un cliente manual.");
        }
        const result = await (0, localSales_1.registerLocalSale)(conn, {
            canal: "vendedor",
            usuarioId: parsed.data.usuario_id ?? null,
            clienteLocal: parsed.data.cliente_local ?? null,
            sucursalId: parsed.data.sucursal_id,
            metodoPago: parsed.data.metodo_pago,
            acreditarPuntos: parsed.data.acreditar_puntos,
            notas: parsed.data.notas,
            items: parsed.data.items,
            creadoPor: req.user.id,
        });
        await conn.commit();
        (0, realtime_1.emitRealtime)(["ordenes", "stats", "puntos"]);
        res.status(201).json({ ok: true, ...result });
    }
    catch (err) {
        await conn.rollback();
        res.status(400).json({ error: err?.message || "No se pudo registrar la venta local." });
    }
    finally {
        conn.release();
    }
});
router.get("/proveedores", async (_req, res, next) => {
    try {
        const rows = await (0, db_1.qAll)(db_1.pool, `SELECT id, nombre, contacto, telefono, email, notas
       FROM proveedores
       WHERE activo = 1
       ORDER BY nombre ASC, id ASC`);
        res.json(rows);
    }
    catch (err) {
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
        const result = await (0, db_1.qRun)(db_1.pool, `INSERT INTO proveedores (nombre, contacto, telefono, email, notas, activo)
       VALUES (?, ?, ?, ?, ?, 1)`, [
            parsed.data.nombre.trim(),
            parsed.data.contacto?.trim() || null,
            parsed.data.telefono?.trim() || null,
            parsed.data.email?.trim() || null,
            parsed.data.notas?.trim() || null,
        ]);
        (0, realtime_1.emitRealtime)(["admin-config"]);
        res.status(201).json({ ok: true, id: result.insertId });
    }
    catch (err) {
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
        const result = await (0, db_1.qRun)(db_1.pool, `UPDATE proveedores
       SET nombre = ?, contacto = ?, telefono = ?, email = ?, notas = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND activo = 1`, [
            parsed.data.nombre.trim(),
            parsed.data.contacto?.trim() || null,
            parsed.data.telefono?.trim() || null,
            parsed.data.email?.trim() || null,
            parsed.data.notas?.trim() || null,
            proveedorId,
        ]);
        if (!result.affectedRows) {
            res.status(404).json({ error: "Proveedor no encontrado o inactivo." });
            return;
        }
        (0, realtime_1.emitRealtime)(["admin-config"]);
        res.json({ ok: true });
    }
    catch (err) {
        if (err?.code === "ER_DUP_ENTRY") {
            res.status(409).json({ error: "Ya existe otro proveedor con ese nombre." });
            return;
        }
        next(err);
    }
});
router.get("/envio-zonas", async (_req, res, next) => {
    try {
        res.json(await (0, shippingZones_1.listShippingZones)(true));
    }
    catch (err) {
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
        const zone = await (0, shippingZones_1.createShippingZone)(req.user.id, parsed.data);
        (0, realtime_1.emitRealtime)(["envio-zonas", "admin-config"]);
        res.status(201).json(zone);
    }
    catch (err) {
        if (err instanceof shippingZones_1.ShippingZoneError) {
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
        const zone = await (0, shippingZones_1.updateShippingZone)(req.user.id, id, parsed.data);
        (0, realtime_1.emitRealtime)(["envio-zonas", "admin-config"]);
        res.json(zone);
    }
    catch (err) {
        if (err instanceof shippingZones_1.ShippingZoneError) {
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
        const zone = await (0, shippingZones_1.setShippingZoneActive)(req.user.id, id, activo);
        (0, realtime_1.emitRealtime)(["envio-zonas", "admin-config"]);
        res.json(zone);
    }
    catch (err) {
        if (err instanceof shippingZones_1.ShippingZoneError) {
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
        const conn = await db_1.pool.getConnection();
        try {
            await conn.beginTransaction();
            const session = await (0, cashRegister_1.ensureDailyCajaSesion)(conn, { usuarioId: req.user.id, sucursalId });
            await conn.commit();
            res.json(await getCajaSesionPayload(db_1.pool, Number(session.id)));
        }
        catch (err) {
            await conn.rollback();
            throw err;
        }
        finally {
            conn.release();
        }
    }
    catch (err) {
        next(err);
    }
});
router.post("/caja/apertura", async (req, res, next) => {
    const parsed = cajaAperturaSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0].message });
        return;
    }
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        const sessionId = await (0, cashRegister_1.openCajaSesion)(conn, {
            usuarioId: req.user.id,
            sucursalId: parsed.data.sucursal_id,
            montoApertura: Number(parsed.data.monto_apertura),
            observaciones: parsed.data.observaciones,
        });
        await conn.commit();
        (0, realtime_1.emitRealtime)(["ordenes"]);
        res.status(201).json(await getCajaSesionPayload(db_1.pool, sessionId));
    }
    catch (err) {
        await conn.rollback();
        next(err);
    }
    finally {
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
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        await (0, cashRegister_1.closeCajaSesion)(conn, {
            cajaSesionId: sessionId,
            usuarioId: req.user.id,
            montoCierreDeclarado: Number(parsed.data.monto_cierre_declarado),
            observaciones: parsed.data.observaciones,
            forceAdmin: req.user.rol === "admin" || req.user.rol === "superAdmin",
        });
        await conn.commit();
        (0, realtime_1.emitRealtime)(["ordenes"]);
        res.json(await getCajaSesionPayload(db_1.pool, sessionId));
    }
    catch (err) {
        await conn.rollback();
        next(err);
    }
    finally {
        conn.release();
    }
});
router.get("/caja/sesiones", async (req, res, next) => {
    try {
        const sucursalId = Number(req.query.sucursal_id ?? 0);
        const where = [];
        const params = [];
        if (Number.isInteger(sucursalId) && sucursalId > 0) {
            where.push("sucursal_id = ?");
            params.push(sucursalId);
        }
        await (0, cashRegister_1.closeStaleCajaSesiones)(db_1.pool, Number.isInteger(sucursalId) && sucursalId > 0 ? { sucursalId } : {});
        const rows = await (0, db_1.qAll)(db_1.pool, `SELECT id
       FROM caja_sesiones
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY apertura_at DESC, id DESC
       LIMIT 40`, params);
        const payload = [];
        for (const row of rows) {
            const session = await getCajaSesionPayload(db_1.pool, Number(row.id));
            if (session)
                payload.push(session);
        }
        res.json(payload);
    }
    catch (err) {
        next(err);
    }
});
router.get("/gastos", async (req, res, next) => {
    try {
        const sucursalId = Number(req.query.sucursal_id ?? 0);
        const where = ["g.creado_por = ?"];
        const params = [req.user.id];
        if (Number.isInteger(sucursalId) && sucursalId > 0) {
            where.push("g.sucursal_id = ?");
            params.push(sucursalId);
        }
        const rows = await (0, db_1.qAll)(db_1.pool, `SELECT g.id, g.sucursal_id, s.nombre AS sucursal_nombre, g.caja_sesion_id,
              g.proveedor_id, p.nombre AS proveedor_nombre, g.tercero_nombre,
              g.categoria, g.descripcion, g.medio_pago, g.monto, g.fecha_gasto, g.notas,
              g.creado_por, u.nombre AS creado_por_nombre, g.created_at
       FROM gastos g
       JOIN sucursales s ON s.id = g.sucursal_id
       LEFT JOIN proveedores p ON p.id = g.proveedor_id
       JOIN usuarios u ON u.id = g.creado_por
       WHERE ${where.join(" AND ")}
       ORDER BY g.fecha_gasto DESC, g.id DESC
       LIMIT 120`, params);
        res.json(rows.map((row) => ({ ...row, monto: Number(row.monto ?? 0) })));
    }
    catch (err) {
        next(err);
    }
});
router.post("/gastos", async (req, res, next) => {
    const parsed = gastoSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0].message });
        return;
    }
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        const session = await (0, cashRegister_1.ensureDailyCajaSesion)(conn, {
            usuarioId: req.user.id,
            sucursalId: parsed.data.sucursal_id,
        });
        if (!parsed.data.proveedor_id && !parsed.data.tercero_nombre?.trim()) {
            throw new Error("Selecciona un proveedor o completa un tercero.");
        }
        if (parsed.data.proveedor_id) {
            const provider = await (0, db_1.qOne)(conn, "SELECT id FROM proveedores WHERE id = ? AND activo = 1 LIMIT 1", [parsed.data.proveedor_id]);
            if (!provider)
                throw new Error("El proveedor seleccionado no existe o esta inactivo.");
        }
        const result = await (0, db_1.qRun)(conn, `INSERT INTO gastos
        (sucursal_id, caja_sesion_id, proveedor_id, tercero_nombre, categoria, descripcion, medio_pago, monto, fecha_gasto, notas, creado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?)`, [
            parsed.data.sucursal_id,
            Number(session.id),
            parsed.data.proveedor_id ?? null,
            parsed.data.tercero_nombre?.trim() || null,
            parsed.data.categoria.trim(),
            parsed.data.descripcion.trim(),
            (0, cashRegister_1.normalizeCashPaymentMethod)(parsed.data.medio_pago),
            Number(parsed.data.monto),
            parsed.data.fecha_gasto ?? null,
            parsed.data.notas?.trim() || null,
            req.user.id,
        ]);
        await (0, cashRegister_1.registerCajaMovimiento)(conn, {
            cajaSesionId: Number(session.id),
            tipo: "gasto",
            medioPago: (0, cashRegister_1.normalizeCashPaymentMethod)(parsed.data.medio_pago),
            monto: Number(parsed.data.monto),
            descripcion: parsed.data.descripcion.trim(),
            referenciaTipo: "gastos",
            referenciaId: result.insertId,
            creadoPor: req.user.id,
        });
        await conn.commit();
        (0, realtime_1.emitRealtime)(["ordenes"]);
        res.status(201).json({ ok: true, id: result.insertId });
    }
    catch (err) {
        await conn.rollback();
        next(err);
    }
    finally {
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
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        const gasto = await (0, db_1.qOne)(conn, "SELECT id, sucursal_id, caja_sesion_id, creado_por FROM gastos WHERE id = ? LIMIT 1 FOR UPDATE", [gastoId]);
        if (!gasto) {
            res.status(404).json({ error: "Gasto no encontrado." });
            await conn.rollback();
            return;
        }
        if (req.user.rol === "vendedor" && Number(gasto.creado_por) !== Number(req.user.id)) {
            throw new Error("No puedes editar un gasto cargado por otro usuario.");
        }
        if (Number(gasto.sucursal_id) !== Number(parsed.data.sucursal_id)) {
            throw new Error("No se puede cambiar la sucursal de un gasto ya registrado.");
        }
        if (!parsed.data.proveedor_id && !parsed.data.tercero_nombre?.trim()) {
            throw new Error("Selecciona un proveedor o completa un tercero.");
        }
        if (parsed.data.proveedor_id) {
            const provider = await (0, db_1.qOne)(conn, "SELECT id FROM proveedores WHERE id = ? AND activo = 1 LIMIT 1", [parsed.data.proveedor_id]);
            if (!provider)
                throw new Error("El proveedor seleccionado no existe o esta inactivo.");
        }
        const medioPago = (0, cashRegister_1.normalizeCashPaymentMethod)(parsed.data.medio_pago);
        const descripcion = parsed.data.descripcion.trim();
        await (0, db_1.qRun)(conn, `UPDATE gastos
       SET proveedor_id = ?, tercero_nombre = ?, categoria = ?, descripcion = ?,
           medio_pago = ?, monto = ?, notas = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`, [
            parsed.data.proveedor_id ?? null,
            parsed.data.tercero_nombre?.trim() || null,
            parsed.data.categoria.trim(),
            descripcion,
            medioPago,
            Number(parsed.data.monto),
            parsed.data.notas?.trim() || null,
            gastoId,
        ]);
        const movementUpdate = await (0, db_1.qRun)(conn, `UPDATE caja_movimientos
       SET medio_pago = ?, monto = ?, descripcion = ?
       WHERE referencia_tipo = 'gastos' AND referencia_id = ?`, [medioPago, Number(parsed.data.monto), descripcion, gastoId]);
        if (!movementUpdate.affectedRows) {
            await (0, cashRegister_1.registerCajaMovimiento)(conn, {
                cajaSesionId: Number(gasto.caja_sesion_id),
                tipo: "gasto",
                medioPago,
                monto: Number(parsed.data.monto),
                descripcion,
                referenciaTipo: "gastos",
                referenciaId: gastoId,
                creadoPor: req.user.id,
            });
        }
        await conn.commit();
        (0, realtime_1.emitRealtime)(["ordenes"]);
        res.json({ ok: true });
    }
    catch (err) {
        await conn.rollback();
        next(err);
    }
    finally {
        conn.release();
    }
});
router.get("/ordenes", async (_req, res, next) => {
    try {
        const rows = await (0, db_1.qAll)(db_1.pool, `SELECT o.id, o.usuario_id,
              COALESCE(u.nombre, cl.nombre, 'Cliente local') AS cliente_nombre,
              COALESCE(u.email, '') AS cliente_email,
              o.canal, o.estado, o.tipo_orden, o.total_dinero, o.total_puntos, o.moneda,
              o.direccion_envio_json, o.sucursal_retiro_id,
              s.nombre AS sucursal_nombre, s.direccion AS sucursal_direccion,
              s.piso AS sucursal_piso, s.localidad AS sucursal_localidad, s.provincia AS sucursal_provincia,
              o.notas, o.created_at, o.updated_at
       FROM ordenes o
       LEFT JOIN usuarios u ON u.id = o.usuario_id
       LEFT JOIN clientes_locales cl ON cl.id = o.cliente_local_id
       LEFT JOIN sucursales s ON s.id = o.sucursal_retiro_id
       WHERE o.tipo_orden IN ('venta', 'mixta')
       ORDER BY o.created_at DESC, o.id DESC
       LIMIT 300`);
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
        }));
    }
    catch (err) {
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
        const orden = await (0, db_1.qOne)(db_1.pool, `SELECT o.id, o.usuario_id,
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
       LIMIT 1`, [orderId]);
        if (!orden) {
            res.status(404).json({ error: "Orden no encontrada" });
            return;
        }
        const itemMap = await getOrdenItemsByOrdenIds([orderId]);
        const pago = await (0, db_1.qOne)(db_1.pool, `SELECT id, proveedor, metodo, estado, monto, moneda, provider_payment_id, checkout_url, created_at, updated_at
       FROM pagos
       WHERE orden_id = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`, [orderId]);
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
    }
    catch (err) {
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
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        const result = await (0, orderLifecycle_1.cancelOrderUrgently)(conn, {
            orderId,
            reason: parsed.data.motivo,
            refundMessage: parsed.data.mensaje_devolucion,
            creadoPor: req.user.id,
        });
        const conversacionId = await (0, supportNotifications_1.notifyOrderCancellation)(conn, {
            usuarioId: result.usuarioId,
            orderId,
            reason: parsed.data.motivo,
            refundMessage: parsed.data.mensaje_devolucion,
            authorUserId: req.user.id,
        });
        await conn.commit();
        (0, realtime_1.emitRealtime)(["ordenes", "inventario", "stats", "puntos", "support"]);
        res.json({
            ok: true,
            estado: "cancelada",
            conversacion_id: conversacionId,
            requiere_devolucion: result.paymentRequiresRefund,
        });
    }
    catch (err) {
        await conn.rollback();
        next(err);
    }
    finally {
        conn.release();
    }
});
router.patch("/ordenes/:id", async (req, res, next) => {
    const orderId = Number(req.params.id);
    if (!Number.isFinite(orderId) || orderId <= 0) {
        res.status(400).json({ error: "ID de orden invalido" });
        return;
    }
    const schema = zod_1.z.object({
        estado: zod_1.z.enum(["pagada", "preparada", "enviada", "entregada"]),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0].message });
        return;
    }
    const { estado } = parsed.data;
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        const orden = await (0, db_1.qOne)(conn, `SELECT id, estado, sucursal_retiro_id
       FROM ordenes
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`, [orderId]);
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
        const pago = await (0, db_1.qOne)(conn, `SELECT proveedor, metodo, estado
       FROM pagos
       WHERE orden_id = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT 1
       FOR UPDATE`, [orderId]);
        const isCashPayment = pago?.proveedor === "efectivo" || pago?.metodo === "cash";
        const paidStates = ["pagada", "preparada", "enviada", "entregada"];
        const allowedTransitions = {
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
            await (0, orderLifecycle_1.approvePaidOrder)(conn, {
                orderId,
                provider: "vendedor",
                creadoPor: req.user.id,
            });
            shouldSendReceipt = true;
            if (estado === "pagada") {
                await conn.commit();
                (0, realtime_1.emitRealtime)(["ordenes", "inventario", "stats", "puntos"]);
                queueOrderReceiptEmail(orderId);
                res.json({ ok: true, mensaje: "Orden marcada como pagada correctamente" });
                return;
            }
            // Si es otro estado, seguimos abajo para el UPDATE final de estado
        }
        // RESTO DE TRANSICIONES
        await (0, db_1.qRun)(conn, "UPDATE ordenes SET estado = ? WHERE id = ?", [estado, orderId]);
        await conn.commit();
        (0, realtime_1.emitRealtime)(["ordenes", "inventario", "stats", "puntos"]);
        if (shouldSendReceipt)
            queueOrderReceiptEmail(orderId);
        res.json({ ok: true });
    }
    catch (err) {
        await conn.rollback();
        next(err);
    }
    finally {
        conn.release();
    }
});
exports.default = router;
