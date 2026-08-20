import { createHmac, timingSafeEqual } from "crypto";
import { Router } from "express";
import { pool, qOne, qRun } from "../db";
import { emitRealtime } from "../realtime";
import { approvePaidOrder, rejectOrExpirePendingOrder } from "../services/orderLifecycle";
import { getMercadoPagoPayment, getMercadoPagoQrOrder } from "../services/paymentProviders";
import { approvePendingCheckoutAndCreateOrder, rejectOrExpirePendingCheckout } from "../services/pendingCheckout";
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

function parseCheckoutIdFromReference(reference: string | null): number | null {
  if (!reference) return null;
  const match = reference.match(/(?:checkout|pago|payment)[_-]?(\d+)/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseManualChargeIdFromReference(reference: string | null): number | null {
  if (!reference) return null;
  const match = reference.match(/cobro[_-]?manual[_-]?(\d+)/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function resolveManualChargeId(body: Record<string, unknown>, query: Record<string, unknown>): number | null {
  const metadata = asRecord(body.metadata);
  const data = asRecord(body.data);
  const dataMetadata = asRecord(data.metadata);
  const payment = asRecord(body.payment);
  const paymentMetadata = asRecord(payment.metadata);
  return parseManualChargeIdFromReference(firstString(
    body.cobro_manual_id,
    metadata.cobro_manual_id,
    dataMetadata.cobro_manual_id,
    paymentMetadata.cobro_manual_id,
    body.external_reference,
    metadata.external_reference,
    data.external_reference,
    payment.external_reference,
    query.external_reference,
  ));
}

function resolveTransactionAmount(payload: Record<string, unknown>): number | null {
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
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
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

function resolveCheckoutId(body: Record<string, unknown>, query: Record<string, unknown>): number | null {
  const metadata = asRecord(body.metadata);
  const data = asRecord(body.data);
  const dataMetadata = asRecord(data.metadata);
  const payment = asRecord(body.payment);
  const paymentMetadata = asRecord(payment.metadata);

  const direct = firstString(
    body.checkout_id,
    metadata.checkout_id,
    dataMetadata.checkout_id,
    paymentMetadata.checkout_id,
    query.checkout_id,
  );
  const directId = parseCheckoutIdFromReference(direct);
  if (directId) return directId;

  return parseCheckoutIdFromReference(
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
  if (!MERCADOPAGO_WEBHOOK_SECRET) return false;

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
  const body = asRecord(req.body);
  const query = asRecord(req.query);
  let orderId = resolveOrderId(body, query);
  let checkoutId = resolveCheckoutId(body, query);
  let manualChargeId = resolveManualChargeId(body, query);
  let providerPaymentId = resolveProviderPaymentId(body, query);
  let status = resolvePaymentStatus(body, query);
  let resolvedPayload: Record<string, unknown> = { body, query };
  const isQrOrderNotification = Boolean(providerPaymentId?.toUpperCase().startsWith("ORD"));

  if (proveedor === "mercadopago") {
    const hasSignature = Boolean(req.get("x-signature")?.trim());
    // Mercado Pago no firma las notificaciones de Orders QR. Solo se aceptan
    // sin firma cuando el recurso es una order QR y luego se valida por API.
    const signatureAccepted = hasSignature ? validateMercadoPagoWebhook(req) : isQrOrderNotification;
    if (!signatureAccepted) {
      recordSecurityEvent("pago_webhook_firma_invalida", req, {
        proveedor,
        hasSecret: Boolean(MERCADOPAGO_WEBHOOK_SECRET),
        hasSignature,
        providerPaymentId,
      });
      res.status(401).json({ error: "Firma del webhook de Mercado Pago invalida o ausente." });
      return;
    }
    if (!providerPaymentId) {
      recordSecurityEvent("pago_webhook_sin_payment_id", req, { proveedor });
      res.status(400).json({ error: "La notificacion no incluye un identificador de pago verificable." });
      return;
    }
  }

  if (proveedor === "mercadopago" && providerPaymentId && isQrOrderNotification) {
    try {
      const order = await getMercadoPagoQrOrder(providerPaymentId);
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
    } catch (error) {
      recordSecurityEvent("pago_webhook_qr_order_lookup_fallido", req, {
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
      const payment = await getMercadoPagoPayment(providerPaymentId);
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
    } catch (error) {
      recordSecurityEvent("pago_webhook_lookup_fallido", req, {
        proveedor,
        providerPaymentId,
        reason: error instanceof Error ? error.message : "lookup_error",
      });
      res.status(502).json({ error: "No se pudo verificar el pago con Mercado Pago." });
      return;
    }
  }

  if (!orderId && !checkoutId && !manualChargeId) {
    recordSecurityEvent("pago_webhook_sin_orden", req, { proveedor, providerPaymentId });
    res.status(202).json({ ok: true, ignored: true, reason: "referencia_no_identificada" });
    return;
  }

  if (!status) {
    res.status(202).json({ ok: true, ignored: true, reason: "estado_no_accionable", orden_id: orderId, checkout_id: checkoutId, cobro_manual_id: manualChargeId });
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (manualChargeId) {
      const cobro = await qOne<{ id: number; monto: number; estado: string }>(
        conn,
        "SELECT id, monto, estado FROM cobros_manuales WHERE id = ? FOR UPDATE",
        [manualChargeId],
      );
      if (!cobro) throw new Error("Cobro manual inexistente.");
      const paidAmount = resolveTransactionAmount(resolvedPayload);
      if (status === "approved" && paidAmount === null) {
        throw new Error("No se pudo verificar el importe aprobado con Mercado Pago.");
      }
      if (status === "approved" && paidAmount !== null && Math.abs(Number(cobro.monto) - paidAmount) > 0.009) {
        recordSecurityEvent("cobro_manual_monto_invalido", req, {
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
      await qRun(
        conn,
        `UPDATE cobros_manuales
         SET estado = ?, provider_payment_id = COALESCE(?, provider_payment_id), payload_json = ?,
             approved_at = IF(? = 'aprobado', COALESCE(approved_at, CURRENT_TIMESTAMP), approved_at),
             oculto = IF(? = 'aprobado', 0, oculto)
         WHERE id = ?`,
        [nextState, providerPaymentId, JSON.stringify(resolvedPayload), nextState, nextState, manualChargeId],
      );
      await conn.commit();
      emitRealtime(["cobros-manuales"]);
      res.json({ ok: true, cobro_manual_id: manualChargeId, estado: nextState });
      return;
    }
    if (proveedor === "mercadopago" && status === "approved") {
      const expected = orderId
        ? await qOne<{ monto: number }>(conn, "SELECT total_dinero AS monto FROM ordenes WHERE id = ? FOR UPDATE", [orderId])
        : await qOne<{ monto: number }>(conn, "SELECT total_dinero AS monto FROM checkout_pendientes WHERE id = ? FOR UPDATE", [Number(checkoutId)]);
      if (!expected) throw new Error("No existe la compra asociada al pago aprobado.");
      const paidAmount = resolveTransactionAmount(resolvedPayload);
      if (paidAmount === null || Math.abs(Number(expected.monto) - paidAmount) > 0.009) {
        recordSecurityEvent("pago_webhook_monto_invalido", req, {
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
      ? (
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
            })
      )
      : (
        status === "approved"
          ? await approvePendingCheckoutAndCreateOrder(conn, {
              checkoutId: Number(checkoutId),
              providerPaymentId,
              payload: resolvedPayload,
            })
          : await rejectOrExpirePendingCheckout(conn, {
              checkoutId: Number(checkoutId),
              nextState: status === "expired" ? "expirada" : "cancelada",
              providerPaymentId,
              payload: resolvedPayload,
            })
      );
    await conn.commit();
    emitRealtime(["ordenes", "inventario", "productos", "stats", "puntos"]);
    if (status === "approved") {
      const receiptOrderId = orderId || (result as { orderId?: number }).orderId || null;
      if (receiptOrderId) {
        void sendOrderReceiptEmail(receiptOrderId).catch((error) => {
          console.error(`[MAIL] Error enviando comprobante orden #${receiptOrderId}:`, error instanceof Error ? error.message : error);
        });
      }
    }
    if (!orderId && checkoutId) {
      res.json({
        ok: true,
        checkout_id: checkoutId,
        ...(status === "approved"
          ? { orden_id: (result as { orderId: number }).orderId, estado: "pagada" }
          : { estado: status === "expired" ? "expirada" : "cancelada" }),
      });
      return;
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
