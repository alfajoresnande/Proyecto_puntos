import { createHmac, timingSafeEqual } from "crypto";
import { Router } from "express";
import { pool } from "../db";
import { emitRealtime } from "../realtime";
import { approvePaidOrder, rejectOrExpirePendingOrder } from "../services/orderLifecycle";
import { getMercadoPagoPayment, getMercadoPagoQrOrder } from "../services/paymentProviders";
import { recordSecurityEvent } from "../securityMonitor";
import { sendOrderReceiptEmail } from "../services/email";

const router = Router();
const MERCADOPAGO_WEBHOOK_SECRET = (process.env.MERCADOPAGO_WEBHOOK_SECRET || "").trim();

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function parseOrderIdFromReference(reference: string | null): number | null {
  if (!reference) return null;
  const direct = Number(reference);
  if (Number.isInteger(direct) && direct > 0) return direct;
  const match = reference.match(/(?:orden|order|pedido)[_-]?(\d+)/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function resolveOrderId(body: Record<string, unknown>, query: Record<string, unknown>): number | null {
  const metadata = asRecord(body.metadata);
  const data = asRecord(body.data);
  const dataMetadata = asRecord(data.metadata);
  const payment = asRecord(body.payment);
  const paymentMetadata = asRecord(payment.metadata);

  const direct = firstString(
    body.order_id,
    body.orden_id,
    metadata.order_id,
    dataMetadata.order_id,
    paymentMetadata.order_id,
    query.order_id,
    query.orden_id,
  );
  const directId = parseOrderIdFromReference(direct);
  if (directId) return directId;

  return parseOrderIdFromReference(
    firstString(
      body.external_reference,
      metadata.external_reference,
      data.external_reference,
      payment.external_reference,
      query.external_reference,
    ),
  );
}

function resolveProviderPaymentId(body: Record<string, unknown>, query: Record<string, unknown>): string | null {
  const data = asRecord(body.data);
  const payment = asRecord(body.payment);
  return firstString(
    body.provider_payment_id,
    body.payment_id,
    data.id,
    payment.id,
    body.id,
    query["data.id"],
    query.payment_id,
    query.id,
  );
}

function resolvePaymentStatus(body: Record<string, unknown>, query: Record<string, unknown>): "approved" | "rejected" | "expired" | null {
  const data = asRecord(body.data);
  const payment = asRecord(body.payment);
  const raw = firstString(body.status, body.estado, data.status, payment.status, query.status, query.estado);
  const status = raw?.toLowerCase() ?? "";

  if (["approved", "aprobado", "paid", "pagada", "success", "succeeded", "processed"].includes(status)) return "approved";
  if (["expired", "expirada", "vencida"].includes(status)) return "expired";
  if (["rejected", "rechazado", "failed", "failure", "cancelled", "canceled", "cancelada", "refunded"].includes(status)) {
    return "rejected";
  }

  return null;
}

function parseMercadoPagoSignature(signatureHeader: string): { ts: string | null; v1: string | null } {
  let ts: string | null = null;
  let v1: string | null = null;

  for (const part of signatureHeader.split(",")) {
    const [rawKey, rawValue] = part.split("=", 2);
    const key = rawKey?.trim().toLowerCase();
    const value = rawValue?.trim() || null;
    if (!key || !value) continue;
    if (key === "ts") ts = value;
    if (key === "v1") v1 = value.toLowerCase();
  }

  return { ts, v1 };
}

function secureHexEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  if (leftBuffer.length === 0 || rightBuffer.length === 0 || leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function validateMercadoPagoWebhook(req: Parameters<typeof router.post>[1] extends (...args: infer T) => unknown ? T[0] : never): boolean {
  if (!MERCADOPAGO_WEBHOOK_SECRET) return true;

  const signatureHeader = req.get("x-signature")?.trim() || "";
  const requestId = req.get("x-request-id")?.trim() || "";
  const dataId = (firstString(req.query["data.id"]) || "").toLowerCase();

  if (!signatureHeader) return false;

  const { ts, v1 } = parseMercadoPagoSignature(signatureHeader);
  if (!ts || !v1) return false;

  const manifestParts: string[] = [];
  if (dataId) manifestParts.push(`id:${dataId}`);
  if (requestId) manifestParts.push(`request-id:${requestId}`);
  manifestParts.push(`ts:${ts}`);
  if (!manifestParts.length) return false;
  const manifest = `${manifestParts.join(";")};`;

  const expectedSignature = createHmac("sha256", MERCADOPAGO_WEBHOOK_SECRET).update(manifest).digest("hex");
  return secureHexEquals(expectedSignature, v1);
}

router.post("/webhook/:proveedor", async (req, res) => {
  const proveedor = String(req.params.proveedor || "").trim().toLowerCase();
  if (proveedor === "mercadopago" && !validateMercadoPagoWebhook(req)) {
    recordSecurityEvent("pago_webhook_firma_invalida", req, {
      proveedor,
      hasSecret: Boolean(MERCADOPAGO_WEBHOOK_SECRET),
    });
    res.status(401).json({ error: "Firma del webhook de Mercado Pago invalida." });
    return;
  }

  const body = asRecord(req.body);
  const query = asRecord(req.query);
  let orderId = resolveOrderId(body, query);
  let providerPaymentId = resolveProviderPaymentId(body, query);
  let status = resolvePaymentStatus(body, query);
  let resolvedPayload: Record<string, unknown> = { body, query };

  if (proveedor === "mercadopago" && providerPaymentId && providerPaymentId.toUpperCase().startsWith("ORD") && (!orderId || !status)) {
    try {
      const order = await getMercadoPagoQrOrder(providerPaymentId);
      orderId = orderId ?? order.orderId;
      providerPaymentId = order.providerPaymentId ?? providerPaymentId;
      status = status ?? resolvePaymentStatus(order.payload, {});
      resolvedPayload = {
        body,
        query,
        qr_order_lookup: order.payload,
      };
    } catch (error) {
      recordSecurityEvent("pago_webhook_qr_order_lookup_fallido", req, {
        proveedor,
        providerPaymentId,
        reason: error instanceof Error ? error.message : "lookup_error",
      });
    }
  }

  if (proveedor === "mercadopago" && providerPaymentId && !providerPaymentId.toUpperCase().startsWith("ORD") && (!orderId || !status)) {
    try {
      const payment = await getMercadoPagoPayment(providerPaymentId);
      orderId = orderId ?? payment.orderId;
      providerPaymentId = payment.providerPaymentId ?? providerPaymentId;
      status = status ?? resolvePaymentStatus(payment.payload, {});
      resolvedPayload = {
        body,
        query,
        payment_lookup: payment.payload,
      };
    } catch (error) {
      recordSecurityEvent("pago_webhook_lookup_fallido", req, {
        proveedor,
        providerPaymentId,
        reason: error instanceof Error ? error.message : "lookup_error",
      });
    }
  }

  if (!orderId) {
    recordSecurityEvent("pago_webhook_sin_orden", req, { proveedor, providerPaymentId });
    res.status(202).json({ ok: true, ignored: true, reason: "orden_no_identificada" });
    return;
  }

  if (!status) {
    res.status(202).json({ ok: true, ignored: true, reason: "estado_no_accionable", orden_id: orderId });
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result =
      status === "approved"
        ? await approvePaidOrder(conn, {
            orderId,
            provider: proveedor,
            providerPaymentId,
            payload: resolvedPayload,
          })
        : await rejectOrExpirePendingOrder(conn, {
            orderId,
            nextState: status === "expired" ? "expirada" : "cancelada",
            provider: proveedor,
            providerPaymentId,
            payload: resolvedPayload,
          });
    await conn.commit();
    emitRealtime(["ordenes", "inventario", "productos", "stats", "puntos"]);
    if (status === "approved") {
      void sendOrderReceiptEmail(orderId).catch((error) => {
        console.error(`[MAIL] Error enviando comprobante orden #${orderId}:`, error instanceof Error ? error.message : error);
      });
    }
    res.json(result);
  } catch (err) {
    await conn.rollback();
    const message = err instanceof Error ? err.message : "No se pudo procesar el webhook.";
    res.status(400).json({ error: message });
  } finally {
    conn.release();
  }
});

export default router;
