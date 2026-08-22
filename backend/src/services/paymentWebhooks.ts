import { createHmac, timingSafeEqual } from "crypto";

/**
 * Reglas de autenticidad de los webhooks de pago.
 *
 * Regla de oro: del request SOLO se toma el identificador del recurso del
 * proveedor (data.id). Estado, importe, moneda, cuenta y referencia se leen
 * siempre de la respuesta autenticada de la API del proveedor.
 */

/** Unico proveedor con integracion real. Todo lo demas se rechaza. */
export const PROVEEDORES_WEBHOOK_PERMITIDOS = ["mercadopago"] as const;
export type ProveedorWebhook = (typeof PROVEEDORES_WEBHOOK_PERMITIDOS)[number];

const PROVEEDORES = new Set<string>(PROVEEDORES_WEBHOOK_PERMITIDOS);

export function normalizarProveedorWebhook(raw: unknown): ProveedorWebhook | null {
  const value = String(raw ?? "").trim().toLowerCase();
  return PROVEEDORES.has(value) ? (value as ProveedorWebhook) : null;
}

export type ResultadoFirma =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "secret_no_configurado"
        | "firma_ausente"
        | "firma_malformada"
        | "data_id_ausente"
        | "timestamp_invalido"
        | "timestamp_fuera_de_ventana"
        | "firma_incorrecta";
    };

export type EntradaFirmaMercadoPago = {
  signatureHeader: string | null | undefined;
  requestId: string | null | undefined;
  dataId: string | null | undefined;
  secret: string;
  /** Segundos de tolerancia del `ts` firmado. 0 desactiva la comprobacion. */
  toleranceSeconds?: number;
  nowMs?: number;
};

export function parseMercadoPagoSignatureHeader(signatureHeader: string): { ts: string | null; v1: string | null } {
  let ts: string | null = null;
  let v1: string | null = null;

  for (const part of signatureHeader.split(",")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim().toLowerCase();
    const value = part.slice(separator + 1).trim();
    if (!key || !value) continue;
    if (key === "ts") ts = value;
    if (key === "v1") v1 = value.toLowerCase();
  }

  return { ts, v1 };
}

function secureHexEquals(left: string, right: string): boolean {
  if (!/^[0-9a-f]+$/i.test(left) || !/^[0-9a-f]+$/i.test(right)) return false;
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  if (leftBuffer.length === 0 || leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

/**
 * Mercado Pago manda `ts` en segundos en unas integraciones y en milisegundos
 * en otras. Se normaliza a milisegundos para poder medir la ventana.
 */
function timestampToMs(ts: string): number | null {
  const parsed = Number(ts);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed > 1e12 ? parsed : parsed * 1000;
}

/**
 * Verifica la firma HMAC-SHA256 de Mercado Pago sobre el manifiesto
 * `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`.
 *
 * Funcion pura: no lee `process.env` ni toca la red, para poder testearla.
 */
export function verificarFirmaMercadoPago(input: EntradaFirmaMercadoPago): ResultadoFirma {
  const secret = (input.secret || "").trim();
  if (!secret) return { ok: false, reason: "secret_no_configurado" };

  const signatureHeader = (input.signatureHeader || "").trim();
  if (!signatureHeader) return { ok: false, reason: "firma_ausente" };

  const { ts, v1 } = parseMercadoPagoSignatureHeader(signatureHeader);
  if (!ts || !v1) return { ok: false, reason: "firma_malformada" };

  // El data.id es lo unico que tomamos del request y es lo que la firma ata.
  // Sin el, la firma no protege nada: se rechaza.
  const dataId = (input.dataId || "").trim().toLowerCase();
  if (!dataId) return { ok: false, reason: "data_id_ausente" };

  const toleranceSeconds = input.toleranceSeconds ?? 0;
  if (toleranceSeconds > 0) {
    const tsMs = timestampToMs(ts);
    if (tsMs === null) return { ok: false, reason: "timestamp_invalido" };
    const nowMs = input.nowMs ?? Date.now();
    if (Math.abs(nowMs - tsMs) > toleranceSeconds * 1000) {
      return { ok: false, reason: "timestamp_fuera_de_ventana" };
    }
  }

  const requestId = (input.requestId || "").trim();
  const manifestParts = [`id:${dataId}`];
  if (requestId) manifestParts.push(`request-id:${requestId}`);
  manifestParts.push(`ts:${ts}`);
  const manifest = `${manifestParts.join(";")};`;

  const expected = createHmac("sha256", secret).update(manifest).digest("hex");
  return secureHexEquals(expected, v1) ? { ok: true } : { ok: false, reason: "firma_incorrecta" };
}

export type ReferenciaEsperada =
  | { kind: "orden"; id: number }
  | { kind: "checkout"; id: number }
  | { kind: "cobro_manual"; id: number };

export type DatosVerificadosProveedor = {
  amount: number | null;
  currency: string | null;
  collectorId: string | null;
  liveMode: boolean | null;
};

export type ExpectativaCompra = {
  amount: number;
  currency: string;
};

export type PoliticaVerificacion = {
  /** Cuenta vendedora esperada. Si es null no se puede comprobar. */
  expectedCollectorId: string | null;
  /** Moneda esperada del negocio. */
  expectedCurrency: string;
  /** true en produccion: exige que el pago no sea de sandbox. */
  requireLiveMode: boolean;
  /** Tolerancia de redondeo del importe. */
  amountTolerance?: number;
};

export type ResultadoVerificacionImporte =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "importe_ausente"
        | "importe_distinto"
        | "moneda_ausente"
        | "moneda_distinta"
        | "cuenta_distinta"
        | "modo_sandbox";
      detail: Record<string, unknown>;
    };

/**
 * Compara lo que dice el proveedor contra lo que espera la base. Funcion pura.
 */
export function verificarPagoContraCompra(
  provider: DatosVerificadosProveedor,
  expected: ExpectativaCompra,
  policy: PoliticaVerificacion,
): ResultadoVerificacionImporte {
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
export function extraerIdRecursoProveedor(
  body: Record<string, unknown>,
  query: Record<string, unknown>,
): string | null {
  const data = body.data && typeof body.data === "object" ? (body.data as Record<string, unknown>) : {};
  const candidates = [query["data.id"], query.id, query.payment_id, data.id, body.id, body.payment_id];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (typeof candidate === "number" && Number.isFinite(candidate)) return String(candidate);
  }
  return null;
}

export type EstadoPagoNormalizado = "approved" | "rejected" | "expired" | null;

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
export function normalizarEstadoProveedor(raw: unknown): EstadoPagoNormalizado {
  const status = String(raw ?? "").trim().toLowerCase();
  if (!status) return null;
  if (ESTADOS_APROBADOS.has(status)) return "approved";
  if (ESTADOS_EXPIRADOS.has(status)) return "expired";
  if (ESTADOS_RECHAZADOS.has(status)) return "rejected";
  return null;
}
