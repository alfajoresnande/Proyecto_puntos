/**
 * Test de la ruta real del webhook con las dependencias inyectadas por mock.
 * No necesita MySQL: `../db` esta mockeado con una conexion falsa que simula
 * el ledger de idempotencia.
 */
import { createHmac } from "crypto";
import type { AddressInfo } from "net";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "secreto-de-prueba-para-firmar-webhooks-0123456789";
process.env.MERCADOPAGO_WEBHOOK_SECRET = SECRET;
process.env.MERCADOPAGO_COLLECTOR_ID = "123456789";
process.env.PAYMENTS_CURRENCY = "ARS";
process.env.NODE_ENV = "test";

/** Estado compartido que los mocks leen y los tests configuran. */
const estado = {
  /** Claves ya insertadas en pago_webhook_eventos. */
  eventos: new Set<string>(),
  /** Filas de `ordenes` disponibles, por id. */
  ordenes: new Map<number, { monto: number }>(),
  /** Respuesta que devuelve la API de Mercado Pago. */
  paymentLookup: null as Record<string, unknown> | null,
  lookupError: null as Error | null,
  aprobadas: [] as number[],
  eventosSeguridad: [] as Array<{ evento: string; detalles: unknown }>,
};

vi.mock("../db", () => {
  const conn = {
    beginTransaction: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
    release: vi.fn(() => {}),
  };
  return {
    pool: { getConnection: vi.fn(async () => conn) },
    qOne: vi.fn(async (_conn: unknown, sql: string, params: unknown[]) => {
      if (sql.includes("FROM ordenes")) return estado.ordenes.get(Number(params[0]));
      if (sql.includes("FROM checkout_pendientes")) return undefined;
      if (sql.includes("FROM cobros_manuales")) return undefined;
      return undefined;
    }),
    qRun: vi.fn(async (_conn: unknown, sql: string, params: unknown[]) => {
      if (sql.includes("pago_webhook_eventos")) {
        const key = `${params[0]}|${params[1]}|${params[2]}`;
        if (estado.eventos.has(key)) return { insertId: 0, affectedRows: 0 };
        estado.eventos.add(key);
        return { insertId: 1, affectedRows: 1 };
      }
      return { insertId: 0, affectedRows: 1 };
    }),
  };
});

vi.mock("../services/paymentProviders", () => ({
  getMercadoPagoPayment: vi.fn(async () => {
    if (estado.lookupError) throw estado.lookupError;
    return estado.paymentLookup;
  }),
  getMercadoPagoQrOrder: vi.fn(async () => {
    if (estado.lookupError) throw estado.lookupError;
    return estado.paymentLookup;
  }),
}));

vi.mock("../securityMonitor", () => ({
  recordSecurityEvent: vi.fn((evento: string, _req: unknown, detalles?: unknown) => {
    estado.eventosSeguridad.push({ evento, detalles });
  }),
}));

vi.mock("../realtime", () => ({ emitRealtime: vi.fn() }));
// El limite de caudal se prueba aparte; aca interesa la logica de autenticidad.
vi.mock("../services/authRateLimit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
}));
vi.mock("../services/email", () => ({ sendOrderReceiptEmail: vi.fn(async () => {}) }));

vi.mock("../services/orderLifecycle", () => ({
  approvePaidOrder: vi.fn(async (_conn: unknown, input: { orderId: number }) => {
    estado.aprobadas.push(input.orderId);
    return { ok: true, orderId: input.orderId, previousState: "pendiente_pago", state: "pagada", changed: true };
  }),
  rejectOrExpirePendingOrder: vi.fn(async (_conn: unknown, input: { orderId: number }) => ({
    ok: true,
    orderId: input.orderId,
    previousState: "pendiente_pago",
    state: "cancelada",
    changed: true,
  })),
}));

vi.mock("../services/pendingCheckout", () => ({
  approvePendingCheckoutAndCreateOrder: vi.fn(async () => ({ orderId: 1 })),
  rejectOrExpirePendingCheckout: vi.fn(async () => ({ ok: true })),
}));

let baseUrl = "";
let server: ReturnType<express.Express["listen"]>;

beforeAll(async () => {
  const { default: pagosRoutes } = await import("../routes/pagos");
  const app = express();
  app.use(express.json());
  app.use("/api/pagos", pagosRoutes);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  estado.eventos.clear();
  estado.ordenes.clear();
  estado.ordenes.set(7, { monto: 1500 });
  estado.aprobadas = [];
  estado.eventosSeguridad = [];
  estado.lookupError = null;
  estado.paymentLookup = {
    providerPaymentId: "payment-1",
    status: "approved",
    statusDetail: "accredited",
    externalReference: "orden_7",
    orderId: 7,
    checkoutId: null,
    manualChargeId: null,
    amount: 1500,
    currency: "ARS",
    collectorId: "123456789",
    liveMode: true,
    payload: { id: "payment-1" },
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

function firmar(dataId: string, requestId: string): { "x-signature": string; "x-request-id": string } {
  const ts = String(Math.floor(Date.now() / 1000));
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac("sha256", SECRET).update(manifest).digest("hex");
  return { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId };
}

async function postWebhook(
  proveedor: string,
  body: unknown,
  headers: Record<string, string> = {},
  query = "",
): Promise<{ status: number; json: any }> {
  const response = await fetch(`${baseUrl}/api/pagos/webhook/${proveedor}${query}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, json };
}

describe("POST /api/pagos/webhook/:proveedor", () => {
  it("proveedor desconocido: 404 y no toca ninguna orden", async () => {
    const { status } = await postWebhook("proveedor-falso", {
      order_id: 7,
      status: "approved",
      transaction_amount: 1500,
    });
    expect(status).toBe(404);
    expect(estado.aprobadas).toEqual([]);
    expect(estado.eventosSeguridad.map((e) => e.evento)).toContain("pago_webhook_proveedor_no_permitido");
  });

  it("el exploit original (proveedor inventado + estado approved) ya no aprueba nada", async () => {
    for (const proveedor of ["x", "pagos360", "efectivo", "MERCADOPAGO_", "mercado-pago"]) {
      const { status } = await postWebhook(proveedor, {
        data: { id: "payment-1" },
        status: "approved",
        external_reference: "orden_7",
        transaction_amount: 1500,
      });
      expect(status).toBe(404);
    }
    expect(estado.aprobadas).toEqual([]);
  });

  it("firma ausente en un pago normal: 401", async () => {
    const { status } = await postWebhook("mercadopago", { data: { id: "payment-1" } });
    expect(status).toBe(401);
    expect(estado.aprobadas).toEqual([]);
  });

  it("firma incorrecta: 401", async () => {
    const { status } = await postWebhook(
      "mercadopago",
      { data: { id: "payment-1" } },
      { "x-signature": `ts=${Math.floor(Date.now() / 1000)},v1=${"a".repeat(64)}`, "x-request-id": "req-1" },
    );
    expect(status).toBe(401);
    expect(estado.aprobadas).toEqual([]);
  });

  it("firma valida para otro recurso: 401 (no se puede reapuntar el pago)", async () => {
    const { status } = await postWebhook(
      "mercadopago",
      { data: { id: "payment-999" } },
      firmar("payment-1", "req-1"),
    );
    expect(status).toBe(401);
    expect(estado.aprobadas).toEqual([]);
  });

  it("sin identificador de recurso: 400", async () => {
    const { status } = await postWebhook("mercadopago", { status: "approved", order_id: 7 });
    expect(status).toBe(400);
    expect(estado.aprobadas).toEqual([]);
  });

  it("firma valida y datos coincidentes: aprueba la orden", async () => {
    const { status, json } = await postWebhook(
      "mercadopago",
      { data: { id: "payment-1" } },
      firmar("payment-1", "req-1"),
    );
    expect(status).toBe(200);
    expect(json.orderId).toBe(7);
    expect(estado.aprobadas).toEqual([7]);
  });

  it("replay de la misma notificacion: se ignora y no reaprueba", async () => {
    await postWebhook("mercadopago", { data: { id: "payment-1" } }, firmar("payment-1", "req-1"));
    expect(estado.aprobadas).toEqual([7]);

    const segundo = await postWebhook("mercadopago", { data: { id: "payment-1" } }, firmar("payment-1", "req-2"));
    expect(segundo.status).toBe(200);
    expect(segundo.json).toMatchObject({ ignored: true, reason: "evento_ya_procesado" });
    expect(estado.aprobadas).toEqual([7]);
  });

  it("importe distinto al de la orden: 400 y no aprueba", async () => {
    estado.paymentLookup = { ...estado.paymentLookup, amount: 1 };
    const { status } = await postWebhook("mercadopago", { data: { id: "payment-1" } }, firmar("payment-1", "req-1"));
    expect(status).toBe(400);
    expect(estado.aprobadas).toEqual([]);
    expect(estado.eventosSeguridad.map((e) => e.evento)).toContain("pago_webhook_monto_invalido");
  });

  it("cuenta vendedora distinta: 400 y no aprueba", async () => {
    estado.paymentLookup = { ...estado.paymentLookup, collectorId: "999" };
    const { status } = await postWebhook("mercadopago", { data: { id: "payment-1" } }, firmar("payment-1", "req-1"));
    expect(status).toBe(400);
    expect(estado.aprobadas).toEqual([]);
  });

  it("moneda distinta: 400 y no aprueba", async () => {
    estado.paymentLookup = { ...estado.paymentLookup, currency: "USD" };
    const { status } = await postWebhook("mercadopago", { data: { id: "payment-1" } }, firmar("payment-1", "req-1"));
    expect(status).toBe(400);
    expect(estado.aprobadas).toEqual([]);
  });

  it("referencia inexistente en la base: 400 y no aprueba", async () => {
    estado.ordenes.clear();
    const { status } = await postWebhook("mercadopago", { data: { id: "payment-1" } }, firmar("payment-1", "req-1"));
    expect(status).toBe(400);
    expect(estado.aprobadas).toEqual([]);
  });

  it("el proveedor no devuelve referencia: 202 ignorado", async () => {
    estado.paymentLookup = { ...estado.paymentLookup, orderId: null, checkoutId: null, manualChargeId: null };
    const { status, json } = await postWebhook("mercadopago", { data: { id: "payment-1" } }, firmar("payment-1", "req-1"));
    expect(status).toBe(202);
    expect(json.reason).toBe("referencia_no_identificada");
  });

  it("ignora por completo el importe/estado/orden que manda el request", async () => {
    // El atacante firma correctamente un pago REAL de 1500 sobre la orden 7,
    // pero intenta redirigirlo a otra orden con otro importe desde el body.
    estado.ordenes.set(99, { monto: 999999 });
    const { status } = await postWebhook(
      "mercadopago",
      {
        data: { id: "payment-1" },
        order_id: 99,
        external_reference: "orden_99",
        transaction_amount: 999999,
        status: "approved",
      },
      firmar("payment-1", "req-1"),
    );
    expect(status).toBe(200);
    // Se aprobo la orden que dice Mercado Pago (7), no la del body (99).
    expect(estado.aprobadas).toEqual([7]);
  });

  it("si la consulta al proveedor falla: 502 y no aprueba", async () => {
    estado.lookupError = new Error("Mercado Pago: no se pudo consultar el pago (404).");
    const { status } = await postWebhook("mercadopago", { data: { id: "payment-1" } }, firmar("payment-1", "req-1"));
    expect(status).toBe(502);
    expect(estado.aprobadas).toEqual([]);
  });

  it("no filtra el detalle interno del error en la respuesta publica", async () => {
    estado.ordenes.clear();
    const { json } = await postWebhook("mercadopago", { data: { id: "payment-1" } }, firmar("payment-1", "req-1"));
    expect(json.error).toBe("No se pudo procesar la notificacion de pago.");
    expect(JSON.stringify(json)).not.toContain("No existe la compra");
  });

  it("order QR sin firma: se acepta pero el estado sale de la API, no del body", async () => {
    estado.paymentLookup = {
      providerPaymentId: "ORD-1",
      paymentId: "pay-qr-1",
      status: "processed",
      externalReference: "orden_7",
      orderId: 7,
      checkoutId: null,
      amount: 1500,
      currency: "ARS",
      collectorId: "123456789",
      liveMode: true,
      payload: { id: "ORD-1" },
    };
    const { status } = await postWebhook("mercadopago", { data: { id: "ORD-1" }, status: "rejected" }, {});
    expect(status).toBe(200);
    expect(estado.aprobadas).toEqual([7]);
  });

  it("una order QR NO sirve para saltarse la validacion de importe", async () => {
    estado.paymentLookup = {
      providerPaymentId: "ORD-2",
      paymentId: "pay-qr-2",
      status: "processed",
      externalReference: "orden_7",
      orderId: 7,
      checkoutId: null,
      amount: 1,
      currency: "ARS",
      collectorId: "123456789",
      liveMode: true,
      payload: { id: "ORD-2" },
    };
    const { status } = await postWebhook("mercadopago", { data: { id: "ORD-2" }, transaction_amount: 1500 }, {});
    expect(status).toBe(400);
    expect(estado.aprobadas).toEqual([]);
  });
});
