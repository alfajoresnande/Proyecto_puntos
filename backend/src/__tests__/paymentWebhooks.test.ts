import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import {
  extraerIdRecursoProveedor,
  normalizarEstadoProveedor,
  normalizarProveedorWebhook,
  parseMercadoPagoSignatureHeader,
  verificarFirmaMercadoPago,
  verificarPagoContraCompra,
  type PoliticaVerificacion,
} from "../services/paymentWebhooks";

const SECRET = "secreto-de-prueba-para-firmar-webhooks-0123456789";

function firmar(dataId: string, ts: string, requestId?: string): string {
  const parts = [`id:${dataId.toLowerCase()}`];
  if (requestId) parts.push(`request-id:${requestId}`);
  parts.push(`ts:${ts}`);
  const manifest = `${parts.join(";")};`;
  const v1 = createHmac("sha256", SECRET).update(manifest).digest("hex");
  return `ts=${ts},v1=${v1}`;
}

const POLITICA_BASE: PoliticaVerificacion = {
  expectedCollectorId: "123456789",
  expectedCurrency: "ARS",
  requireLiveMode: true,
};

describe("SEC-01 · allowlist de proveedores", () => {
  it("rechaza un proveedor desconocido", () => {
    expect(normalizarProveedorWebhook("proveedor-inventado")).toBeNull();
    expect(normalizarProveedorWebhook("pagos360")).toBeNull();
    expect(normalizarProveedorWebhook("")).toBeNull();
    expect(normalizarProveedorWebhook(undefined)).toBeNull();
  });

  it("no deja colar un proveedor por mayusculas ni espacios", () => {
    expect(normalizarProveedorWebhook(" MercadoPago ")).toBe("mercadopago");
    expect(normalizarProveedorWebhook("mercadopago2")).toBeNull();
    expect(normalizarProveedorWebhook("mercado pago")).toBeNull();
  });
});

describe("SEC-01 · firma del webhook", () => {
  const ahora = 1_760_000_000_000;
  const ts = String(Math.floor(ahora / 1000));

  it("acepta una firma correcta", () => {
    const resultado = verificarFirmaMercadoPago({
      signatureHeader: firmar("payment-1", ts, "req-1"),
      requestId: "req-1",
      dataId: "payment-1",
      secret: SECRET,
      toleranceSeconds: 900,
      nowMs: ahora,
    });
    expect(resultado.ok).toBe(true);
  });

  it("rechaza una firma ausente", () => {
    const resultado = verificarFirmaMercadoPago({
      signatureHeader: "",
      requestId: "req-1",
      dataId: "payment-1",
      secret: SECRET,
    });
    expect(resultado).toEqual({ ok: false, reason: "firma_ausente" });
  });

  it("rechaza una firma incorrecta", () => {
    const resultado = verificarFirmaMercadoPago({
      signatureHeader: `ts=${ts},v1=${"a".repeat(64)}`,
      requestId: "req-1",
      dataId: "payment-1",
      secret: SECRET,
      nowMs: ahora,
    });
    expect(resultado).toEqual({ ok: false, reason: "firma_incorrecta" });
  });

  it("rechaza una firma valida para OTRO recurso (no se puede reapuntar el pago)", () => {
    const resultado = verificarFirmaMercadoPago({
      signatureHeader: firmar("payment-1", ts, "req-1"),
      requestId: "req-1",
      dataId: "payment-999",
      secret: SECRET,
      nowMs: ahora,
    });
    expect(resultado.ok).toBe(false);
  });

  it("rechaza si falta el data.id que la firma ata", () => {
    const resultado = verificarFirmaMercadoPago({
      signatureHeader: firmar("payment-1", ts),
      requestId: "",
      dataId: "",
      secret: SECRET,
    });
    expect(resultado).toEqual({ ok: false, reason: "data_id_ausente" });
  });

  it("rechaza un replay fuera de la ventana temporal", () => {
    const viejo = String(Math.floor(ahora / 1000) - 3600);
    const resultado = verificarFirmaMercadoPago({
      signatureHeader: firmar("payment-1", viejo, "req-1"),
      requestId: "req-1",
      dataId: "payment-1",
      secret: SECRET,
      toleranceSeconds: 900,
      nowMs: ahora,
    });
    expect(resultado).toEqual({ ok: false, reason: "timestamp_fuera_de_ventana" });
  });

  it("acepta el mismo replay si la ventana esta desactivada (idempotencia lo cubre)", () => {
    const viejo = String(Math.floor(ahora / 1000) - 3600);
    const resultado = verificarFirmaMercadoPago({
      signatureHeader: firmar("payment-1", viejo, "req-1"),
      requestId: "req-1",
      dataId: "payment-1",
      secret: SECRET,
      toleranceSeconds: 0,
      nowMs: ahora,
    });
    expect(resultado.ok).toBe(true);
  });

  it("rechaza cuando no hay secret configurado en vez de dejar pasar", () => {
    const resultado = verificarFirmaMercadoPago({
      signatureHeader: firmar("payment-1", ts),
      requestId: "",
      dataId: "payment-1",
      secret: "",
    });
    expect(resultado).toEqual({ ok: false, reason: "secret_no_configurado" });
  });

  it("rechaza una cabecera malformada sin romperse", () => {
    for (const header of ["basura", "ts=", "v1=", "ts=123", `v1=${"a".repeat(64)}`]) {
      const resultado = verificarFirmaMercadoPago({
        signatureHeader: header,
        requestId: "",
        dataId: "payment-1",
        secret: SECRET,
        nowMs: ahora,
      });
      expect(resultado.ok).toBe(false);
    }
  });

  it("no revienta con un v1 que no es hexadecimal", () => {
    const resultado = verificarFirmaMercadoPago({
      signatureHeader: `ts=${ts},v1=zzzz`,
      requestId: "",
      dataId: "payment-1",
      secret: SECRET,
      nowMs: ahora,
    });
    expect(resultado).toEqual({ ok: false, reason: "firma_incorrecta" });
  });

  it("parsea ts y v1 en cualquier orden", () => {
    expect(parseMercadoPagoSignatureHeader("v1=abc,ts=123")).toEqual({ ts: "123", v1: "abc" });
  });
});

describe("SEC-01 · verificacion contra la compra", () => {
  const pagoReal = { amount: 1500, currency: "ARS", collectorId: "123456789", liveMode: true };

  it("acepta un pago que coincide", () => {
    expect(verificarPagoContraCompra(pagoReal, { amount: 1500, currency: "ARS" }, POLITICA_BASE).ok).toBe(true);
  });

  it("rechaza un importe distinto", () => {
    const r = verificarPagoContraCompra(pagoReal, { amount: 15000, currency: "ARS" }, POLITICA_BASE);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("importe_distinto");
  });

  it("rechaza si el proveedor no informa importe", () => {
    const r = verificarPagoContraCompra({ ...pagoReal, amount: null }, { amount: 1500, currency: "ARS" }, POLITICA_BASE);
    expect(r.ok === false && r.reason).toBe("importe_ausente");
  });

  it("rechaza una moneda distinta (pagar 1500 en otra divisa)", () => {
    const r = verificarPagoContraCompra({ ...pagoReal, currency: "USD" }, { amount: 1500, currency: "ARS" }, POLITICA_BASE);
    expect(r.ok === false && r.reason).toBe("moneda_distinta");
  });

  it("rechaza un pago cobrado por otra cuenta vendedora", () => {
    const r = verificarPagoContraCompra({ ...pagoReal, collectorId: "999" }, { amount: 1500, currency: "ARS" }, POLITICA_BASE);
    expect(r.ok === false && r.reason).toBe("cuenta_distinta");
  });

  it("rechaza un pago de sandbox cuando se exige modo real", () => {
    const r = verificarPagoContraCompra({ ...pagoReal, liveMode: false }, { amount: 1500, currency: "ARS" }, POLITICA_BASE);
    expect(r.ok === false && r.reason).toBe("modo_sandbox");
  });

  it("no exige cuenta si MERCADOPAGO_COLLECTOR_ID no esta configurado", () => {
    const politica = { ...POLITICA_BASE, expectedCollectorId: null };
    expect(verificarPagoContraCompra({ ...pagoReal, collectorId: null }, { amount: 1500, currency: "ARS" }, politica).ok).toBe(true);
  });

  it("tolera el redondeo de centavos", () => {
    expect(verificarPagoContraCompra({ ...pagoReal, amount: 1500.005 }, { amount: 1500, currency: "ARS" }, POLITICA_BASE).ok).toBe(true);
    expect(verificarPagoContraCompra({ ...pagoReal, amount: 1500.05 }, { amount: 1500, currency: "ARS" }, POLITICA_BASE).ok).toBe(false);
  });
});

describe("SEC-01 · el request no dicta el resultado", () => {
  it("del body solo se toma el puntero al recurso", () => {
    const body = {
      data: { id: "12345" },
      status: "approved",
      order_id: 7,
      transaction_amount: 1,
      external_reference: "orden_7",
    };
    expect(extraerIdRecursoProveedor(body, {})).toBe("12345");
  });

  it("prioriza el data.id de la query, que es lo que va firmado", () => {
    expect(extraerIdRecursoProveedor({ id: "del-body" }, { "data.id": "de-la-query" })).toBe("de-la-query");
  });

  it("devuelve null si no hay identificador de recurso", () => {
    expect(extraerIdRecursoProveedor({ status: "approved", order_id: 7 }, {})).toBeNull();
  });

  it("no acepta estados inventados ni sinonimos del atacante", () => {
    expect(normalizarEstadoProveedor("aprobado")).toBeNull();
    expect(normalizarEstadoProveedor("pagada")).toBeNull();
    expect(normalizarEstadoProveedor("TOTALMENTE_APROBADO")).toBeNull();
    expect(normalizarEstadoProveedor("approved")).toBe("approved");
    expect(normalizarEstadoProveedor("processed")).toBe("approved");
    expect(normalizarEstadoProveedor("rejected")).toBe("rejected");
    expect(normalizarEstadoProveedor("expired")).toBe("expired");
    expect(normalizarEstadoProveedor("pending")).toBeNull();
    expect(normalizarEstadoProveedor("in_process")).toBeNull();
  });

  it("no cancela una compra por un contracargo automatico", () => {
    expect(normalizarEstadoProveedor("charged_back")).toBeNull();
  });
});
