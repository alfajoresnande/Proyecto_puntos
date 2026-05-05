"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const orderLifecycle_1 = require("../services/orderLifecycle");
const securityMonitor_1 = require("../securityMonitor");
const router = (0, express_1.Router)();
function asRecord(value) {
    return value && typeof value === "object" ? value : {};
}
function firstString(...values) {
    for (const value of values) {
        if (typeof value === "string" && value.trim())
            return value.trim();
        if (typeof value === "number" && Number.isFinite(value))
            return String(value);
    }
    return null;
}
function parseOrderIdFromReference(reference) {
    if (!reference)
        return null;
    const direct = Number(reference);
    if (Number.isInteger(direct) && direct > 0)
        return direct;
    const match = reference.match(/(?:orden|order)[_-]?(\d+)/i);
    if (!match)
        return null;
    const parsed = Number(match[1]);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
function resolveOrderId(body, query) {
    const metadata = asRecord(body.metadata);
    const data = asRecord(body.data);
    const dataMetadata = asRecord(data.metadata);
    const payment = asRecord(body.payment);
    const paymentMetadata = asRecord(payment.metadata);
    const direct = firstString(body.order_id, body.orden_id, metadata.order_id, dataMetadata.order_id, paymentMetadata.order_id, query.order_id, query.orden_id);
    const directId = parseOrderIdFromReference(direct);
    if (directId)
        return directId;
    return parseOrderIdFromReference(firstString(body.external_reference, metadata.external_reference, data.external_reference, payment.external_reference, query.external_reference));
}
function resolveProviderPaymentId(body, query) {
    const data = asRecord(body.data);
    const payment = asRecord(body.payment);
    return firstString(body.provider_payment_id, body.payment_id, body.id, data.id, payment.id, query["data.id"], query.payment_id, query.id);
}
function resolvePaymentStatus(body, query) {
    const data = asRecord(body.data);
    const payment = asRecord(body.payment);
    const raw = firstString(body.status, body.estado, data.status, payment.status, query.status, query.estado);
    const status = raw?.toLowerCase() ?? "";
    if (["approved", "aprobado", "paid", "pagada", "success", "succeeded"].includes(status))
        return "approved";
    if (["expired", "expirada", "vencida"].includes(status))
        return "expired";
    if (["rejected", "rechazado", "failed", "failure", "cancelled", "canceled", "cancelada"].includes(status)) {
        return "rejected";
    }
    return null;
}
router.post("/webhook/:proveedor", async (req, res) => {
    const proveedor = String(req.params.proveedor || "").trim().toLowerCase();
    const body = asRecord(req.body);
    const query = asRecord(req.query);
    const orderId = resolveOrderId(body, query);
    const providerPaymentId = resolveProviderPaymentId(body, query);
    const status = resolvePaymentStatus(body, query);
    if (!orderId) {
        (0, securityMonitor_1.recordSecurityEvent)("pago_webhook_sin_orden", req, { proveedor, providerPaymentId });
        res.status(202).json({ ok: true, ignored: true, reason: "orden_no_identificada" });
        return;
    }
    if (!status) {
        res.status(202).json({ ok: true, ignored: true, reason: "estado_no_accionable", orden_id: orderId });
        return;
    }
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        const result = status === "approved"
            ? await (0, orderLifecycle_1.approvePaidOrder)(conn, {
                orderId,
                provider: proveedor,
                providerPaymentId,
                payload: { body, query },
            })
            : await (0, orderLifecycle_1.rejectOrExpirePendingOrder)(conn, {
                orderId,
                nextState: status === "expired" ? "expirada" : "cancelada",
                provider: proveedor,
                providerPaymentId,
                payload: { body, query },
            });
        await conn.commit();
        res.json(result);
    }
    catch (err) {
        await conn.rollback();
        const message = err instanceof Error ? err.message : "No se pudo procesar el webhook.";
        res.status(400).json({ error: message });
    }
    finally {
        conn.release();
    }
});
exports.default = router;
