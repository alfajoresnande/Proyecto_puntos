"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeDiscount = normalizeDiscount;
exports.applyDiscountToMoney = applyDiscountToMoney;
exports.getCustomerPricingProfile = getCustomerPricingProfile;
exports.getActiveClientePricingProfile = getActiveClientePricingProfile;
exports.createPricingResolver = createPricingResolver;
exports.resolveEffectiveMoneyPrice = resolveEffectiveMoneyPrice;
const db_1 = require("../db");
const GLOBAL_DISCOUNT_CONFIG_KEYS = [
    "descuento_web_global_activo",
    "descuento_web_global_cliente",
    "descuento_web_global_mayorista",
    "descuento_web_global_empleado",
];
function normalizeTipoCliente(value) {
    if (value === "mayorista" || value === "empleado")
        return value;
    return "cliente";
}
function normalizeDiscount(value) {
    const numeric = Number(value ?? 0);
    if (!Number.isFinite(numeric))
        return 0;
    return Math.max(0, Math.min(100, Math.round((numeric + Number.EPSILON) * 100) / 100));
}
function normalizeMoney(value) {
    return Math.round((Number(value ?? 0) + Number.EPSILON) * 100) / 100;
}
function applyDiscountToMoney(basePrice, discountPercentage) {
    const price = normalizeMoney(basePrice);
    const discount = normalizeDiscount(discountPercentage);
    const finalPrice = price * (1 - discount / 100);
    return normalizeMoney(finalPrice);
}
function normalizeCategoryKey(value) {
    return (value || "").trim().toLowerCase();
}
async function getCustomerPricingProfile(conn, usuarioId) {
    const row = await (0, db_1.qOne)(conn, `SELECT id, rol, tipo_cliente, descuento_porcentaje
     FROM usuarios
     WHERE id = ? AND activo = 1
     LIMIT 1`, [usuarioId]);
    if (!row)
        return null;
    return {
        usuarioId: Number(row.id),
        rol: row.rol,
        tipoCliente: normalizeTipoCliente(row.tipo_cliente),
        descuentoPorcentaje: normalizeDiscount(row.descuento_porcentaje),
    };
}
async function getActiveClientePricingProfile(conn, usuarioId) {
    const profile = await getCustomerPricingProfile(conn, usuarioId);
    if (!profile || profile.rol !== "cliente")
        return null;
    return profile;
}
async function loadCategoryDiscounts(conn) {
    const rows = await (0, db_1.qAll)(conn, `SELECT d.tipo_cliente, d.categoria, d.descuento_porcentaje, d.activo
     FROM descuentos_tipo_categoria d
     LEFT JOIN categorias c ON LOWER(c.nombre) = LOWER(d.categoria)
     WHERE d.activo = 1
       AND (c.id IS NULL OR c.activo = 1)`).catch(() => []);
    const map = new Map();
    for (const row of rows) {
        const categoria = normalizeCategoryKey(row.categoria);
        if (!categoria)
            continue;
        const tipoCliente = normalizeTipoCliente(row.tipo_cliente);
        map.set(`${tipoCliente}:${categoria}`, normalizeDiscount(row.descuento_porcentaje));
    }
    return map;
}
async function loadWebGlobalDiscountConfig(conn) {
    const placeholders = GLOBAL_DISCOUNT_CONFIG_KEYS.map(() => "?").join(", ");
    const rows = await (0, db_1.qAll)(conn, `SELECT clave, valor
     FROM configuracion
     WHERE clave IN (${placeholders})`, [...GLOBAL_DISCOUNT_CONFIG_KEYS]).catch(() => []);
    const byKey = new Map(rows.map((row) => [row.clave, row.valor]));
    const activoRaw = String(byKey.get("descuento_web_global_activo") ?? "0").trim().toLowerCase();
    return {
        activo: activoRaw === "1" || activoRaw === "true" || activoRaw === "si" || activoRaw === "yes" || activoRaw === "on",
        cliente: normalizeDiscount(byKey.get("descuento_web_global_cliente") ?? 0),
        mayorista: normalizeDiscount(byKey.get("descuento_web_global_mayorista") ?? 0),
        empleado: normalizeDiscount(byKey.get("descuento_web_global_empleado") ?? 0),
    };
}
function getGlobalDiscountForType(config, tipoCliente) {
    if (tipoCliente === "mayorista")
        return config.mayorista;
    if (tipoCliente === "empleado")
        return config.empleado;
    return config.cliente;
}
async function createPricingResolver(conn, options) {
    const tipoCliente = normalizeTipoCliente(options.profile?.tipoCliente);
    const categoryDiscounts = await loadCategoryDiscounts(conn);
    const webGlobalConfig = options.source === "web"
        ? await loadWebGlobalDiscountConfig(conn)
        : {
            activo: false,
            cliente: 0,
            mayorista: 0,
            empleado: 0,
        };
    return (product) => {
        const precioLista = normalizeMoney(product.precio_dinero);
        const descuentoUsuarioPorcentaje = normalizeDiscount(options.profile?.descuentoPorcentaje ?? 0);
        const categoriaKey = normalizeCategoryKey(product.categoria);
        const descuentoCategoriaPorcentaje = categoriaKey
            ? normalizeDiscount(categoryDiscounts.get(`${tipoCliente}:${categoriaKey}`) ?? 0)
            : 0;
        const descuentoWebGlobalPorcentaje = options.source === "web" && webGlobalConfig.activo
            ? getGlobalDiscountForType(webGlobalConfig, tipoCliente)
            : 0;
        // Regla conservadora: aplica el mejor descuento individual y evita acumulaciones inesperadas.
        const descuentoPorcentajeAplicado = Math.max(descuentoUsuarioPorcentaje, descuentoCategoriaPorcentaje, descuentoWebGlobalPorcentaje);
        return {
            precioLista,
            descuentoUsuarioPorcentaje,
            descuentoCategoriaPorcentaje,
            descuentoWebGlobalPorcentaje,
            descuentoPorcentajeAplicado,
            precioFinal: applyDiscountToMoney(precioLista, descuentoPorcentajeAplicado),
            tipoCliente,
            source: options.source,
        };
    };
}
async function resolveEffectiveMoneyPrice(conn, options) {
    const resolver = await createPricingResolver(conn, options);
    return resolver(options.product);
}
