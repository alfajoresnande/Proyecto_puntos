"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROVEEDORES_WEBHOOK_PERMITIDOS = void 0;
exports.normalizarProveedorWebhook = normalizarProveedorWebhook;
exports.parseMercadoPagoSignatureHeader = parseMercadoPagoSignatureHeader;
exports.verificarFirmaMercadoPago = verificarFirmaMercadoPago;
exports.verificarPagoContraCompra = verificarPagoContraCompra;
exports.extraerIdRecursoProveedor = extraerIdRecursoProveedor;
exports.normalizarEstadoProveedor = normalizarEstadoProveedor;
const crypto_1 = require("crypto");
/**
 * Reglas de autenticidad de los webhooks de pago.
 *
 * Regla de oro: del request SOLO se toma el identificador del recurso del
 * proveedor (data.id). Estado, importe, moneda, cuenta y referencia se leen
 * siempre de la respuesta autenticada de la API del proveedor.
 */
/** Unico proveedor con integracion real. Todo lo demas se rechaza. */
exports.PROVEEDORES_WEBHOOK_PERMITIDOS = ["mercadopago"];
const PROVEEDORES = new Set(exports.PROVEEDORES_WEBHOOK_PERMITIDOS);
function normalizarProveedorWebhook(raw) {
    const value = String(raw ?? "").trim().toLowerCase();
    return PROVEEDORES.has(value) ? value : null;
}
function parseMercadoPagoSignatureHeader(signatureHeader) {
    let ts = null;
    let v1 = null;
    for (const part of signatureHeader.split(",")) {
        const separator = part.indexOf("=");
        if (separator <= 0)
            continue;
        const key = part.slice(0, separator).trim().toLowerCase();
        const value = part.slice(separator + 1).trim();
        if (!key || !value)
            continue;
        if (key === "ts")
            ts = value;
        if (key === "v1")
            v1 = value.toLowerCase();
    }
    return { ts, v1 };
}
function secureHexEquals(left, right) {
    if (!/^[0-9a-f]+$/i.test(left) || !/^[0-9a-f]+$/i.test(right))
        return false;
    const leftBuffer = Buffer.from(left, "hex");
    const rightBuffer = Buffer.from(right, "hex");
    if (leftBuffer.length === 0 || leftBuffer.length !== rightBuffer.length)
        return false;
    return (0, crypto_1.timingSafeEqual)(leftBuffer, rightBuffer);
}
/**
 * Mercado Pago manda `ts` en segundos en unas integraciones y en milisegundos
 * en otras. Se normaliza a milisegundos para poder medir la ventana.
 */
function timestampToMs(ts) {
    const parsed = Number(ts);
    if (!Number.isFinite(parsed) || parsed <= 0)
        return null;
    return parsed > 1e12 ? parsed : parsed * 1000;
}
/**
 * Verifica la firma HMAC-SHA256 de Mercado Pago sobre el manifiesto
 * `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`.
 *
 * Funcion pura: no lee `process.env` ni toca la red, para poder testearla.
 */
function verificarFirmaMercadoPago(input) {
    const secret = (input.secret || "").trim();
    if (!secret)
        return { ok: false, reason: "secret_no_configurado" };
    const signatureHeader = (input.signatureHeader || "").trim();
    if (!signatureHeader)
        return { ok: false, reason: "firma_ausente" };
    const { ts, v1 } = parseMercadoPagoSignatureHeader(signatureHeader);
    if (!ts || !v1)
        return { ok: false, reason: "firma_malformada" };
    // El data.id es lo unico que tomamos del request y es lo que la firma ata.
    // Sin el, la firma no protege nada: se rechaza.
    const dataId = (input.dataId || "").trim().toLowerCase();
    if (!dataId)
        return { ok: false, reason: "data_id_ausente" };
    const toleranceSeconds = input.toleranceSeconds ?? 0;
    if (toleranceSeconds > 0) {
        const tsMs = timestampToMs(ts);
        if (tsMs === null)
            return { ok: false, reason: "timestamp_invalido" };
        const nowMs = input.nowMs ?? Date.now();
        if (Math.abs(nowMs - tsMs) > toleranceSeconds * 1000) {
            return { ok: false, reason: "timestamp_fuera_de_ventana" };
        }
    }
    const requestId = (input.requestId || "").trim();
    const manifestParts = [`id:${dataId}`];
    if (requestId)
        manifestParts.push(`request-id:${requestId}`);
    manifestParts.push(`ts:${ts}`);
    const manifest = `${manifestParts.join(";")};`;
    const expected = (0, crypto_1.createHmac)("sha256", secret).update(manifest).digest("hex");
    return secureHexEquals(expected, v1) ? { ok: true } : { ok: false, reason: "firma_incorrecta" };
}
/**
 * Compara lo que dice el proveedor contra lo que espera la base. Funcion pura.
 */
function verificarPagoContraCompra(provider, expected, policy) {
    const tolerance = policy.amountTolerance ?? 0.009;
    if (provider.amount === null || !Number.isFinite(provider.amount)) {
        return { ok: false, reason: "importe_ausente", detail: { expectedAmount: expected.amount } };
    }
    if (Math.abs(provider.amount - expected.amount) > tolerance) {
        return {
            ok: false,
            reason: "importe_distinto",
            detail: { expectedAmount: expected.amount, paidAmount: provider.amount },
        };
    }
    if (!provider.currency) {
        return { ok: false, reason: "moneda_ausente", detail: { expectedCurrency: expected.currency } };
    }
    if (provider.currency.toUpperCase() !== expected.currency.toUpperCase()) {
        return {
            ok: false,
            reason: "moneda_distinta",
            detail: { expectedCurrency: expected.currency, paidCurrency: provider.currency },
        };
    }
    if (policy.expectedCollectorId) {
        if (!provider.collectorId || String(provider.collectorId) !== String(policy.expectedCollectorId)) {
            return {
                ok: false,
                reason: "cuenta_distinta",
                detail: { collectorId: provider.collectorId ?? null },
            };
        }
    }
    if (policy.requireLiveMode && provider.liveMode === false) {
        return { ok: false, reason: "modo_sandbox", detail: {} };
    }
    return { ok: true };
}
/**
 * Toma el identificador del recurso del proveedor. Es el unico dato del
 * request que se usa, y va firmado dentro del manifiesto HMAC.
 */
function extraerIdRecursoProveedor(body, query) {
    const data = body.data && typeof body.data === "object" ? body.data : {};
    const candidates = [query["data.id"], query.id, query.payment_id, data.id, body.id, body.payment_id];
    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim())
            return candidate.trim();
        if (typeof candidate === "number" && Number.isFinite(candidate))
            return String(candidate);
    }
    return null;
}
// Mismo conjunto que aceptaba el handler anterior, menos los sinonimos en
// castellano: el estado ya no puede venir de un body arbitrario, solo de la
// API del proveedor. No se agrega `charged_back` a proposito: cancelaria una
// orden ya pagada y restauraria stock sin intervencion humana.
const ESTADOS_APROBADOS = new Set(["approved", "paid", "success", "succeeded", "processed"]);
const ESTADOS_EXPIRADOS = new Set(["expired"]);
const ESTADOS_RECHAZADOS = new Set(["rejected", "cancelled", "canceled", "refunded", "failed", "failure"]);
/**
 * Normaliza el estado devuelto por la API del proveedor. Solo acepta los
 * literales que devuelve Mercado Pago; no hay sinonimos en castellano porque
 * el estado ya no viene de un body arbitrario.
 */
function normalizarEstadoProveedor(raw) {
    const status = String(raw ?? "").trim().toLowerCase();
    if (!status)
        return null;
    if (ESTADOS_APROBADOS.has(status))
        return "approved";
    if (ESTADOS_EXPIRADOS.has(status))
        return "expired";
    if (ESTADOS_RECHAZADOS.has(status))
        return "rejected";
    return null;
}
