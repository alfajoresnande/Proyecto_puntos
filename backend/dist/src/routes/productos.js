"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const urlSafety_1 = require("../urlSafety");
const router = (0, express_1.Router)();
// Catálogo público — no requiere autenticación
// Query params opcionales:
//   ?categoria=alfajores   → filtra por categoría (exacto, case-insensitive)
//   ?max_puntos=500        → filtra productos con puntos_requeridos <= N
router.get("/", async (req, res) => {
    const { categoria, max_puntos, modo } = req.query;
    const sucursalId = Number(req.query.sucursal_id ?? 0);
    const hasSucursalFilter = Number.isFinite(sucursalId) && sucursalId > 0;
    const conditions = ["activo = 1"];
    const params = [];
    if (categoria && typeof categoria === "string") {
        conditions.push("LOWER(categoria) = LOWER(?)");
        params.push(categoria.trim());
    }
    const modoParam = typeof modo === "string" ? modo.trim().toLowerCase() : "canje";
    if (modoParam === "canje") {
        conditions.push("tipo_producto IN ('canje','mixto')");
    }
    else if (modoParam === "venta") {
        conditions.push("tipo_producto IN ('venta','mixto')");
    }
    else if (modoParam === "mixto") {
        conditions.push("tipo_producto = 'mixto'");
    }
    if (max_puntos) {
        const pts = parseInt(String(max_puntos), 10);
        if (!isNaN(pts) && pts > 0) {
            conditions.push("COALESCE(puntos_para_canjear, precio_puntos, puntos_requeridos) <= ?");
            params.push(pts);
        }
    }
    const where = conditions.join(" AND ");
    const [rowsRaw] = await db_1.pool.query(`SELECT id, nombre, descripcion, imagen_url, categoria,
            puntos_requeridos, puntos_acumulables, puntaje_al_comprar, tipo_producto,
            precio_dinero, precio_puntos, puntos_para_canjear, stock_disponible, stock_reservado,
            ${hasSucursalFilter
        ? "COALESCE((SELECT i.stock_disponible FROM inventario_sucursal i WHERE i.producto_id = productos.id AND i.sucursal_id = ? LIMIT 1), 0)"
        : "stock_disponible"} AS stock_disponible_sucursal,
            ${hasSucursalFilter
        ? "COALESCE((SELECT i.stock_reservado FROM inventario_sucursal i WHERE i.producto_id = productos.id AND i.sucursal_id = ? LIMIT 1), 0)"
        : "stock_reservado"} AS stock_reservado_sucursal,
            track_stock, permite_envio, permite_retiro_local
     FROM productos
     WHERE ${where}
     ORDER BY nombre ASC`, hasSucursalFilter ? [sucursalId, sucursalId, ...params] : params);
    const rows = rowsRaw;
    const visibleRows = rows.filter((row) => {
        const stockSucursal = Number(row.stock_disponible_sucursal ?? row.stock_disponible ?? 0);
        return !Boolean(row.track_stock) || stockSucursal > 0;
    });
    if (!visibleRows.length) {
        res.json([]);
        return;
    }
    const ids = visibleRows.map((row) => row.id);
    const placeholders = ids.map(() => "?").join(", ");
    const [imgRowsRaw] = await db_1.pool.query(`SELECT producto_id, imagen_url, orden
     FROM producto_imagenes
     WHERE producto_id IN (${placeholders})
     ORDER BY producto_id ASC, orden ASC`, ids);
    const imgRows = imgRowsRaw;
    const imageMap = new Map();
    for (const image of imgRows) {
        const current = imageMap.get(image.producto_id) ?? [];
        current.push(image.imagen_url);
        imageMap.set(image.producto_id, current);
    }
    const [inventoryRowsRaw] = await db_1.pool.query(`SELECT i.producto_id, i.sucursal_id, s.nombre AS sucursal_nombre,
            i.stock_disponible, i.stock_reservado
     FROM inventario_sucursal i
     JOIN sucursales s ON s.id = i.sucursal_id
     WHERE i.producto_id IN (${placeholders}) AND s.activo = 1
     ORDER BY i.producto_id ASC, s.nombre ASC, s.id ASC`, ids);
    const inventoryRows = inventoryRowsRaw;
    const inventoryMap = new Map();
    for (const inventory of inventoryRows) {
        const current = inventoryMap.get(inventory.producto_id) ?? [];
        current.push(inventory);
        inventoryMap.set(inventory.producto_id, current);
    }
    res.json(visibleRows.map((row) => {
        const imagenesRaw = imageMap.get(row.id) ?? [];
        const imagenes = (imagenesRaw.length > 0 ? imagenesRaw : (row.imagen_url ? [row.imagen_url] : []))
            .map((url) => (0, urlSafety_1.normalizeSafeImageUrl)(url))
            .filter((url) => Boolean(url))
            .slice(0, 3);
        const stockSucursal = Number(row.stock_disponible_sucursal ?? row.stock_disponible ?? 0);
        const hasStock = !Boolean(row.track_stock) || stockSucursal > 0;
        return {
            id: row.id,
            nombre: row.nombre,
            descripcion: row.descripcion,
            imagen_url: imagenes[0] ?? null,
            categoria: row.categoria,
            puntos_requeridos: row.puntos_requeridos,
            puntos_acumulables: row.puntos_acumulables,
            puntaje_al_comprar: row.puntaje_al_comprar,
            tipo_producto: row.tipo_producto,
            precio_dinero: row.precio_dinero,
            precio_puntos: row.precio_puntos,
            puntos_para_canjear: row.puntos_para_canjear,
            stock_disponible: hasStock ? 1 : 0,
            stock_reservado: 0,
            stock_total_disponible: hasStock ? 1 : 0,
            stock_total_reservado: 0,
            stock_sucursal_id: hasSucursalFilter ? sucursalId : null,
            inventario_sucursales: (inventoryMap.get(row.id) ?? []).map((item) => ({
                sucursal_id: Number(item.sucursal_id),
                sucursal_nombre: item.sucursal_nombre,
                stock_disponible: Number(item.stock_disponible ?? 0) > 0 ? 1 : 0,
                stock_reservado: 0,
            })),
            imagenes,
            track_stock: Boolean(row.track_stock),
            permite_envio: Boolean(row.permite_envio),
            permite_retiro_local: Boolean(row.permite_retiro_local),
        };
    }));
});
// GET /productos/categorias — lista las categorías disponibles
router.get("/sucursales", async (_req, res) => {
    const [rows] = await db_1.pool.query(`SELECT id, nombre, direccion, piso, localidad, provincia
     FROM sucursales
     WHERE activo = 1
     ORDER BY nombre ASC, id ASC`);
    res.json(rows);
});
router.get("/categorias", async (_req, res) => {
    const [rows] = await db_1.pool.query("SELECT DISTINCT categoria FROM productos WHERE activo = 1 AND categoria IS NOT NULL ORDER BY categoria ASC");
    const categorias = rows.map(r => r.categoria);
    res.json(categorias);
});
exports.default = router;
