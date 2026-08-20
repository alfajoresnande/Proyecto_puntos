"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const auth_1 = require("../auth");
const customerPricing_1 = require("../services/customerPricing");
const purchaseLimits_1 = require("../services/purchaseLimits");
const salesMode_1 = require("../services/salesMode");
const urlSafety_1 = require("../urlSafety");
const router = (0, express_1.Router)();
const HOME_LOCATION_LINK_KEYS = [
    "home_ubicacion_imagen_1_link",
    "home_ubicacion_imagen_2_link",
    "home_ubicacion_imagen_3_link",
];
const HOME_LOCATION_SRC_KEYS = [
    "home_ubicacion_imagen_1_src",
    "home_ubicacion_imagen_2_src",
    "home_ubicacion_imagen_3_src",
];
function hasOwnProductImage(imagenUrl, imagenes) {
    const image = imagenes.find(Boolean) || imagenUrl || "";
    return Boolean(image && !image.endsWith("/logo.png") && image !== "logo.png");
}
function toMoney(value) {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}
function buildEventbarPromoFields(unitPrice, discount) {
    const effectiveUnitPrice = (0, customerPricing_1.getEventbarSpecialEffectiveUnitPrice)(unitPrice, discount);
    if (!discount.activo || effectiveUnitPrice === null) {
        return {
            promo_eventbar_activa: false,
            promo_eventbar_tipo: null,
            promo_eventbar_label: null,
            promo_eventbar_cantidad_requerida: null,
            promo_eventbar_cantidad_paga: null,
            promo_eventbar_precio_efectivo: null,
            promo_eventbar_precio_pack: null,
        };
    }
    return {
        promo_eventbar_activa: true,
        promo_eventbar_tipo: discount.tipo,
        promo_eventbar_label: discount.label,
        promo_eventbar_cantidad_requerida: discount.cantidadRequerida,
        promo_eventbar_cantidad_paga: discount.cantidadPaga,
        promo_eventbar_precio_efectivo: effectiveUnitPrice,
        promo_eventbar_precio_pack: toMoney(unitPrice * discount.cantidadPaga),
    };
}
router.get("/home-layout-config", async (_req, res) => {
    try {
        res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
        const allKeys = [...HOME_LOCATION_LINK_KEYS, ...HOME_LOCATION_SRC_KEYS];
        const placeholders = allKeys.map(() => "?").join(", ");
        const [rowsRaw] = await db_1.pool.query(`SELECT clave, valor
       FROM configuracion
       WHERE clave IN (${placeholders})`, allKeys);
        const rows = rowsRaw;
        // Normalize links, but do not normalize safe src if it's just a raw URL or path
        const byKey = new Map(rows.map((row) => [row.clave, row.valor]));
        res.json({
            location_image_links: HOME_LOCATION_LINK_KEYS.map((key) => (0, urlSafety_1.normalizeSafeNavigationUrl)(byKey.get(key) ?? null)),
            location_image_srcs: HOME_LOCATION_SRC_KEYS.map((key) => byKey.get(key) ?? null),
        });
    }
    catch (error) {
        console.error("Home layout config:", error);
        res.status(500).json({ error: "No se pudo cargar la configuracion del home." });
    }
});
router.get("/destacados", async (req, res) => {
    try {
        const rawLimit = Number(req.query.limit ?? 12);
        const limit = Number.isFinite(rawLimit) ? Math.min(24, Math.max(1, Math.floor(rawLimit))) : 12;
        const fetchLimit = Math.min(60, Math.max(limit * 3, limit));
        res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
        const salesMode = await (0, salesMode_1.getSalesMode)(db_1.pool);
        const [rowsRaw] = await db_1.pool.query(`SELECT id, nombre, descripcion, imagen_url, imagen_mobile_url, categoria,
            puntos_requeridos, puntos_acumulables, puntaje_al_comprar, tipo_producto,
            precio_dinero, precio_puntos, puntos_para_canjear, destacado_home, permite_envio, envio_gratis
     FROM productos
     WHERE activo = 1
       AND destacado_home = 1
       AND tipo_producto IN ('venta','mixto')
       ${salesMode === salesMode_1.SALES_MODE_WHATSAPP ? "" : "AND (track_stock = 0 OR stock_disponible > 0)"}
     ORDER BY nombre ASC
     LIMIT ?`, [fetchLimit]);
        const rows = rowsRaw;
        if (!rows.length) {
            res.json([]);
            return;
        }
        const auth = (0, auth_1.getAuthPayload)(req);
        const pricingProfile = auth?.rol === "cliente"
            ? await (0, customerPricing_1.getActiveClientePricingProfile)(db_1.pool, auth.id)
            : null;
        const resolvePrice = await (0, customerPricing_1.createPricingResolver)(db_1.pool, { source: "web", profile: pricingProfile });
        const purchaseLimit = await (0, purchaseLimits_1.getPurchaseQuantityLimit)(db_1.pool, pricingProfile?.tipoCliente ?? "cliente");
        const eventbarDiscount = await (0, customerPricing_1.loadEventbarSpecialDiscountConfig)(db_1.pool);
        const ids = rows.map((row) => row.id);
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
        const destacados = rows
            .map((row) => {
            const imagenesRaw = imageMap.get(row.id) ?? [];
            const imagenes = (imagenesRaw.length > 0 ? imagenesRaw : (row.imagen_url ? [row.imagen_url] : []))
                .map((url) => (0, urlSafety_1.normalizeSafeImageUrl)(url))
                .filter((url) => Boolean(url))
                .slice(0, 3);
            const pricing = resolvePrice({ id: row.id, precio_dinero: row.precio_dinero, categoria: row.categoria });
            const promoFields = buildEventbarPromoFields(pricing.precioFinal, eventbarDiscount);
            const mainImageUrl = row.imagen_url ? (0, urlSafety_1.normalizeSafeImageUrl)(row.imagen_url) : (imagenes[0] ?? null);
            return {
                id: row.id,
                nombre: row.nombre,
                descripcion: row.descripcion,
                imagen_url: mainImageUrl,
                imagen_mobile_url: row.imagen_mobile_url ? (0, urlSafety_1.normalizeSafeImageUrl)(row.imagen_mobile_url) : null,
                imagenes: imagenes.length > 0 ? imagenes : (mainImageUrl ? [mainImageUrl] : []),
                categoria: row.categoria,
                puntos_requeridos: row.puntos_requeridos,
                puntos_acumulables: row.puntos_acumulables,
                puntaje_al_comprar: row.puntaje_al_comprar,
                destacado_home: Boolean(row.destacado_home),
                tipo_producto: row.tipo_producto,
                precio_dinero: pricing.precioFinal,
                precio_dinero_original: pricing.precioLista,
                precio_dinero_lista: pricing.precioLista,
                descuento_porcentaje_aplicado: pricing.descuentoPorcentajeAplicado,
                descuento_producto_porcentaje: pricing.descuentoProductoPorcentaje,
                tipo_cliente_precio: pricing.tipoCliente,
                ...promoFields,
                precio_puntos: row.precio_puntos,
                puntos_para_canjear: row.puntos_para_canjear,
                permite_envio: Boolean(row.permite_envio),
                envio_gratis: Boolean(row.permite_envio) && Boolean(row.envio_gratis),
                limite_compra: purchaseLimit,
            };
        })
            .filter((producto) => hasOwnProductImage(producto.imagen_url, producto.imagenes))
            .slice(0, limit);
        res.json(destacados);
    }
    catch (error) {
        console.error("Productos destacados:", error);
        res.status(500).json({ error: "No se pudieron cargar los productos destacados." });
    }
});
// Catálogo público — no requiere autenticación
// Query params opcionales:
//   ?categoria=alfajores   → filtra por categoría (exacto, case-insensitive)
//   ?max_puntos=500        → filtra productos con puntos_requeridos <= N
router.get("/", async (req, res) => {
    const { categoria, max_puntos, modo } = req.query;
    const sucursalId = Number(req.query.sucursal_id ?? 0);
    const hasSucursalFilter = Number.isFinite(sucursalId) && sucursalId > 0;
    const salesMode = await (0, salesMode_1.getSalesMode)(db_1.pool);
    const whatsappCatalog = salesMode === salesMode_1.SALES_MODE_WHATSAPP;
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
    const [rowsRaw] = await db_1.pool.query(`SELECT id, nombre, descripcion, imagen_url, imagen_mobile_url, categoria,
            puntos_requeridos, puntos_acumulables, puntaje_al_comprar, tipo_producto,
            configuracion_tipo, capacidad_sabores,
            precio_dinero, precio_puntos, puntos_para_canjear, stock_disponible, stock_reservado,
            destacado_home,
            ${hasSucursalFilter
        ? "COALESCE((SELECT i.stock_disponible FROM inventario_sucursal i WHERE i.producto_id = productos.id AND i.sucursal_id = ? LIMIT 1), 0)"
        : "stock_disponible"} AS stock_disponible_sucursal,
            ${hasSucursalFilter
        ? "COALESCE((SELECT i.stock_reservado FROM inventario_sucursal i WHERE i.producto_id = productos.id AND i.sucursal_id = ? LIMIT 1), 0)"
        : "stock_reservado"} AS stock_reservado_sucursal,
            track_stock, permite_envio, envio_gratis, permite_retiro_local
     FROM productos
     WHERE ${where}
     ORDER BY nombre ASC`, hasSucursalFilter ? [sucursalId, sucursalId, ...params] : params);
    const rows = rowsRaw;
    if (!rows.length) {
        res.json([]);
        return;
    }
    const auth = (0, auth_1.getAuthPayload)(req);
    const pricingProfile = auth?.rol === "cliente"
        ? await (0, customerPricing_1.getActiveClientePricingProfile)(db_1.pool, auth.id)
        : null;
    const resolvePrice = await (0, customerPricing_1.createPricingResolver)(db_1.pool, { source: "web", profile: pricingProfile });
    const purchaseLimit = await (0, purchaseLimits_1.getPurchaseQuantityLimit)(db_1.pool, pricingProfile?.tipoCliente ?? "cliente");
    const eventbarDiscount = modoParam === "venta"
        ? await (0, customerPricing_1.loadEventbarSpecialDiscountConfig)(db_1.pool)
        : {
            activo: false,
            tipo: "none",
            cantidadRequerida: 0,
            cantidadPaga: 0,
            label: null,
        };
    const allIds = rows.map((row) => row.id);
    const allPlaceholders = allIds.map(() => "?").join(", ");
    const [flavorRowsRaw] = await db_1.pool.query(`SELECT ps.producto_id, s.id, s.nombre, s.descripcion, s.activo,
            ${hasSucursalFilter
        ? "COALESCE((SELECT i.stock_disponible FROM inventario_sabor_sucursal i WHERE i.sabor_id = s.id AND i.sucursal_id = ? LIMIT 1), 0)"
        : "COALESCE((SELECT SUM(i.stock_disponible) FROM inventario_sabor_sucursal i JOIN sucursales suc ON suc.id = i.sucursal_id AND suc.activo = 1 WHERE i.sabor_id = s.id), 0)"} AS stock_disponible,
            ${hasSucursalFilter
        ? "COALESCE((SELECT i.stock_reservado FROM inventario_sabor_sucursal i WHERE i.sabor_id = s.id AND i.sucursal_id = ? LIMIT 1), 0)"
        : "COALESCE((SELECT SUM(i.stock_reservado) FROM inventario_sabor_sucursal i JOIN sucursales suc ON suc.id = i.sucursal_id AND suc.activo = 1 WHERE i.sabor_id = s.id), 0)"} AS stock_reservado
     FROM producto_sabores ps
     JOIN sabores s ON s.id = ps.sabor_id
     WHERE ps.producto_id IN (${allPlaceholders}) AND ps.activo = 1 AND s.activo = 1
     ORDER BY ps.producto_id ASC, ps.orden ASC, s.nombre ASC`, hasSucursalFilter ? [sucursalId, sucursalId, ...allIds] : allIds);
    const flavorRows = flavorRowsRaw;
    const flavorMap = new Map();
    for (const flavor of flavorRows) {
        const current = flavorMap.get(flavor.producto_id) ?? [];
        current.push(flavor);
        flavorMap.set(flavor.producto_id, current);
    }
    const visibleRows = rows.filter((row) => {
        if (whatsappCatalog)
            return row.configuracion_tipo !== "caja_sabores" || Number(row.capacidad_sabores ?? 0) > 0;
        if (row.configuracion_tipo === "caja_sabores") {
            const capacity = Number(row.capacidad_sabores ?? 0);
            const available = (flavorMap.get(row.id) ?? []).reduce((acc, item) => acc + Math.max(0, Number(item.stock_disponible ?? 0)), 0);
            return capacity > 0 && available >= capacity;
        }
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
        const stockReservadoSucursal = Number(row.stock_reservado_sucursal ?? row.stock_reservado ?? 0);
        const hasStock = !Boolean(row.track_stock) || stockSucursal > 0;
        const pricing = resolvePrice({ id: row.id, precio_dinero: row.precio_dinero, categoria: row.categoria });
        const promoFields = buildEventbarPromoFields(pricing.precioFinal, eventbarDiscount);
        const mainImageUrl = row.imagen_url ? (0, urlSafety_1.normalizeSafeImageUrl)(row.imagen_url) : (imagenes[0] ?? null);
        return {
            id: row.id,
            nombre: row.nombre,
            descripcion: row.descripcion,
            imagen_url: mainImageUrl,
            imagen_mobile_url: row.imagen_mobile_url ? (0, urlSafety_1.normalizeSafeImageUrl)(row.imagen_mobile_url) : null,
            categoria: row.categoria,
            puntos_requeridos: row.puntos_requeridos,
            puntos_acumulables: row.puntos_acumulables,
            puntaje_al_comprar: row.puntaje_al_comprar,
            destacado_home: Boolean(row.destacado_home),
            tipo_producto: row.tipo_producto,
            configuracion_tipo: row.configuracion_tipo,
            capacidad_sabores: row.capacidad_sabores === null ? null : Number(row.capacidad_sabores),
            precio_dinero: pricing.precioFinal,
            precio_dinero_original: pricing.precioLista,
            precio_dinero_lista: pricing.precioLista,
            descuento_porcentaje_aplicado: pricing.descuentoPorcentajeAplicado,
            descuento_producto_porcentaje: pricing.descuentoProductoPorcentaje,
            tipo_cliente_precio: pricing.tipoCliente,
            ...promoFields,
            precio_puntos: row.precio_puntos,
            puntos_para_canjear: row.puntos_para_canjear,
            modo_venta: salesMode,
            stock_disponible: whatsappCatalog ? purchaseLimit : stockSucursal,
            stock_reservado: whatsappCatalog ? 0 : stockReservadoSucursal,
            stock_total_disponible: Number(row.stock_disponible ?? 0),
            stock_total_reservado: Number(row.stock_reservado ?? 0),
            stock_sucursal_id: hasSucursalFilter ? sucursalId : null,
            inventario_sucursales: (inventoryMap.get(row.id) ?? []).map((item) => ({
                sucursal_id: Number(item.sucursal_id),
                sucursal_nombre: item.sucursal_nombre,
                stock_disponible: whatsappCatalog ? purchaseLimit : Number(item.stock_disponible ?? 0),
                stock_reservado: whatsappCatalog ? 0 : Number(item.stock_reservado ?? 0),
            })),
            sabores_disponibles: (flavorMap.get(row.id) ?? []).map((item) => ({
                id: Number(item.id),
                nombre: item.nombre,
                descripcion: item.descripcion ?? null,
                activo: Boolean(item.activo),
                stock_disponible: whatsappCatalog ? Math.max(1, Number(row.capacidad_sabores ?? 1)) : Number(item.stock_disponible ?? 0),
                stock_reservado: whatsappCatalog ? 0 : Number(item.stock_reservado ?? 0),
            })),
            imagenes: imagenes.length > 0 ? imagenes : (mainImageUrl ? [mainImageUrl] : []),
            track_stock: whatsappCatalog ? false : Boolean(row.track_stock),
            permite_envio: Boolean(row.permite_envio),
            envio_gratis: Boolean(row.permite_envio) && Boolean(row.envio_gratis),
            permite_retiro_local: Boolean(row.permite_retiro_local),
            limite_compra: purchaseLimit,
        };
    }));
});
router.get("/modo-venta", async (_req, res) => {
    const modo = await (0, salesMode_1.getSalesMode)(db_1.pool);
    res.setHeader("Cache-Control", "no-store");
    res.json({ modo, catalogo_whatsapp: modo === salesMode_1.SALES_MODE_WHATSAPP });
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
    const [rows] = await db_1.pool.query(`SELECT DISTINCT p.categoria
     FROM productos p
     LEFT JOIN categorias c ON LOWER(c.nombre) = LOWER(p.categoria)
     WHERE p.activo = 1
       AND p.categoria IS NOT NULL
       AND (c.id IS NULL OR c.activo = 1)
     ORDER BY p.categoria ASC`);
    const categorias = rows.map(r => r.categoria);
    res.json(categorias);
});
exports.default = router;
