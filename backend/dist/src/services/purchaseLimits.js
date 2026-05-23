"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_SYSTEM_PURCHASE_QUANTITY = exports.DEFAULT_PURCHASE_QUANTITY_LIMIT = void 0;
exports.getPurchaseLimitConfigKey = getPurchaseLimitConfigKey;
exports.getPurchaseQuantityLimit = getPurchaseQuantityLimit;
exports.getPurchaseQuantityLimits = getPurchaseQuantityLimits;
exports.isWithinPurchaseQuantityLimit = isWithinPurchaseQuantityLimit;
const db_1 = require("../db");
exports.DEFAULT_PURCHASE_QUANTITY_LIMIT = 100;
exports.MAX_SYSTEM_PURCHASE_QUANTITY = 100000;
const LIMIT_KEYS = {
    cliente: "limite_compra_cliente",
    mayorista: "limite_compra_mayorista",
    empleado: "limite_compra_empleado",
};
function normalizeTipoCliente(value) {
    return value === "mayorista" || value === "empleado" ? value : "cliente";
}
function normalizePurchaseLimit(value) {
    const parsed = Number(value ?? exports.DEFAULT_PURCHASE_QUANTITY_LIMIT);
    if (!Number.isFinite(parsed))
        return exports.DEFAULT_PURCHASE_QUANTITY_LIMIT;
    const floored = Math.floor(parsed);
    if (floored <= 0)
        return null;
    return Math.min(exports.MAX_SYSTEM_PURCHASE_QUANTITY, floored);
}
function getPurchaseLimitConfigKey(tipoCliente) {
    return LIMIT_KEYS[normalizeTipoCliente(tipoCliente)];
}
async function getPurchaseQuantityLimit(conn = db_1.pool, tipoCliente = "cliente") {
    const key = getPurchaseLimitConfigKey(tipoCliente);
    const row = await (0, db_1.qOne)(conn, "SELECT valor FROM configuracion WHERE clave = ? LIMIT 1", [key]);
    return normalizePurchaseLimit(row?.valor);
}
async function getPurchaseQuantityLimits(conn = db_1.pool) {
    const rows = await (0, db_1.qAll)(conn, `SELECT clave, valor
     FROM configuracion
     WHERE clave IN (?, ?, ?)`, [LIMIT_KEYS.cliente, LIMIT_KEYS.mayorista, LIMIT_KEYS.empleado]);
    const values = new Map(rows.map((row) => [row.clave, row.valor]));
    return {
        cliente: normalizePurchaseLimit(values.get(LIMIT_KEYS.cliente)),
        mayorista: normalizePurchaseLimit(values.get(LIMIT_KEYS.mayorista)),
        empleado: normalizePurchaseLimit(values.get(LIMIT_KEYS.empleado)),
    };
}
function isWithinPurchaseQuantityLimit(cantidad, limit) {
    return limit === null || cantidad <= limit;
}
