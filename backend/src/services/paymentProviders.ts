import { randomUUID } from "crypto";

export type PaymentProvider = "mercadopago" | "efectivo";
export type PaymentMethod = "brick" | "wallet" | "qr" | "cash";

export type PaymentChoice = {
  provider: PaymentProvider;
  method: PaymentMethod;
};

export type PaymentOption = PaymentChoice & {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  reason_disabled: string | null;
};

export type PaymentSessionResult = {
  providerPaymentId: string | null;
  checkoutUrl: string | null;
  preferenceId: string | null;
  publicKey: string | null;
  payload: Record<string, unknown> | null;
  qrData?: string | null;
  qrImage?: string | null;
  expiresAt?: string | null;
  status: "ready" | "requires_configuration";
  message: string | null;
};

type PaymentSessionInput = {
  choice: PaymentChoice;
  orderId: number;
  amount: number;
  currency: string;
  buyerName: string;
  buyerEmail: string;
  description: string;
};

const IS_PRODUCTION = (process.env.NODE_ENV || "").trim().toLowerCase() === "production";
const MERCADOPAGO_ACCESS_TOKEN = (process.env.MERCADOPAGO_ACCESS_TOKEN || "").trim();
const MERCADOPAGO_PUBLIC_KEY = (process.env.MERCADOPAGO_PUBLIC_KEY || process.env.MP_PUBLIC_KEY || "").trim();
const MERCADOPAGO_API_BASE = (process.env.MERCADOPAGO_API_BASE || "https://api.mercadopago.com").trim().replace(/\/+$/, "");
const MERCADOPAGO_WEBHOOK_URL = (process.env.MERCADOPAGO_WEBHOOK_URL || "").trim();
const MERCADOPAGO_QR_EXTERNAL_POS_ID = (process.env.MERCADOPAGO_QR_EXTERNAL_POS_ID || "").trim();
const MERCADOPAGO_QR_MODE = (process.env.MERCADOPAGO_QR_MODE || "dynamic").trim().toLowerCase();
const MERCADOPAGO_QR_EXPIRATION_TIME = (process.env.MERCADOPAGO_QR_EXPIRATION_TIME || "PT15M").trim();
const DEFAULT_FRONTEND_URL = (process.env.FRONTEND_URL || "http://localhost:5173").split(",")[0].trim().replace(/\/+$/, "");

function mercadoPagoCredentialMode(value: string): "test" | "prod" | "unknown" {
  const normalized = value.trim().toUpperCase();
  if (!normalized) return "unknown";
  if (normalized.startsWith("TEST-")) return "test";
  if (normalized.startsWith("APP_USR-")) return "prod";
  return "unknown";
}

function mercadoPagoConfigurationIssue(choice: PaymentChoice): string | null {
  if (choice.provider === "efectivo") return null;
  if (!MERCADOPAGO_ACCESS_TOKEN) return "Falta MERCADOPAGO_ACCESS_TOKEN";
  if (choice.method === "brick" && !MERCADOPAGO_PUBLIC_KEY) {
    return "Falta MERCADOPAGO_PUBLIC_KEY";
  }
  if (choice.method === "qr" && !MERCADOPAGO_QR_EXTERNAL_POS_ID) {
    return "Falta MERCADOPAGO_QR_EXTERNAL_POS_ID para generar QR de Mercado Pago";
  }
  const accessTokenMode = mercadoPagoCredentialMode(MERCADOPAGO_ACCESS_TOKEN);
  const publicKeyMode = mercadoPagoCredentialMode(MERCADOPAGO_PUBLIC_KEY);

  if (choice.method === "brick" && accessTokenMode !== "unknown" && publicKeyMode !== "unknown" && accessTokenMode !== publicKeyMode) {
    return "MERCADOPAGO_ACCESS_TOKEN y MERCADOPAGO_PUBLIC_KEY no pertenecen al mismo entorno (test/prod).";
  }

  return null;
}

const PAYMENT_RETURN_PATHS: Record<string, string> = {
  PAYMENT_RETURN_SUCCESS_URL: "/mis-pedidos",
  PAYMENT_RETURN_PENDING_URL: "/mis-pedidos",
  PAYMENT_RETURN_FAILURE_URL: "/mis-pedidos",
};

function paymentReturnUrl(envName: string): string {
  const fromEnv = (process.env[envName] || "").trim();
  if (fromEnv) return fromEnv;
  return `${DEFAULT_FRONTEND_URL}${PAYMENT_RETURN_PATHS[envName] ?? "/mis-pedidos"}`;
}

function toTwoDecimals(value: number): number {
  return Number((Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2));
}

function toMercadoPagoAmount(value: number): string {
  return toTwoDecimals(value).toFixed(2);
}

function mercadoPagoErrorDetail(payload: Record<string, unknown>, status: number): string {
  const direct = firstString(payload.message, payload.error, payload.status_detail);
  const causes = Array.isArray(payload.cause)
    ? payload.cause
      .map((item) => {
        const cause = asRecord(item);
        return firstString(cause.description, cause.message, cause.code);
      })
      .filter((item): item is string => Boolean(item))
    : [];
  const errors = Array.isArray(payload.errors)
    ? payload.errors
      .map((item) => {
        const error = asRecord(item);
        return firstString(error.message, error.description, error.code);
      })
      .filter((item): item is string => Boolean(item))
    : [];

  return [direct, ...causes, ...errors].filter(Boolean).join(" | ") || `HTTP ${status}`;
}

function isEnabled(choice: PaymentChoice): { enabled: boolean; reason: string | null } {
  if (choice.provider === "efectivo") {
    return { enabled: true, reason: null };
  }
  const configIssue = mercadoPagoConfigurationIssue(choice);
  if (configIssue) {
    return { enabled: false, reason: configIssue };
  }
  return { enabled: true, reason: null };
}

export function listPaymentOptions(): PaymentOption[] {
  const options: Array<Omit<PaymentOption, "enabled" | "reason_disabled">> = [
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
      id: "mercadopago_qr",
      provider: "mercadopago",
      method: "qr",
      label: "Pagar con QR",
      description: "Genera un QR de Mercado Pago para escanearlo y abonar desde la app.",
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

export function resolvePaymentChoice(raw?: Partial<PaymentChoice> | null): PaymentChoice {
  if (!raw || !raw.provider) {
    return { provider: "mercadopago", method: "brick" };
  }
  if (raw.provider === "mercadopago") {
    if (raw.method === "qr") return { provider: "mercadopago", method: "qr" };
    return raw.method === "wallet"
      ? { provider: "mercadopago", method: "wallet" }
      : { provider: "mercadopago", method: "brick" };
  }
  if (raw.provider === "efectivo") {
    return { provider: "efectivo", method: "cash" };
  }
  return { provider: "mercadopago", method: "brick" };
}

async function createMercadoPagoPreferenceSession(input: PaymentSessionInput): Promise<PaymentSessionResult> {
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
      "X-Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const detail = mercadoPagoErrorDetail(payload, response.status);
    throw new Error(`Mercado Pago: no se pudo crear la preferencia (${detail}).`);
  }

  const checkoutUrl =
    (typeof payload.init_point === "string" ? payload.init_point : null) ??
    (typeof payload.sandbox_init_point === "string" ? payload.sandbox_init_point : null);

  return {
    providerPaymentId: null,
    preferenceId: typeof payload.id === "string" ? payload.id : null,
    publicKey: input.choice.method === "brick" ? MERCADOPAGO_PUBLIC_KEY : null,
    checkoutUrl,
    payload,
    status: "ready",
    message: checkoutUrl ? null : "Preferencia creada sin checkout_url.",
  };
}

function normalizeQrMode(value: string): "static" | "dynamic" | "hybrid" {
  if (value === "static" || value === "hybrid") return value;
  return "dynamic";
}

function addIsoDurationToNow(duration: string): string | null {
  const match = duration.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!match) return null;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  const totalMs = ((hours * 60 + minutes) * 60 + seconds) * 1000;
  if (!Number.isFinite(totalMs) || totalMs <= 0) return null;
  return new Date(Date.now() + totalMs).toISOString();
}

function makeQrImageUrl(qrData: string): string {
  const encoded = encodeURIComponent(qrData);
  return `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=16&data=${encoded}`;
}

async function createMercadoPagoQrSession(input: PaymentSessionInput): Promise<PaymentSessionResult> {
  const configIssue = mercadoPagoConfigurationIssue(input.choice);
  if (configIssue) {
    return {
      providerPaymentId: null,
      checkoutUrl: null,
      preferenceId: null,
      publicKey: null,
      payload: null,
      qrData: null,
      qrImage: null,
      expiresAt: null,
      status: "requires_configuration",
      message: configIssue,
    };
  }

  const amount = toTwoDecimals(input.amount);
  const amountText = toMercadoPagoAmount(amount);
  const qrMode = normalizeQrMode(MERCADOPAGO_QR_MODE);
  const body = {
    type: "qr",
    total_amount: amountText,
    description: input.description.slice(0, 150),
    external_reference: `orden_${input.orderId}`,
    expiration_time: MERCADOPAGO_QR_EXPIRATION_TIME,
    config: {
      qr: {
        external_pos_id: MERCADOPAGO_QR_EXTERNAL_POS_ID,
        mode: qrMode,
      },
    },
    transactions: {
      payments: [
        {
          amount: amountText,
        },
      ],
    },
    items: [
      {
        title: input.description.slice(0, 150),
        unit_price: amountText,
        quantity: 1,
        unit_measure: "unit",
        external_code: `orden_${input.orderId}`,
      },
    ],
  };

  const response = await fetch(`${MERCADOPAGO_API_BASE}/v1/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${MERCADOPAGO_ACCESS_TOKEN}`,
      "X-Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const detail = mercadoPagoErrorDetail(payload, response.status);
    throw new Error(`Mercado Pago: no se pudo crear la order QR (${detail}).`);
  }

  const qrData = firstString(payload.qr_data, asRecord(payload.qr).qr_data, asRecord(payload.type_response).qr_data);
  const qrImage = qrData ? makeQrImageUrl(qrData) : null;

  return {
    providerPaymentId: firstString(payload.id),
    checkoutUrl: null,
    preferenceId: null,
    publicKey: null,
    payload: {
      ...payload,
      qr_data: qrData,
      qr_image: qrImage,
      qr_mode: qrMode,
    },
    qrData,
    qrImage,
    expiresAt: addIsoDurationToNow(MERCADOPAGO_QR_EXPIRATION_TIME),
    status: qrData && qrImage ? "ready" : "requires_configuration",
    message: qrData && qrImage ? null : "Mercado Pago creo la order, pero no devolvio qr_data para mostrar.",
  };
}

export type MercadoPagoApiPaymentInput = {
  orderId: number;
  amount: number;
  currency: string;
  buyerEmail: string;
  description: string;
  formData: Record<string, unknown>;
};

export type MercadoPagoApiPaymentResult = {
  providerPaymentId: string | null;
  status: string;
  statusDetail: string | null;
  payload: Record<string, unknown>;
};

export type MercadoPagoPaymentLookupResult = MercadoPagoApiPaymentResult & {
  externalReference: string | null;
  orderId: number | null;
};

export type MercadoPagoQrOrderLookupResult = MercadoPagoApiPaymentResult & {
  externalReference: string | null;
  orderId: number | null;
  paymentId: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function firstPositiveNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const normalized = typeof value === "string" ? value.trim() : value;
    const parsed = Number(normalized);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function firstInteger(...values: unknown[]): number | null {
  const parsed = firstPositiveNumber(...values);
  if (parsed === null) return null;
  return Math.trunc(parsed);
}

function parseOrderIdFromReference(reference: string | null): number | null {
  if (!reference) return null;
  const direct = Number(reference);
  if (Number.isInteger(direct) && direct > 0) return direct;

  const match = reference.match(/(?:orden|order)[_-]?(\d+)/i);
  if (!match) return null;

  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toMercadoPagoPaymentResult(payload: Record<string, unknown>): MercadoPagoPaymentLookupResult {
  const metadata = asRecord(payload.metadata);
  const externalReference = firstString(payload.external_reference, metadata.external_reference);
  const directOrderId = firstString(metadata.order_id, payload.order_id);
  return {
    providerPaymentId:
      typeof payload.id === "string" || typeof payload.id === "number" ? String(payload.id) : null,
    status: typeof payload.status === "string" ? payload.status : "unknown",
    statusDetail: typeof payload.status_detail === "string" ? payload.status_detail : null,
    externalReference,
    orderId: parseOrderIdFromReference(directOrderId ?? externalReference),
    payload,
  };
}

export async function getMercadoPagoPayment(paymentId: string | number): Promise<MercadoPagoPaymentLookupResult> {
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
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const detail = mercadoPagoErrorDetail(payload, response.status);
    throw new Error(`Mercado Pago: no se pudo consultar el pago (${detail}).`);
  }

  return toMercadoPagoPaymentResult(payload);
}

export async function getMercadoPagoQrOrder(orderId: string | number): Promise<MercadoPagoQrOrderLookupResult> {
  if (!MERCADOPAGO_ACCESS_TOKEN) {
    throw new Error("Configura MERCADOPAGO_ACCESS_TOKEN para consultar orders QR de Mercado Pago.");
  }

  const normalizedOrderId = String(orderId).trim();
  if (!normalizedOrderId) {
    throw new Error("Order ID invalido para consultar en Mercado Pago.");
  }

  const response = await fetch(`${MERCADOPAGO_API_BASE}/v1/orders/${encodeURIComponent(normalizedOrderId)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${MERCADOPAGO_ACCESS_TOKEN}`,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const detail = mercadoPagoErrorDetail(payload, response.status);
    throw new Error(`Mercado Pago: no se pudo consultar la order QR (${detail}).`);
  }

  const transactions = asRecord(payload.transactions);
  const payments = Array.isArray(transactions.payments) ? transactions.payments : [];
  const firstPayment = asRecord(payments[0]);
  const externalReference = firstString(payload.external_reference);
  return {
    providerPaymentId: firstString(payload.id),
    status: typeof payload.status === "string" ? payload.status : "unknown",
    statusDetail: typeof payload.status_detail === "string" ? payload.status_detail : null,
    externalReference,
    orderId: parseOrderIdFromReference(externalReference),
    paymentId: firstString(firstPayment.id),
    payload,
  };
}

export async function processMercadoPagoApiPayment(input: MercadoPagoApiPaymentInput): Promise<MercadoPagoApiPaymentResult> {
  if (!MERCADOPAGO_ACCESS_TOKEN) {
    throw new Error("Configura MERCADOPAGO_ACCESS_TOKEN para procesar pagos con Checkout API.");
  }

  const normalizedAmount = toTwoDecimals(input.amount);
  const formData = asRecord(input.formData);
  const payer = asRecord(formData.payer);
  const payerIdentification = asRecord(payer.identification);
  const payerEmail =
    typeof payer.email === "string" && payer.email.includes("@")
      ? payer.email.trim()
      : input.buyerEmail.trim();

  if (!payerEmail || !payerEmail.includes("@")) {
    throw new Error("Mercado Pago requiere un email de comprador valido.");
  }

  const token = firstString(formData.token);
  const paymentMethodId = firstString(formData.payment_method_id, formData.paymentMethodId);
  const issuerId = firstString(formData.issuer_id, formData.issuerId);
  const installments = firstInteger(formData.installments, 1) ?? 1;

  if (!token) {
    throw new Error("Mercado Pago no devolvio el token de la tarjeta.");
  }
  if (!paymentMethodId) {
    throw new Error("Mercado Pago no devolvio el medio de pago de la tarjeta.");
  }

  const body = {
    token,
    transaction_amount: normalizedAmount,
    description: input.description,
    installments,
    payment_method_id: paymentMethodId,
    ...(issuerId ? { issuer_id: issuerId } : {}),
    external_reference: `orden_${input.orderId}`,
    metadata: {
      ...asRecord(formData.metadata),
      order_id: input.orderId,
    },
    payer: {
      email: payerEmail,
      ...(firstString(payerIdentification.type) && firstString(payerIdentification.number)
        ? {
            identification: {
              type: firstString(payerIdentification.type),
              number: firstString(payerIdentification.number),
            },
          }
        : {}),
    },
  };

  const response = await fetch(`${MERCADOPAGO_API_BASE}/v1/payments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${MERCADOPAGO_ACCESS_TOKEN}`,
      "X-Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const detail = mercadoPagoErrorDetail(payload, response.status);
    throw new Error(`Mercado Pago: no se pudo procesar el pago (${detail}).`);
  }

  return toMercadoPagoPaymentResult(payload);
}

export async function createPaymentSession(input: PaymentSessionInput): Promise<PaymentSessionResult> {
  const normalizedAmount = toTwoDecimals(input.amount);
  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    throw new Error("Monto de pago invalido para crear session.");
  }

  if (input.choice.provider === "mercadopago") {
    if (input.choice.method === "qr") {
      return createMercadoPagoQrSession({ ...input, amount: normalizedAmount });
    }
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

export function isPaymentChoiceAvailable(choice: PaymentChoice): { ok: boolean; reason: string | null } {
  const status = isEnabled(choice);
  if (status.enabled) return { ok: true, reason: null };
  if (IS_PRODUCTION) return { ok: false, reason: status.reason };
  // In dev we allow creating orders even if provider keys are not present.
  return { ok: true, reason: status.reason };
}
