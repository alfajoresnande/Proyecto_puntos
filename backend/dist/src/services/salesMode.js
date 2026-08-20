"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SALES_MODE_WHATSAPP = exports.SALES_MODE_ECOMMERCE = exports.SALES_MODE_CONFIG_KEY = void 0;
exports.normalizeSalesMode = normalizeSalesMode;
exports.getSalesMode = getSalesMode;
exports.isWhatsappCatalogMode = isWhatsappCatalogMode;
const db_1 = require("../db");
exports.SALES_MODE_CONFIG_KEY = "modo_venta";
exports.SALES_MODE_ECOMMERCE = "ecommerce";
exports.SALES_MODE_WHATSAPP = "catalogo_whatsapp";
function normalizeSalesMode(value) {
    return String(value ?? "").trim().toLowerCase() === exports.SALES_MODE_WHATSAPP
        ? exports.SALES_MODE_WHATSAPP
        : exports.SALES_MODE_ECOMMERCE;
}
async function getSalesMode(conn) {
    const row = await (0, db_1.qOne)(conn, "SELECT valor FROM configuracion WHERE clave = ? LIMIT 1", [exports.SALES_MODE_CONFIG_KEY]);
    return normalizeSalesMode(row?.valor);
}
async function isWhatsappCatalogMode(conn) {
    return (await getSalesMode(conn)) === exports.SALES_MODE_WHATSAPP;
}
