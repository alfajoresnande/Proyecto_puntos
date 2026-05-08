import { randomUUID } from "crypto";

export type PaymentProvider = "mercadopago" | "efectivo";
export type PaymentMethod = "brick" | "wallet" | "cash";

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
const DEFAULT_FRONTEND_URL = (process.env.FRONTEND_URL || "http://localhost:5173").split(",")[0].trim().replace(/\/+$/, "");

function paymentReturnUrl(envName: string): string {
  const fromEnv = (process.env[envName] || "").trim();
  if (fromEnv) return fromEnv;
  return `${DEFAULT_FRONTEND_URL}/cliente`;
}

function toTwoDecimals(value: number): number {
  return Number((Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2));
}

function isEnabled(choice: PaymentChoice): { enabled: boolean; reason: string | null } {
  if (choice.provider === "efectivo") {
    return { enabled: true, reason: null };
  }
  if (!MERCADOPAGO_ACCESS_TOKEN) return { enabled: false, reason: "Falta MERCADOPAGO_ACCESS_TOKEN" };
  if (choice.method === "brick" && !MERCADOPAGO_PUBLIC_KEY) {
    return { enabled: false, reason: "Falta MERCADOPAGO_PUBLIC_KEY" };
  }
  return { enabled: true, reason: null };
}

export function listPaymentOptions(): PaymentOption[] {
  const options: Array<Omit<PaymentOption, "enabled" | "reason_disabled">> = [
    {
      id: "mercadopago_brick",
      provider: "mercadopago",
      method: "brick",
      label: "Tarjeta y Mercado Pago",
      description: "Paga dentro de la tienda con tarjetas y medios habilitados por Mercado Pago.",
    },
    {
      id: "mercadopago_wallet",
      provider: "mercadopago",
      method: "wallet",
      label: "Ir a Mercado Pago",
      description: "Abre Mercado Pago para pagar con tu cuenta, app o checkout seguro.",
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
  if (!MERCADOPAGO_ACCESS_TOKEN) {
    return {
      providerPaymentId: null,
      checkoutUrl: null,
      preferenceId: null,
      publicKey: null,
      payload: null,
      status: "requires_configuration",
      message: "Configura MERCADOPAGO_ACCESS_TOKEN para generar el checkout.",
    };
  }
  if (input.choice.method === "brick" && !MERCADOPAGO_PUBLIC_KEY) {
    return {
      providerPaymentId: null,
      checkoutUrl: null,
      preferenceId: null,
      publicKey: null,
      payload: null,
      status: "requires_configuration",
      message: "Configura MERCADOPAGO_PUBLIC_KEY para renderizar Checkout Bricks.",
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
    const detail = typeof payload.message === "string" ? payload.message : `HTTP ${response.status}`;
    throw new Error(`Mercado Pago: no se pudo crear la preferencia (${detail}).`);
  }

  const checkoutUrl =
    (typeof payload.init_point === "string" ? payload.init_point : null) ??
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function processMercadoPagoApiPayment(input: MercadoPagoApiPaymentInput): Promise<MercadoPagoApiPaymentResult> {
  if (!MERCADOPAGO_ACCESS_TOKEN) {
    throw new Error("Configura MERCADOPAGO_ACCESS_TOKEN para procesar pagos con Checkout API.");
  }

  const normalizedAmount = toTwoDecimals(input.amount);
  const formData = asRecord(input.formData);
  const payer = asRecord(formData.payer);
  const payerEmail =
    typeof payer.email === "string" && payer.email.includes("@")
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
      "X-Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const detail = typeof payload.message === "string" ? payload.message : `HTTP ${response.status}`;
    throw new Error(`Mercado Pago: no se pudo procesar el pago (${detail}).`);
  }

  return {
    providerPaymentId:
      typeof payload.id === "string" || typeof payload.id === "number" ? String(payload.id) : null,
    status: typeof payload.status === "string" ? payload.status : "unknown",
    statusDetail: typeof payload.status_detail === "string" ? payload.status_detail : null,
    payload,
  };
}

export async function createPaymentSession(input: PaymentSessionInput): Promise<PaymentSessionResult> {
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

export function isPaymentChoiceAvailable(choice: PaymentChoice): { ok: boolean; reason: string | null } {
  const status = isEnabled(choice);
  if (status.enabled) return { ok: true, reason: null };
  if (IS_PRODUCTION) return { ok: false, reason: status.reason };
  // In dev we allow creating orders even if provider keys are not present.
  return { ok: true, reason: status.reason };
}
