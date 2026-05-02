"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listPaymentOptions = listPaymentOptions;
exports.resolvePaymentChoice = resolvePaymentChoice;
exports.createPaymentSession = createPaymentSession;
exports.isPaymentChoiceAvailable = isPaymentChoiceAvailable;
const crypto_1 = require("crypto");
const IS_PRODUCTION = (process.env.NODE_ENV || "").trim().toLowerCase() === "production";
const MERCADOPAGO_ACCESS_TOKEN = (process.env.MERCADOPAGO_ACCESS_TOKEN || "").trim();
const MERCADOPAGO_API_BASE = (process.env.MERCADOPAGO_API_BASE || "https://api.mercadopago.com").trim().replace(/\/+$/, "");
const MERCADOPAGO_WEBHOOK_URL = (process.env.MERCADOPAGO_WEBHOOK_URL || "").trim();
const PAGOS360_API_KEY = (process.env.PAGOS360_API_KEY || "").trim();
const PAGOS360_API_BASE = (process.env.PAGOS360_API_BASE || "https://api.sandbox.pagos360.com").trim().replace(/\/+$/, "");
const DEFAULT_FRONTEND_URL = (process.env.FRONTEND_URL || "http://localhost:5173").split(",")[0].trim().replace(/\/+$/, "");
function paymentReturnUrl(envName) {
    const fromEnv = (process.env[envName] || "").trim();
    if (fromEnv)
        return fromEnv;
    return `${DEFAULT_FRONTEND_URL}/cliente`;
}
function toTwoDecimals(value) {
    return Number((Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2));
}
function toPagos360Date(date) {
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const yyyy = String(date.getFullYear());
    return `${dd}-${mm}-${yyyy}`;
}
function tomorrowAtNoonLocal() {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    date.setHours(12, 0, 0, 0);
    return date;
}
function isEnabled(choice) {
    if (choice.provider === "mercadopago") {
        if (!MERCADOPAGO_ACCESS_TOKEN)
            return { enabled: false, reason: "Falta MERCADOPAGO_ACCESS_TOKEN" };
        return { enabled: true, reason: null };
    }
    if (!PAGOS360_API_KEY)
        return { enabled: false, reason: "Falta PAGOS360_API_KEY" };
    return { enabled: true, reason: null };
}
function listPaymentOptions() {
    const options = [
        {
            id: "mercadopago_wallet",
            provider: "mercadopago",
            method: "wallet",
            label: "Mercado Pago Wallet",
            description: "Pago rapido con cuenta Mercado Pago.",
        },
        {
            id: "pagos360_qr",
            provider: "pagos360",
            method: "qr",
            label: "Pagos360 QR",
            description: "Checkout de Pagos360 con foco en QR interoperable.",
        },
        {
            id: "pagos360_tarjeta",
            provider: "pagos360",
            method: "credit_card",
            label: "Pagos360 Tarjeta",
            description: "Checkout de Pagos360 con foco en tarjetas credito/debito.",
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
        return { provider: "mercadopago", method: "wallet" };
    }
    if (raw.provider === "mercadopago") {
        return { provider: "mercadopago", method: "wallet" };
    }
    if (raw.provider === "pagos360") {
        if (raw.method === "qr")
            return { provider: "pagos360", method: "qr" };
        if (raw.method === "debit_card")
            return { provider: "pagos360", method: "debit_card" };
        return { provider: "pagos360", method: "credit_card" };
    }
    return { provider: "mercadopago", method: "wallet" };
}
function excludedChannelsForPagos360(method) {
    const allChannels = [
        "credit_card",
        "credit_card_agro",
        "debit_card",
        "banelco_pmc",
        "link_pagos",
        "DEBIN",
        "wire_transfer",
        "non_banking",
        "QR",
    ];
    if (method === "qr") {
        return allChannels.filter((channel) => channel !== "QR");
    }
    if (method === "debit_card") {
        return allChannels.filter((channel) => channel !== "debit_card");
    }
    if (method === "credit_card") {
        return allChannels.filter((channel) => channel !== "credit_card" && channel !== "credit_card_agro");
    }
    return [];
}
async function createMercadoPagoWalletSession(input) {
    if (!MERCADOPAGO_ACCESS_TOKEN) {
        return {
            providerPaymentId: null,
            checkoutUrl: null,
            payload: null,
            status: "requires_configuration",
            message: "Configura MERCADOPAGO_ACCESS_TOKEN para generar el checkout de wallet.",
        };
    }
    const body = {
        external_reference: `orden_${input.orderId}`,
        purpose: "wallet_purchase",
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
        checkoutUrl,
        payload,
        status: "ready",
        message: checkoutUrl ? null : "Preferencia creada sin checkout_url.",
    };
}
async function createPagos360Session(input) {
    if (!PAGOS360_API_KEY) {
        return {
            providerPaymentId: null,
            checkoutUrl: null,
            payload: null,
            status: "requires_configuration",
            message: "Configura PAGOS360_API_KEY para generar el checkout de Pagos360.",
        };
    }
    const dueDate = toPagos360Date(tomorrowAtNoonLocal());
    const body = {
        payment_request: {
            description: input.description,
            first_due_date: dueDate,
            first_total: toTwoDecimals(input.amount),
            payer_name: input.buyerName || `Cliente #${input.orderId}`,
            payer_email: input.buyerEmail || undefined,
            external_reference: `orden_${input.orderId}`,
            back_url_success: paymentReturnUrl("PAYMENT_RETURN_SUCCESS_URL"),
            back_url_pending: paymentReturnUrl("PAYMENT_RETURN_PENDING_URL"),
            back_url_rejected: paymentReturnUrl("PAYMENT_RETURN_FAILURE_URL"),
            excluded_channels: excludedChannelsForPagos360(input.choice.method),
            metadata: {
                order_id: input.orderId,
                provider: input.choice.provider,
                method: input.choice.method,
            },
            items: [
                {
                    quantity: 1,
                    description: input.description,
                    amount: toTwoDecimals(input.amount),
                },
            ],
        },
    };
    const response = await fetch(`${PAGOS360_API_BASE}/payment-request`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${PAGOS360_API_KEY}`,
        },
        body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({})));
    if (!response.ok) {
        const detail = typeof payload.message === "string" ? payload.message : `HTTP ${response.status}`;
        throw new Error(`Pagos360: no se pudo crear la solicitud (${detail}).`);
    }
    return {
        providerPaymentId: payload.id !== undefined ? String(payload.id) : null,
        checkoutUrl: typeof payload.checkout_url === "string" ? payload.checkout_url : null,
        payload,
        status: "ready",
        message: null,
    };
}
async function createPaymentSession(input) {
    const normalizedAmount = toTwoDecimals(input.amount);
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
        throw new Error("Monto de pago invalido para crear session.");
    }
    if (input.choice.provider === "mercadopago") {
        return createMercadoPagoWalletSession({ ...input, amount: normalizedAmount });
    }
    return createPagos360Session({ ...input, amount: normalizedAmount });
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
