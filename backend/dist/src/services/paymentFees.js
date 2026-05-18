"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPaymentFeeRules = getPaymentFeeRules;
exports.buildPaymentFeeRuleMap = buildPaymentFeeRuleMap;
exports.resolvePaymentFeeFromRuleMap = resolvePaymentFeeFromRuleMap;
exports.resolvePaymentFee = resolvePaymentFee;
const db_1 = require("../db");
function toMoney(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}
function normalizeKeyPart(value) {
    return String(value ?? "").trim().toLowerCase();
}
function ruleKey(proveedor, metodo) {
    return `${normalizeKeyPart(proveedor)}:${normalizeKeyPart(metodo)}`;
}
async function getPaymentFeeRules(conn) {
    const rows = await (0, db_1.qAll)(conn, `SELECT id, proveedor, metodo, descripcion, porcentaje, activo
     FROM costos_cobro
     ORDER BY proveedor ASC, metodo ASC, id ASC`).catch(() => []);
    return rows.map((row) => ({
        id: Number(row.id),
        proveedor: normalizeKeyPart(row.proveedor),
        metodo: normalizeKeyPart(row.metodo),
        descripcion: row.descripcion,
        porcentaje: Number(row.porcentaje ?? 0),
        activo: Boolean(row.activo),
    }));
}
function buildPaymentFeeRuleMap(rules) {
    return new Map(rules.map((rule) => [ruleKey(rule.proveedor, rule.metodo), rule]));
}
function resolvePaymentFeeFromRuleMap(ruleMap, input) {
    const gross = toMoney(Number(input.monto ?? 0));
    if (!Number.isFinite(gross) || gross <= 0) {
        return {
            porcentaje: 0,
            montoComision: 0,
            montoNeto: 0,
            descripcion: null,
        };
    }
    const rule = ruleMap.get(ruleKey(input.proveedor, input.metodo));
    const porcentaje = rule?.activo ? Math.max(0, Math.min(100, Number(rule.porcentaje ?? 0))) : 0;
    const montoComision = toMoney((gross * porcentaje) / 100);
    return {
        porcentaje,
        montoComision,
        montoNeto: toMoney(gross - montoComision),
        descripcion: rule?.descripcion ?? null,
    };
}
async function resolvePaymentFee(conn, input) {
    const rules = await getPaymentFeeRules(conn);
    return resolvePaymentFeeFromRuleMap(buildPaymentFeeRuleMap(rules), input);
}
