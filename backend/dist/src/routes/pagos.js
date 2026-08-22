"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const realtime_1 = require("../realtime");
const orderLifecycle_1 = require("../services/orderLifecycle");
const paymentProviders_1 = require("../services/paymentProviders");
const pendingCheckout_1 = require("../services/pendingCheckout");
const securityMonitor_1 = require("../securityMonitor");
const authRateLimit_1 = require("../services/authRateLimit");
const email_1 = require("../services/email");
const paymentWebhooks_1 = require("../services/paymentWebhooks");
const router = (0, express_1.Router)();
const IS_PRODUCTION = (process.env.NODE_ENV || "").trim().toLowerCase() === "production";
const MERCADOPAGO_WEBHOOK_SECRET = (process.env.MERCADOPAGO_WEBHOOK_SECRET || "").trim();
const MERCADOPAGO_COLLECTOR_ID = (process.env.MERCADOPAGO_COLLECTOR_ID || "").trim();
const EXPECTED_CURRENCY = (process.env.PAYMENTS_CURRENCY || "ARS").trim().toUpperCase();
function parsePositiveIntEnv(name, fallback) {
    const parsed = Number((process.env[name] || "").trim());
    if (!Number.isFinite(parsed) || parsed < 0)
        return fallback;
    return Math.floor(parsed);
}
/** Ventana de frescura del `ts` firmado. 0 la desactiva. */
const WEBHOOK_TOLERANCE_SECONDS = parsePositiveIntEnv("MERCADOPAGO_WEBHOOK_TOLERANCE_SECONDS", 900);
/**
 * Mercado Pago NO firma las notificaciones de Orders QR. La autenticidad de
 * ese camino no viene de una firma sino de la consulta a la API con nuestro
 * access token: un `ORD...` de otra cuenta responde 404. Aun asi es una
 * excepcion y se puede apagar con MERCADOPAGO_QR_WEBHOOK_SIN_FIRMA=false.
 */
const ALLOW_UNSIGNED_QR_ORDER = ((process.env.MERCADOPAGO_QR_WEBHOOK_SIN_FIRMA || "true").trim().toLowerCase() !== "false");
function asRecord(value) {
    return value && typeof value === "object" ? value : {};
}
function verificationPolicy() {
    return {
        expectedCollectorId: MERCADOPAGO_COLLECTOR_ID || null,
        expectedCurrency: EXPECTED_CURRENCY,
        requireLiveMode: IS_PRODUCTION,
    };
}
/**
 * Registra la notificacion en el ledger de idempotencia.
 * Devuelve false si ya habia sido procesada (replay).
 */
async function registrarEventoWebhook(conn, input) {
    const { affectedRows } = await (0, db_1.qRun)(conn, `INSERT IGNORE INTO pago_webhook_eventos
       (proveedor, recurso_id, estado, referencia_tipo, referencia_id, importe, moneda)
     VALUES (?, ?, ?, ?, ?, ?, ?)`, [
        input.proveedor,
        input.recursoId,
        input.estado,
        input.referencia?.kind ?? null,
        input.referencia?.id ?? null,
        input.importe,
        input.moneda,
    ]);
    return affectedRows > 0;
}
/**
 * Limite de caudal de la parte cara del webhook.
 *
 * Se aplica DESPUES de la allowlist y de la firma, a proposito: los rechazos
 * baratos no deben depender de MySQL ni consumir cupo. Lo que se limita es lo
 * que gasta recursos, sobre todo el camino de Orders QR, que se acepta sin
 * firma (Mercado Pago no las firma) y dispara una consulta saliente a su API
 * por cada notificacion; sin tope, el endpoint sirve de amplificador contra
 * Mercado Pago y agota nuestro cupo con ellos.
 *
 * Los limites son holgados: el volumen real de un comercio chico esta muy por
 * debajo y las notificaciones legitimas llegan desde pocas IPs.
 */
const WEBHOOK_RATE_WINDOWS = [
    { name: "pago_webhook_min", limit: 120, windowSeconds: 60 },
    { name: "pago_webhook_hora", limit: 1200, windowSeconds: 3600 },
];
async function comprobarCaudalWebhook(ip) {
    try {
        const result = await (0, authRateLimit_1.checkRateLimit)({
            action: "pago_webhook",
            keys: WEBHOOK_RATE_WINDOWS.map((window) => ({
                key: `ip_${window.name}:${ip}`,
                limit: window.limit,
                windowSeconds: window.windowSeconds,
            })),
        });
        if (result.allowed)
            return { ok: true };
        return { ok: false, status: 429, retryAfterSeconds: Math.max(1, Math.ceil(result.retryAfterSeconds ?? 60)) };
    }
    catch {
        // Sin base no se puede ni contar ni procesar el pago. Se responde 503 para
        // que el proveedor reintente, en vez de un 500 que parece un bug nuestro.
        return { ok: false, status: 503, retryAfterSeconds: 60 };
    }
}
router.post("/webhook/:proveedor", async (req, res) => {
    // 1. Allowlist de proveedores. Cualquier otro nombre no llega a interpretar
    //    el payload: antes bastaba inventar un proveedor para saltarse la firma.
    const proveedor = (0, paymentWebhooks_1.normalizarProveedorWebhook)(req.params.proveedor);
    if (!proveedor) {
        (0, securityMonitor_1.recordSecurityEvent)("pago_webhook_proveedor_no_permitido", req, {
            proveedor: String(req.params.proveedor || "").slice(0, 40),
        });
        res.status(404).json({ error: "Proveedor de pagos no soportado." });
        return;
    }
    const body = asRecord(req.body);
    const query = asRecord(req.query);
    // 2. Del request solo se toma el puntero al recurso del proveedor.
    const recursoId = (0, paymentWebhooks_1.extraerIdRecursoProveedor)(body, query);
    if (!recursoId) {
        (0, securityMonitor_1.recordSecurityEvent)("pago_webhook_sin_payment_id", req, { proveedor });
        res.status(400).json({ error: "La notificacion no incluye un identificador de pago verificable." });
        return;
    }
    const esOrderQr = recursoId.toUpperCase().startsWith("ORD");
    // 3. Autenticidad. El data.id firmado en el manifiesto tiene que ser el
    //    mismo recurso que vamos a consultar.
    const firma = (0, paymentWebhooks_1.verificarFirmaMercadoPago)({
        signatureHeader: req.get("x-signature"),
        requestId: req.get("x-request-id"),
        dataId: recursoId,
        secret: MERCADOPAGO_WEBHOOK_SECRET,
        toleranceSeconds: WEBHOOK_TOLERANCE_SECONDS,
    });
    if (!firma.ok) {
        const excepcionQrPermitida = esOrderQr && ALLOW_UNSIGNED_QR_ORDER && firma.reason === "firma_ausente";
        if (!excepcionQrPermitida) {
            (0, securityMonitor_1.recordSecurityEvent)("pago_webhook_firma_invalida", req, {
                proveedor,
                reason: firma.reason,
                recursoId,
            });
            res.status(401).json({ error: "Firma del webhook invalida o ausente." });
            return;
        }
        (0, securityMonitor_1.recordSecurityEvent)("pago_webhook_qr_sin_firma", req, { proveedor, recursoId });
    }
    // 4. Recien aca, con el proveedor y la firma ya validados, se limita el
    //    caudal: lo que sigue consulta la API del proveedor y toca la base.
    const caudal = await comprobarCaudalWebhook(String(req.ip || req.socket.remoteAddress || "unknown").slice(0, 120));
    if (!caudal.ok) {
        if (caudal.status === 429) {
            (0, securityMonitor_1.recordSecurityEvent)("pago_webhook_rate_limit", req, { proveedor, recursoId });
        }
        res.setHeader("Retry-After", String(caudal.retryAfterSeconds));
        res.status(caudal.status).json({
            error: caudal.status === 429
                ? "Demasiadas notificaciones. Reintenta mas tarde."
                : "El servicio no puede procesar notificaciones en este momento. Reintenta mas tarde.",
        });
        return;
    }
    // 5. Estado, importe, moneda, cuenta y referencia salen de la API del
    //    proveedor. Nada de esto se lee del request.
    let verificado;
    try {
        if (esOrderQr) {
            const order = await (0, paymentProviders_1.getMercadoPagoQrOrder)(recursoId);
            verificado = {
                providerPaymentId: order.paymentId ?? order.providerPaymentId ?? recursoId,
                status: (0, paymentWebhooks_1.normalizarEstadoProveedor)(order.status),
                referencia: order.orderId
                    ? { kind: "orden", id: order.orderId }
                    : order.checkoutId
                        ? { kind: "checkout", id: order.checkoutId }
                        : null,
                datos: {
                    amount: order.amount,
                    currency: order.currency,
                    collectorId: order.collectorId,
                    liveMode: order.liveMode,
                },
                payload: { qr_order_lookup: order.payload },
            };
        }
        else {
            const payment = await (0, paymentProviders_1.getMercadoPagoPayment)(recursoId);
            verificado = {
                providerPaymentId: payment.providerPaymentId ?? recursoId,
                status: (0, paymentWebhooks_1.normalizarEstadoProveedor)(payment.status),
                referencia: payment.manualChargeId
                    ? { kind: "cobro_manual", id: payment.manualChargeId }
                    : payment.orderId
                        ? { kind: "orden", id: payment.orderId }
                        : payment.checkoutId
                            ? { kind: "checkout", id: payment.checkoutId }
                            : null,
                datos: {
                    amount: payment.amount,
                    currency: payment.currency,
                    collectorId: payment.collectorId,
                    liveMode: payment.liveMode,
                },
                payload: { payment_lookup: payment.payload },
            };
        }
    }
    catch (error) {
        (0, securityMonitor_1.recordSecurityEvent)("pago_webhook_lookup_fallido", req, {
            proveedor,
            recursoId,
            reason: error instanceof Error ? error.message : "lookup_error",
        });
        res.status(502).json({ error: "No se pudo verificar el pago con el proveedor." });
        return;
    }
    const { referencia, status } = verificado;
    if (!referencia) {
        (0, securityMonitor_1.recordSecurityEvent)("pago_webhook_sin_orden", req, { proveedor, recursoId });
        res.status(202).json({ ok: true, ignored: true, reason: "referencia_no_identificada" });
        return;
    }
    if (!status) {
        res.status(202).json({ ok: true, ignored: true, reason: "estado_no_accionable" });
        return;
    }
    const resolvedPayload = {
        ...verificado.payload,
        provider_payment_id: verificado.providerPaymentId,
        verified_at: new Date().toISOString(),
    };
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        // 6. Idempotencia: un replay de la misma notificacion no vuelve a mover
        //    ordenes, stock ni puntos.
        const esNuevo = await registrarEventoWebhook(conn, {
            proveedor,
            recursoId,
            estado: status,
            referencia,
            importe: verificado.datos.amount,
            moneda: verificado.datos.currency,
        });
        if (!esNuevo) {
            await conn.commit();
            res.json({ ok: true, ignored: true, reason: "evento_ya_procesado" });
            return;
        }
        // 7. La referencia tiene que existir en nuestra base, y si el pago esta
        //    aprobado, importe/moneda/cuenta tienen que coincidir.
        if (referencia.kind === "cobro_manual") {
            const cobro = await (0, db_1.qOne)(conn, "SELECT id, monto, estado FROM cobros_manuales WHERE id = ? FOR UPDATE", [referencia.id]);
            if (!cobro)
                throw new Error("Cobro manual inexistente.");
            if (status === "approved") {
                const check = (0, paymentWebhooks_1.verificarPagoContraCompra)(verificado.datos, { amount: Number(cobro.monto), currency: EXPECTED_CURRENCY }, verificationPolicy());
                if (!check.ok) {
                    (0, securityMonitor_1.recordSecurityEvent)("cobro_manual_monto_invalido", req, {
                        cobroId: referencia.id,
                        reason: check.reason,
                        ...check.detail,
                    });
                    throw new Error("El pago informado por el proveedor no coincide con el cobro manual.");
                }
            }
            if (cobro.estado === "aprobado" && status !== "approved") {
                await conn.commit();
                res.json({ ok: true, cobro_manual_id: referencia.id, estado: "aprobado", ignored: true });
                return;
            }
            const nextState = status === "approved" ? "aprobado" : status === "expired" ? "expirado" : "rechazado";
            await (0, db_1.qRun)(conn, `UPDATE cobros_manuales
         SET estado = ?, provider_payment_id = COALESCE(?, provider_payment_id), payload_json = ?,
             approved_at = IF(? = 'aprobado', COALESCE(approved_at, CURRENT_TIMESTAMP), approved_at),
             oculto = IF(? = 'aprobado', 0, oculto)
         WHERE id = ?`, [nextState, verificado.providerPaymentId, JSON.stringify(resolvedPayload), nextState, nextState, referencia.id]);
            await conn.commit();
            (0, realtime_1.emitRealtime)(["cobros-manuales"]);
            res.json({ ok: true, cobro_manual_id: referencia.id, estado: nextState });
            return;
        }
        const orderId = referencia.kind === "orden" ? referencia.id : null;
        const checkoutId = referencia.kind === "checkout" ? referencia.id : null;
        if (status === "approved") {
            const expected = orderId
                ? await (0, db_1.qOne)(conn, "SELECT total_dinero AS monto FROM ordenes WHERE id = ? FOR UPDATE", [orderId])
                : await (0, db_1.qOne)(conn, "SELECT total_dinero AS monto FROM checkout_pendientes WHERE id = ? FOR UPDATE", [checkoutId]);
            if (!expected)
                throw new Error("No existe la compra asociada al pago aprobado.");
            const check = (0, paymentWebhooks_1.verificarPagoContraCompra)(verificado.datos, { amount: Number(expected.monto), currency: EXPECTED_CURRENCY }, verificationPolicy());
            if (!check.ok) {
                (0, securityMonitor_1.recordSecurityEvent)("pago_webhook_monto_invalido", req, {
                    orderId,
                    checkoutId,
                    reason: check.reason,
                    recursoId,
                    ...check.detail,
                });
                throw new Error("El pago aprobado por el proveedor no coincide con la compra.");
            }
        }
        const result = orderId
            ? (status === "approved"
                ? await (0, orderLifecycle_1.approvePaidOrder)(conn, {
                    orderId,
                    provider: proveedor,
                    providerPaymentId: verificado.providerPaymentId,
                    payload: resolvedPayload,
                })
                : await (0, orderLifecycle_1.rejectOrExpirePendingOrder)(conn, {
                    orderId,
                    nextState: status === "expired" ? "expirada" : "cancelada",
                    provider: proveedor,
                    providerPaymentId: verificado.providerPaymentId,
                    payload: resolvedPayload,
                }))
            : (status === "approved"
                ? await (0, pendingCheckout_1.approvePendingCheckoutAndCreateOrder)(conn, {
                    checkoutId: Number(checkoutId),
                    providerPaymentId: verificado.providerPaymentId,
                    payload: resolvedPayload,
                })
                : await (0, pendingCheckout_1.rejectOrExpirePendingCheckout)(conn, {
                    checkoutId: Number(checkoutId),
                    nextState: status === "expired" ? "expirada" : "cancelada",
                    providerPaymentId: verificado.providerPaymentId,
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
        // El detalle interno queda en el log de seguridad, no en la respuesta.
        (0, securityMonitor_1.recordSecurityEvent)("pago_webhook_procesamiento_fallido", req, {
            proveedor,
            recursoId,
            reason: err instanceof Error ? err.message : "error_desconocido",
        });
        res.status(400).json({ error: "No se pudo procesar la notificacion de pago." });
    }
    finally {
        conn.release();
    }
});
exports.default = router;
