"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listPaymentOptions = listPaymentOptions;
exports.resolvePaymentChoice = resolvePaymentChoice;
exports.getMercadoPagoPayment = getMercadoPagoPayment;
exports.processMercadoPagoApiPayment = processMercadoPagoApiPayment;
exports.createPaymentSession = createPaymentSession;
exports.isPaymentChoiceAvailable = isPaymentChoiceAvailable;
const crypto_1 = require("crypto");
const IS_PRODUCTION = (process.env.NODE_ENV || "").trim().toLowerCase() === "production";
const MERCADOPAGO_ACCESS_TOKEN = (process.env.MERCADOPAGO_ACCESS_TOKEN || "").trim();
const MERCADOPAGO_PUBLIC_KEY = (process.env.MERCADOPAGO_PUBLIC_KEY || process.env.MP_PUBLIC_KEY || "").trim();
const MERCADOPAGO_API_BASE = (process.env.MERCADOPAGO_API_BASE || "https://api.mercadopago.com").trim().replace(/\/+$/, "");
const MERCADOPAGO_WEBHOOK_URL = (process.env.MERCADOPAGO_WEBHOOK_URL || "").trim();
const DEFAULT_FRONTEND_URL = (process.env.FRONTEND_URL || "http://localhost:5173").split(",")[0].trim().replace(/\/+$/, "");
function mercadoPagoCredentialMode(value) {
    const normalized = value.trim().toUpperCase();
    if (!normalized)
        return "unknown";
    if (normalized.startsWith("TEST-"))
        return "test";
    if (normalized.startsWith("APP_USR-"))
        return "prod";
    return "unknown";
}
function mercadoPagoConfigurationIssue(choice) {
    if (choice.provider === "efectivo")
        return null;
    if (!MERCADOPAGO_ACCESS_TOKEN)
        return "Falta MERCADOPAGO_ACCESS_TOKEN";
    if (choice.method === "brick" && !MERCADOPAGO_PUBLIC_KEY) {
        return "Falta MERCADOPAGO_PUBLIC_KEY";
    }
    const accessTokenMode = mercadoPagoCredentialMode(MERCADOPAGO_ACCESS_TOKEN);
    const publicKeyMode = mercadoPagoCredentialMode(MERCADOPAGO_PUBLIC_KEY);
    if (choice.method === "brick" && accessTokenMode !== "unknown" && publicKeyMode !== "unknown" && accessTokenMode !== publicKeyMode) {
        return "MERCADOPAGO_ACCESS_TOKEN y MERCADOPAGO_PUBLIC_KEY no pertenecen al mismo entorno (test/prod).";
    }
    return null;
}
const PAYMENT_RETURN_PATHS = {
    PAYMENT_RETURN_SUCCESS_URL: "/mis-pedidos",
    PAYMENT_RETURN_PENDING_URL: "/mis-pedidos",
    PAYMENT_RETURN_FAILURE_URL: "/mis-pedidos",
};
function paymentReturnUrl(envName) {
    const fromEnv = (process.env[envName] || "").trim();
    if (fromEnv)
        return fromEnv;
    return `${DEFAULT_FRONTEND_URL}${PAYMENT_RETURN_PATHS[envName] ?? "/mis-pedidos"}`;
}
function toTwoDecimals(value) {
    return Number((Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2));
}
function isEnabled(choice) {
    if (choice.provider === "efectivo") {
        return { enabled: true, reason: null };
    }
    const configIssue = mercadoPagoConfigurationIssue(choice);
    if (configIssue) {
        return { enabled: false, reason: configIssue };
    }
    return { enabled: true, reason: null };
}
function listPaymentOptions() {
    const options = [
        {
            id: "mercadopago_brick",
            provider: "mercadopago",
            method: "brick",
            label: "Pagar con tarjeta",
            description: "Paga dentro de la tienda con tarjeta de credito, debito o prepaga.",
        },
        {
            id: "mercadopago_wallet",
            provider: "mercadopago",
            method: "wallet",
            label: "Pagar con Mercado Pago",
            description: "Abre Mercado Pago para pagar con tu cuenta o desde la app.",
        },
        {
            id: "efectivo_retiro",
            provider: "efectivo",
            method: "cash",
            label: "Efectivo al retirar",
            description: "Reserva el pedido y paga en la sucursal antes de retirar.",
        },
    ];
    return options.map((option) => {
        const check = isEnabled(option);
        return {
            ...option,
            enabled: check.enabled,
            reason_disabled: check.reason,
        };
    });
}
function resolvePaymentChoice(raw) {
    if (!raw || !raw.provider) {
        return { provider: "mercadopago", method: "brick" };
    }
    if (raw.provider === "mercadopago") {
        return raw.method === "wallet"
            ? { provider: "mercadopago", method: "wallet" }
            : { provider: "mercadopago", method: "brick" };
    }
    if (raw.provider === "efectivo") {
        return { provider: "efectivo", method: "cash" };
    }
    return { provider: "mercadopago", method: "brick" };
}
async function createMercadoPagoPreferenceSession(input) {
    const configIssue = mercadoPagoConfigurationIssue(input.choice);
    if (configIssue) {
        return {
            providerPaymentId: null,
            checkoutUrl: null,
            preferenceId: null,
            publicKey: null,
            payload: null,
            status: "requires_configuration",
            message: configIssue,
        };
    }
    const body = {
        external_reference: `orden_${input.orderId}`,
        ...(input.choice.method === "wallet" ? { purpose: "wallet_purchase" } : {}),
        items: [
            {
                title: input.description,
                quantity: 1,
                currency_id: input.currency || "ARS",
                unit_price: toTwoDecimals(input.amount),
            },
        ],
        payer: {
            name: input.buyerName || `Cliente #${input.orderId}`,
            email: input.buyerEmail,
        },
        back_urls: {
            success: paymentReturnUrl("PAYMENT_RETURN_SUCCESS_URL"),
            pending: paymentReturnUrl("PAYMENT_RETURN_PENDING_URL"),
            failure: paymentReturnUrl("PAYMENT_RETURN_FAILURE_URL"),
        },
        auto_return: "approved",
        ...(MERCADOPAGO_WEBHOOK_URL ? { notification_url: MERCADOPAGO_WEBHOOK_URL } : {}),
    };
    const response = await fetch(`${MERCADOPAGO_API_BASE}/checkout/preferences`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${MERCADOPAGO_ACCESS_TOKEN}`,
            "X-Idempotency-Key": (0, crypto_1.randomUUID)(),
        },
        body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({})));
    if (!response.ok) {
        const detail = typeof payload.message === "string" ? payload.message : `HTTP ${response.status}`;
        throw new Error(`Mercado Pago: no se pudo crear la preferencia (${detail}).`);
    }
    const checkoutUrl = (typeof payload.init_point === "string" ? payload.init_point : null) ??
        (typeof payload.sandbox_init_point === "string" ? payload.sandbox_init_point : null);
    return {
        providerPaymentId: typeof payload.id === "string" ? payload.id : null,
        preferenceId: typeof payload.id === "string" ? payload.id : null,
        publicKey: input.choice.method === "brick" ? MERCADOPAGO_PUBLIC_KEY : null,
        checkoutUrl,
        payload,
        status: "ready",
        message: checkoutUrl ? null : "Preferencia creada sin checkout_url.",
    };
}
function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
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
function toMercadoPagoPaymentResult(payload) {
    const metadata = asRecord(payload.metadata);
    const externalReference = firstString(payload.external_reference, metadata.external_reference);
    const directOrderId = firstString(metadata.order_id, payload.order_id);
    return {
        providerPaymentId: typeof payload.id === "string" || typeof payload.id === "number" ? String(payload.id) : null,
        status: typeof payload.status === "string" ? payload.status : "unknown",
        statusDetail: typeof payload.status_detail === "string" ? payload.status_detail : null,
        externalReference,
        orderId: parseOrderIdFromReference(directOrderId ?? externalReference),
        payload,
    };
}
async function getMercadoPagoPayment(paymentId) {
    if (!MERCADOPAGO_ACCESS_TOKEN) {
        throw new Error("Configura MERCADOPAGO_ACCESS_TOKEN para consultar pagos de Mercado Pago.");
    }
    const normalizedPaymentId = String(paymentId).trim();
    if (!normalizedPaymentId) {
        throw new Error("Payment ID invalido para consultar en Mercado Pago.");
    }
    const response = await fetch(`${MERCADOPAGO_API_BASE}/v1/payments/${encodeURIComponent(normalizedPaymentId)}`, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${MERCADOPAGO_ACCESS_TOKEN}`,
        },
    });
    const payload = (await response.json().catch(() => ({})));
    if (!response.ok) {
        const detail = typeof payload.message === "string" ? payload.message : `HTTP ${response.status}`;
        throw new Error(`Mercado Pago: no se pudo consultar el pago (${detail}).`);
    }
    return toMercadoPagoPaymentResult(payload);
}
async function processMercadoPagoApiPayment(input) {
    if (!MERCADOPAGO_ACCESS_TOKEN) {
        throw new Error("Configura MERCADOPAGO_ACCESS_TOKEN para procesar pagos con Checkout API.");
    }
    const normalizedAmount = toTwoDecimals(input.amount);
    const formData = asRecord(input.formData);
    const payer = asRecord(formData.payer);
    const payerEmail = typeof payer.email === "string" && payer.email.includes("@")
        ? payer.email.trim()
        : input.buyerEmail.trim();
    if (!payerEmail || !payerEmail.includes("@")) {
        throw new Error("Mercado Pago requiere un email de comprador valido.");
    }
    const body = {
        ...formData,
        transaction_amount: normalizedAmount,
        description: input.description,
        external_reference: `orden_${input.orderId}`,
        metadata: {
            ...asRecord(formData.metadata),
            order_id: input.orderId,
        },
        payer: {
            ...payer,
            email: payerEmail,
        },
    };
    const response = await fetch(`${MERCADOPAGO_API_BASE}/v1/payments`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${MERCADOPAGO_ACCESS_TOKEN}`,
            "X-Idempotency-Key": (0, crypto_1.randomUUID)(),
        },
        body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({})));
    if (!response.ok) {
        const detail = typeof payload.message === "string" ? payload.message : `HTTP ${response.status}`;
        throw new Error(`Mercado Pago: no se pudo procesar el pago (${detail}).`);
    }
    return toMercadoPagoPaymentResult(payload);
}
async function createPaymentSession(input) {
    const normalizedAmount = toTwoDecimals(input.amount);
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
        throw new Error("Monto de pago invalido para crear session.");
    }
    if (input.choice.provider === "mercadopago") {
        return createMercadoPagoPreferenceSession({ ...input, amount: normalizedAmount });
    }
    if (input.choice.provider === "efectivo") {
        return {
            providerPaymentId: null,
            checkoutUrl: null,
            preferenceId: null,
            publicKey: null,
            payload: { type: "cash_on_pickup", order_id: input.orderId },
            status: "ready",
            message: "Reserva generada. El cliente paga en efectivo al retirar.",
        };
    }
    return createMercadoPagoPreferenceSession({ ...input, amount: normalizedAmount });
}
function isPaymentChoiceAvailable(choice) {
    const status = isEnabled(choice);
    if (status.enabled)
        return { ok: true, reason: null };
    if (IS_PRODUCTION)
        return { ok: false, reason: status.reason };
    // In dev we allow creating orders even if provider keys are not present.
    return { ok: true, reason: status.reason };
}
