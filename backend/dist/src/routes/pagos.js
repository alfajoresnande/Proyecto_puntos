"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = require("crypto");
const express_1 = require("express");
const db_1 = require("../db");
const realtime_1 = require("../realtime");
const orderLifecycle_1 = require("../services/orderLifecycle");
const paymentProviders_1 = require("../services/paymentProviders");
const pendingCheckout_1 = require("../services/pendingCheckout");
const securityMonitor_1 = require("../securityMonitor");
const email_1 = require("../services/email");
const router = (0, express_1.Router)();
const MERCADOPAGO_WEBHOOK_SECRET = (process.env.MERCADOPAGO_WEBHOOK_SECRET || "").trim();
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
    const match = reference.match(/(?:orden|order|pedido)[_-]?(\d+)/i);
    if (!match)
        return null;
    const parsed = Number(match[1]);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
function parseCheckoutIdFromReference(reference) {
    if (!reference)
        return null;
    const match = reference.match(/(?:checkout|pago|payment)[_-]?(\d+)/i);
    if (!match)
        return null;
    const parsed = Number(match[1]);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
function parseManualChargeIdFromReference(reference) {
    if (!reference)
        return null;
    const match = reference.match(/cobro[_-]?manual[_-]?(\d+)/i);
    if (!match)
        return null;
    const parsed = Number(match[1]);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
function resolveManualChargeId(body, query) {
    const metadata = asRecord(body.metadata);
    const data = asRecord(body.data);
    const dataMetadata = asRecord(data.metadata);
    const payment = asRecord(body.payment);
    const paymentMetadata = asRecord(payment.metadata);
    return parseManualChargeIdFromReference(firstString(body.cobro_manual_id, metadata.cobro_manual_id, dataMetadata.cobro_manual_id, paymentMetadata.cobro_manual_id, body.external_reference, metadata.external_reference, data.external_reference, payment.external_reference, query.external_reference));
}
function resolveTransactionAmount(payload) {
    const paymentLookup = asRecord(payload.payment_lookup);
    const qrOrderLookup = asRecord(payload.qr_order_lookup);
    const qrTransactions = asRecord(qrOrderLookup.transactions);
    const qrPayments = Array.isArray(qrTransactions.payments) ? qrTransactions.payments : [];
    const qrPayment = asRecord(qrPayments[0]);
    const payment = asRecord(payload.payment);
    const data = asRecord(payload.data);
    const candidates = [
        paymentLookup.transaction_amount,
        qrOrderLookup.total_amount,
        qrPayment.amount,
        payment.transaction_amount,
        data.transaction_amount,
        payload.transaction_amount,
    ];
    for (const candidate of candidates) {
        const parsed = Number(candidate);
        if (Number.isFinite(parsed) && parsed > 0)
            return parsed;
    }
    return null;
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
function resolveCheckoutId(body, query) {
    const metadata = asRecord(body.metadata);
    const data = asRecord(body.data);
    const dataMetadata = asRecord(data.metadata);
    const payment = asRecord(body.payment);
    const paymentMetadata = asRecord(payment.metadata);
    const direct = firstString(body.checkout_id, metadata.checkout_id, dataMetadata.checkout_id, paymentMetadata.checkout_id, query.checkout_id);
    const directId = parseCheckoutIdFromReference(direct);
    if (directId)
        return directId;
    return parseCheckoutIdFromReference(firstString(body.external_reference, metadata.external_reference, data.external_reference, payment.external_reference, query.external_reference));
}
function resolveProviderPaymentId(body, query) {
    const data = asRecord(body.data);
    const payment = asRecord(body.payment);
    return firstString(body.provider_payment_id, body.payment_id, data.id, payment.id, body.id, query["data.id"], query.payment_id, query.id);
}
function resolvePaymentStatus(body, query) {
    const data = asRecord(body.data);
    const payment = asRecord(body.payment);
    const raw = firstString(body.status, body.estado, data.status, payment.status, query.status, query.estado);
    const status = raw?.toLowerCase() ?? "";
    if (["approved", "aprobado", "paid", "pagada", "success", "succeeded", "processed"].includes(status))
        return "approved";
    if (["expired", "expirada", "vencida"].includes(status))
        return "expired";
    if (["rejected", "rechazado", "failed", "failure", "cancelled", "canceled", "cancelada", "refunded"].includes(status)) {
        return "rejected";
    }
    return null;
}
function parseMercadoPagoSignature(signatureHeader) {
    let ts = null;
    let v1 = null;
    for (const part of signatureHeader.split(",")) {
        const [rawKey, rawValue] = part.split("=", 2);
        const key = rawKey?.trim().toLowerCase();
        const value = rawValue?.trim() || null;
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
    const leftBuffer = Buffer.from(left, "hex");
    const rightBuffer = Buffer.from(right, "hex");
    if (leftBuffer.length === 0 || rightBuffer.length === 0 || leftBuffer.length !== rightBuffer.length) {
        return false;
    }
    return (0, crypto_1.timingSafeEqual)(leftBuffer, rightBuffer);
}
function validateMercadoPagoWebhook(req) {
    if (!MERCADOPAGO_WEBHOOK_SECRET)
        return false;
    const signatureHeader = req.get("x-signature")?.trim() || "";
    const requestId = req.get("x-request-id")?.trim() || "";
    const dataId = (firstString(req.query["data.id"]) || "").toLowerCase();
    if (!signatureHeader)
        return false;
    const { ts, v1 } = parseMercadoPagoSignature(signatureHeader);
    if (!ts || !v1)
        return false;
    const manifestParts = [];
    if (dataId)
        manifestParts.push(`id:${dataId}`);
    if (requestId)
        manifestParts.push(`request-id:${requestId}`);
    manifestParts.push(`ts:${ts}`);
    if (!manifestParts.length)
        return false;
    const manifest = `${manifestParts.join(";")};`;
    const expectedSignature = (0, crypto_1.createHmac)("sha256", MERCADOPAGO_WEBHOOK_SECRET).update(manifest).digest("hex");
    return secureHexEquals(expectedSignature, v1);
}
router.post("/webhook/:proveedor", async (req, res) => {
    const proveedor = String(req.params.proveedor || "").trim().toLowerCase();
    const body = asRecord(req.body);
    const query = asRecord(req.query);
    let orderId = resolveOrderId(body, query);
    let checkoutId = resolveCheckoutId(body, query);
    let manualChargeId = resolveManualChargeId(body, query);
    let providerPaymentId = resolveProviderPaymentId(body, query);
    let status = resolvePaymentStatus(body, query);
    let resolvedPayload = { body, query };
    const isQrOrderNotification = Boolean(providerPaymentId?.toUpperCase().startsWith("ORD"));
    if (proveedor === "mercadopago") {
        const hasSignature = Boolean(req.get("x-signature")?.trim());
        // Mercado Pago no firma las notificaciones de Orders QR. Solo se aceptan
        // sin firma cuando el recurso es una order QR y luego se valida por API.
        const signatureAccepted = hasSignature ? validateMercadoPagoWebhook(req) : isQrOrderNotification;
        if (!signatureAccepted) {
            (0, securityMonitor_1.recordSecurityEvent)("pago_webhook_firma_invalida", req, {
                proveedor,
                hasSecret: Boolean(MERCADOPAGO_WEBHOOK_SECRET),
                hasSignature,
                providerPaymentId,
            });
            res.status(401).json({ error: "Firma del webhook de Mercado Pago invalida o ausente." });
            return;
        }
        if (!providerPaymentId) {
            (0, securityMonitor_1.recordSecurityEvent)("pago_webhook_sin_payment_id", req, { proveedor });
            res.status(400).json({ error: "La notificacion no incluye un identificador de pago verificable." });
            return;
        }
    }
    if (proveedor === "mercadopago" && providerPaymentId && isQrOrderNotification) {
        try {
            const order = await (0, paymentProviders_1.getMercadoPagoQrOrder)(providerPaymentId);
            orderId = order.orderId;
            checkoutId = order.checkoutId;
            manualChargeId = null;
            providerPaymentId = order.providerPaymentId ?? providerPaymentId;
            status = resolvePaymentStatus({ status: order.status }, {});
            resolvedPayload = {
                body,
                query,
                qr_order_lookup: order.payload,
            };
        }
        catch (error) {
            (0, securityMonitor_1.recordSecurityEvent)("pago_webhook_qr_order_lookup_fallido", req, {
                proveedor,
                providerPaymentId,
                reason: error instanceof Error ? error.message : "lookup_error",
            });
            res.status(502).json({ error: "No se pudo verificar la order QR con Mercado Pago." });
            return;
        }
    }
    if (proveedor === "mercadopago" && providerPaymentId && !isQrOrderNotification) {
        try {
            const payment = await (0, paymentProviders_1.getMercadoPagoPayment)(providerPaymentId);
            orderId = payment.orderId;
            checkoutId = payment.checkoutId;
            manualChargeId = payment.manualChargeId;
            providerPaymentId = payment.providerPaymentId ?? providerPaymentId;
            status = resolvePaymentStatus({ status: payment.status }, {});
            resolvedPayload = {
                body,
                query,
                payment_lookup: payment.payload,
            };
        }
        catch (error) {
            (0, securityMonitor_1.recordSecurityEvent)("pago_webhook_lookup_fallido", req, {
                proveedor,
                providerPaymentId,
                reason: error instanceof Error ? error.message : "lookup_error",
            });
            res.status(502).json({ error: "No se pudo verificar el pago con Mercado Pago." });
            return;
        }
    }
    if (!orderId && !checkoutId && !manualChargeId) {
        (0, securityMonitor_1.recordSecurityEvent)("pago_webhook_sin_orden", req, { proveedor, providerPaymentId });
        res.status(202).json({ ok: true, ignored: true, reason: "referencia_no_identificada" });
        return;
    }
    if (!status) {
        res.status(202).json({ ok: true, ignored: true, reason: "estado_no_accionable", orden_id: orderId, checkout_id: checkoutId, cobro_manual_id: manualChargeId });
        return;
    }
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        if (manualChargeId) {
            const cobro = await (0, db_1.qOne)(conn, "SELECT id, monto, estado FROM cobros_manuales WHERE id = ? FOR UPDATE", [manualChargeId]);
            if (!cobro)
                throw new Error("Cobro manual inexistente.");
            const paidAmount = resolveTransactionAmount(resolvedPayload);
            if (status === "approved" && paidAmount === null) {
                throw new Error("No se pudo verificar el importe aprobado con Mercado Pago.");
            }
            if (status === "approved" && paidAmount !== null && Math.abs(Number(cobro.monto) - paidAmount) > 0.009) {
                (0, securityMonitor_1.recordSecurityEvent)("cobro_manual_monto_invalido", req, {
                    cobroId: manualChargeId,
                    expectedAmount: Number(cobro.monto),
                    paidAmount,
                    providerPaymentId,
                });
                throw new Error("El importe informado por Mercado Pago no coincide con el cobro manual.");
            }
            if (cobro.estado === "aprobado" && status !== "approved") {
                await conn.commit();
                res.json({ ok: true, cobro_manual_id: manualChargeId, estado: "aprobado", ignored: true });
                return;
            }
            const nextState = status === "approved" ? "aprobado" : status === "expired" ? "expirado" : "rechazado";
            await (0, db_1.qRun)(conn, `UPDATE cobros_manuales
         SET estado = ?, provider_payment_id = COALESCE(?, provider_payment_id), payload_json = ?,
             approved_at = IF(? = 'aprobado', COALESCE(approved_at, CURRENT_TIMESTAMP), approved_at)
         WHERE id = ?`, [nextState, providerPaymentId, JSON.stringify(resolvedPayload), nextState, manualChargeId]);
            await conn.commit();
            (0, realtime_1.emitRealtime)(["cobros-manuales"]);
            res.json({ ok: true, cobro_manual_id: manualChargeId, estado: nextState });
            return;
        }
        if (proveedor === "mercadopago" && status === "approved") {
            const expected = orderId
                ? await (0, db_1.qOne)(conn, "SELECT total_dinero AS monto FROM ordenes WHERE id = ? FOR UPDATE", [orderId])
                : await (0, db_1.qOne)(conn, "SELECT total_dinero AS monto FROM checkout_pendientes WHERE id = ? FOR UPDATE", [Number(checkoutId)]);
            if (!expected)
                throw new Error("No existe la compra asociada al pago aprobado.");
            const paidAmount = resolveTransactionAmount(resolvedPayload);
            if (paidAmount === null || Math.abs(Number(expected.monto) - paidAmount) > 0.009) {
                (0, securityMonitor_1.recordSecurityEvent)("pago_webhook_monto_invalido", req, {
                    orderId,
                    checkoutId,
                    expectedAmount: Number(expected.monto),
                    paidAmount,
                    providerPaymentId,
                });
                throw new Error("El importe aprobado por Mercado Pago no coincide con la compra.");
            }
        }
        const result = orderId
            ? (status === "approved"
                ? await (0, orderLifecycle_1.approvePaidOrder)(conn, {
                    orderId,
                    provider: proveedor,
                    providerPaymentId,
                    payload: resolvedPayload,
                })
                : await (0, orderLifecycle_1.rejectOrExpirePendingOrder)(conn, {
                    orderId,
                    nextState: status === "expired" ? "expirada" : "cancelada",
                    provider: proveedor,
                    providerPaymentId,
                    payload: resolvedPayload,
                }))
            : (status === "approved"
                ? await (0, pendingCheckout_1.approvePendingCheckoutAndCreateOrder)(conn, {
                    checkoutId: Number(checkoutId),
                    providerPaymentId,
                    payload: resolvedPayload,
                })
                : await (0, pendingCheckout_1.rejectOrExpirePendingCheckout)(conn, {
                    checkoutId: Number(checkoutId),
                    nextState: status === "expired" ? "expirada" : "cancelada",
                    providerPaymentId,
                    payload: resolvedPayload,
                }));
        await conn.commit();
        (0, realtime_1.emitRealtime)(["ordenes", "inventario", "productos", "stats", "puntos"]);
        if (status === "approved") {
            const receiptOrderId = orderId || result.orderId || null;
            if (receiptOrderId) {
                void (0, email_1.sendOrderReceiptEmail)(receiptOrderId).catch((error) => {
                    console.error(`[MAIL] Error enviando comprobante orden #${receiptOrderId}:`, error instanceof Error ? error.message : error);
                });
            }
        }
        if (!orderId && checkoutId) {
            res.json({
                ok: true,
                checkout_id: checkoutId,
                ...(status === "approved"
                    ? { orden_id: result.orderId, estado: "pagada" }
                    : { estado: status === "expired" ? "expirada" : "cancelada" }),
            });
            return;
        }
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
