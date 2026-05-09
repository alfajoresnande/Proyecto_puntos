"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../db");
const auth_1 = require("../auth");
const stock_1 = require("../services/stock");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth, (0, auth_1.requireRole)("vendedor", "admin", "superAdmin"));
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
            oi.subtotal_dinero, oi.subtotal_puntos, p.nombre, p.track_stock
     FROM orden_items oi
     JOIN productos p ON p.id = oi.producto_id
     WHERE oi.orden_id IN (${orderIds.map(() => "?").join(", ")})
     ORDER BY oi.orden_id ASC, oi.id ASC`, orderIds);
    for (const row of rows) {
        const orderId = Number(row.orden_id);
        const current = map.get(orderId) ?? [];
        current.push({
            ...row,
            orden_id: orderId,
            producto_id: Number(row.producto_id),
            cantidad: Number(row.cantidad),
            subtotal_dinero: Number(row.subtotal_dinero ?? 0),
            subtotal_puntos: Number(row.subtotal_puntos ?? 0),
            track_stock: Number(row.track_stock ?? 0),
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
        const rows = await (0, db_1.qAll)(db_1.pool, `SELECT id, nombre, dni, email, puntos_saldo AS puntos 
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
        await (0, db_1.qRun)(conn, `INSERT INTO movimientos_puntos (usuario_id, tipo, puntos, descripcion, creado_por)
       VALUES (?, 'asignacion_manual', ?, ?, ?)`, [cliente.id, totalPuntos, descripcion ?? `Carga de puntos — ${items.length} producto(s)`, req.user.id]);
        await (0, db_1.qRun)(conn, "UPDATE usuarios SET puntos_saldo = puntos_saldo + ? WHERE id = ?", [totalPuntos, cliente.id]);
        await conn.commit();
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
            await (0, db_1.qRun)(conn, "UPDATE usuarios SET puntos_saldo = puntos_saldo + ? WHERE id = ?", [canje.puntos_usados, canje.usuario_id]);
        }
        await conn.commit();
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
router.get("/ordenes", async (_req, res, next) => {
    try {
        const rows = await (0, db_1.qAll)(db_1.pool, `SELECT o.id, o.usuario_id, u.nombre AS cliente_nombre, u.email AS cliente_email,
              o.estado, o.tipo_orden, o.total_dinero, o.total_puntos, o.moneda,
              o.direccion_envio_json, o.sucursal_retiro_id,
              s.nombre AS sucursal_nombre, s.direccion AS sucursal_direccion,
              s.piso AS sucursal_piso, s.localidad AS sucursal_localidad, s.provincia AS sucursal_provincia,
              o.notas, o.created_at, o.updated_at
       FROM ordenes o
       JOIN usuarios u ON u.id = o.usuario_id
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
        const allowedTransitions = {
            pendiente_pago: isCashPayment ? ["pagada"] : [],
            pagada: ["preparada", "enviada", "entregada"],
            preparada: ["enviada", "entregada"],
            enviada: ["entregada"],
        };
        if (!(allowedTransitions[orden.estado] ?? []).includes(estado)) {
            await conn.rollback();
            res.status(400).json({ error: `No se puede pasar una orden de '${orden.estado}' a '${estado}' desde el panel vendedor.` });
            return;
        }
        if (orden.estado === "pendiente_pago" && estado === "pagada") {
            const items = await (0, db_1.qAll)(conn, `SELECT oi.id, oi.orden_id, oi.producto_id, oi.cantidad, oi.modo_compra,
                oi.subtotal_dinero, oi.subtotal_puntos, p.nombre, p.track_stock
         FROM orden_items oi
         JOIN productos p ON p.id = oi.producto_id
         WHERE oi.orden_id = ?
         ORDER BY oi.id ASC`, [orderId]);
            const stockItems = items
                .filter((item) => Number(item.track_stock ?? 0) === 1)
                .map((item) => ({
                producto_id: Number(item.producto_id),
                cantidad: Number(item.cantidad),
                origen: item.modo_compra === "dinero" ? "compra" : "canje",
                descripcion: `Pago en efectivo orden #${orderId}`,
            }));
            if (orden.sucursal_retiro_id && stockItems.length) {
                await (0, stock_1.finalizeStockForCheckoutItems)(conn, {
                    sucursalId: Number(orden.sucursal_retiro_id),
                    items: stockItems,
                    referencia: `orden #${orderId}`,
                    creadoPor: req.user.id,
                    ordenId: orderId,
                });
            }
            await (0, db_1.qRun)(conn, "UPDATE pagos SET estado = 'aprobado' WHERE orden_id = ? AND estado = 'iniciado'", [orderId]);
        }
        await (0, db_1.qRun)(conn, "UPDATE ordenes SET estado = ? WHERE id = ?", [estado, orderId]);
        await conn.commit();
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
