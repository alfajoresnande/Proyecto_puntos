"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmailVerificationCode = sendEmailVerificationCode;
exports.sendPasswordResetEmail = sendPasswordResetEmail;
exports.sendOrderReceiptEmail = sendOrderReceiptEmail;
require("dotenv/config");
const db_1 = require("../db");
function escapeHtml(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
async function sendResendEmail(input) {
    const resendApiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM || process.env.EMAIL_FROM || "Nand\u00e9 <no-reply@nande.local>";
    const replyTo = process.env.RESEND_REPLY_TO || undefined;
    if (!resendApiKey) {
        console.warn(input.devLog);
        return false;
    }
    const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            from,
            ...(replyTo ? { reply_to: replyTo } : {}),
            to: input.to,
            subject: input.subject,
            html: input.html,
            text: input.text,
        }),
    });
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Error enviando email (${res.status}): ${body || "sin detalle"}`);
    }
    return true;
}
async function sendEmailVerificationCode(input) {
    const safeName = escapeHtml(input.nombre || "Usuario");
    const safeCode = escapeHtml(input.code);
    const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #2D1200;">
      <h2 style="color:#D4621A;">Verificacion de correo</h2>
      <p>Hola ${safeName},</p>
      <p>Usa este codigo para activar tu cuenta:</p>
      <p style="font-size:28px;letter-spacing:6px;font-weight:700;color:#2D1200;margin:24px 0;">${safeCode}</p>
      <p>Este codigo vence en <strong>${input.expiresMinutes} minutos</strong>.</p>
      <p style="font-size:13px;color:#8B5A30;">
        Si no creaste una cuenta en Nande, podes ignorar este correo.
      </p>
    </div>
  `;
    const text = [
        "Verificacion de correo",
        `Hola ${input.nombre || "Usuario"},`,
        `Tu codigo de verificacion es: ${input.code}`,
        `Vence en ${input.expiresMinutes} minutos.`,
        "Si no creaste una cuenta en Nande, ignora este correo.",
    ].join("\n");
    await sendResendEmail({
        to: input.to,
        subject: "Verifica tu correo - Nande",
        html,
        text,
        devLog: `[MAIL][DEV] RESEND_API_KEY no configurada. Codigo de verificacion: to=${input.to} code=${input.code}`,
    });
}
async function sendPasswordResetEmail(input) {
    const safeName = escapeHtml(input.nombre || "Usuario");
    const safeLink = escapeHtml(input.resetLink);
    const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #2D1200;">
      <h2 style="color:#D4621A;">Recuperaci&oacute;n de contrase&ntilde;a</h2>
      <p>Hola ${safeName},</p>
      <p>Recibimos una solicitud para cambiar tu contrase&ntilde;a.</p>
      <p>Este enlace vence en <strong>${input.expiresMinutes} minutos</strong>.</p>
      <p>
        <a href="${safeLink}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:#D4621A;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;">
          Haz click aqu&iacute; para cambiar tu contrase&ntilde;a
        </a>
      </p>
      <p style="font-size:13px;color:#8B5A30;">
        Si el bot&oacute;n no funciona, copi&aacute; y peg&aacute; este enlace en tu navegador:
      </p>
      <p style="word-break:break-all;font-size:13px;line-height:1.5;">
        <a href="${safeLink}" target="_blank" rel="noopener noreferrer" style="color:#D4621A;">${safeLink}</a>
      </p>
      <p style="font-size:13px;color:#8B5A30;">
        Si no hiciste esta solicitud, pod&eacute;s ignorar este correo.
      </p>
    </div>
  `;
    const text = [
        "Recuperaci\u00f3n de contrase\u00f1a",
        `Hola ${input.nombre || "Usuario"},`,
        `Us\u00e1 este enlace para cambiar tu contrase\u00f1a (vence en ${input.expiresMinutes} minutos):`,
        input.resetLink,
        "Si no hiciste esta solicitud, ignora este correo.",
    ].join("\n");
    await sendResendEmail({
        to: input.to,
        subject: "Restablecer contrase\u00f1a - Nand\u00e9",
        html,
        text,
        devLog: `[MAIL][DEV] RESEND_API_KEY no configurada. Link de reset: to=${input.to} link=${input.resetLink}`,
    });
}
function money(value) {
    const n = Number(value ?? 0);
    return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(Number.isFinite(n) ? n : 0);
}
function parseJsonField(value) {
    if (!value)
        return null;
    if (typeof value === "object" && !Array.isArray(value))
        return value;
    if (typeof value !== "string")
        return null;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    }
    catch {
        return null;
    }
}
function paymentMethodLabel(metodo) {
    const normalized = (metodo || "").trim().toLowerCase();
    if (normalized === "cash" || normalized === "efectivo")
        return "Efectivo al retirar";
    if (normalized === "wallet")
        return "Mercado Pago";
    if (normalized === "qr")
        return "Mercado Pago QR";
    if (normalized === "brick")
        return "Tarjeta";
    return "Sin definir";
}
function formatDate(value) {
    const date = value instanceof Date ? value : new Date(String(value || ""));
    if (Number.isNaN(date.getTime()))
        return "-";
    return new Intl.DateTimeFormat("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    }).format(date);
}
async function sendOrderReceiptEmail(orderId) {
    const order = await (0, db_1.qOne)(db_1.pool, `SELECT o.id, o.estado, o.total_dinero, o.total_puntos, o.moneda, o.direccion_envio_json,
            o.sucursal_retiro_id, o.created_at, o.receipt_email_sent_at,
            u.nombre AS cliente_nombre, u.email AS cliente_email, u.dni AS cliente_dni,
            s.nombre AS sucursal_nombre, s.direccion AS sucursal_direccion,
            s.localidad AS sucursal_localidad, s.provincia AS sucursal_provincia
     FROM ordenes o
     JOIN usuarios u ON u.id = o.usuario_id
     LEFT JOIN sucursales s ON s.id = o.sucursal_retiro_id
     WHERE o.id = ?
     LIMIT 1`, [orderId]);
    if (!order || order.estado !== "pagada" || order.receipt_email_sent_at || !order.cliente_email) {
        return false;
    }
    const items = await (0, db_1.qAll)(db_1.pool, `SELECT p.nombre, oi.cantidad, oi.precio_dinero_unit, oi.subtotal_dinero, oi.puntaje_al_comprar_unitario
     FROM orden_items oi
     JOIN productos p ON p.id = oi.producto_id
     WHERE oi.orden_id = ?
     ORDER BY oi.id ASC`, [orderId]);
    const pago = await (0, db_1.qOne)(db_1.pool, `SELECT proveedor, metodo, estado, monto, moneda
     FROM pagos
     WHERE orden_id = ?
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`, [orderId]);
    const direccionEnvio = parseJsonField(order.direccion_envio_json);
    const puntosGanados = items.reduce((acc, item) => acc + Number(item.cantidad) * Number(item.puntaje_al_comprar_unitario ?? 0), 0);
    const safeName = escapeHtml(order.cliente_nombre || "Cliente");
    const itemRows = items
        .map((item) => {
        const name = escapeHtml(item.nombre);
        return `<tr>
        <td style="padding:10px;border-bottom:1px solid #F1D8BF;">${name}</td>
        <td style="padding:10px;border-bottom:1px solid #F1D8BF;text-align:center;">${Number(item.cantidad)}</td>
        <td style="padding:10px;border-bottom:1px solid #F1D8BF;text-align:right;">${money(item.precio_dinero_unit)}</td>
        <td style="padding:10px;border-bottom:1px solid #F1D8BF;text-align:right;">${money(item.subtotal_dinero)}</td>
      </tr>`;
    })
        .join("");
    const entrega = direccionEnvio
        ? `Envio a domicilio: ${[
            direccionEnvio.direccion,
            direccionEnvio.localidad,
            direccionEnvio.provincia,
            direccionEnvio.codigo_postal,
        ].filter(Boolean).join(", ")}`
        : order.sucursal_nombre
            ? `Retiro en sucursal: ${order.sucursal_nombre} - ${[order.sucursal_direccion, order.sucursal_localidad, order.sucursal_provincia].filter(Boolean).join(", ")}`
            : "Entrega a coordinar";
    const html = `
    <div style="font-family: Arial, sans-serif; max-width: 680px; margin: 0 auto; color: #2D1200;">
      <div style="border-bottom:3px solid #D4621A;padding:18px 0;margin-bottom:20px;">
        <h1 style="margin:0;color:#2D1200;font-size:24px;">Comprobante de pedido #${order.id}</h1>
        <p style="margin:8px 0 0;color:#8B5A30;">${formatDate(order.created_at)}</p>
      </div>
      <p>Hola ${safeName}, recibimos el pago de tu compra. Te dejamos el resumen del pedido.</p>
      <div style="background:#FFF8F0;border:1px solid #F1D8BF;border-radius:10px;padding:14px;margin:18px 0;">
        <p style="margin:0 0 8px;"><strong>Estado:</strong> Pago aprobado</p>
        <p style="margin:0 0 8px;"><strong>Metodo de pago:</strong> ${escapeHtml(paymentMethodLabel(pago?.metodo))}</p>
        <p style="margin:0;"><strong>Entrega:</strong> ${escapeHtml(entrega)}</p>
      </div>
      <table style="width:100%;border-collapse:collapse;margin:18px 0;">
        <thead>
          <tr style="background:#F5DDB5;">
            <th style="padding:10px;text-align:left;">Producto</th>
            <th style="padding:10px;text-align:center;">Cant.</th>
            <th style="padding:10px;text-align:right;">Precio</th>
            <th style="padding:10px;text-align:right;">Subtotal</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>
      <div style="text-align:right;font-size:16px;">
        ${Number(order.total_puntos ?? 0) > 0 ? `<p style="margin:4px 0;">Puntos usados: ${Number(order.total_puntos)} pts</p>` : ""}
        ${puntosGanados > 0 ? `<p style="margin:4px 0;color:#D4621A;">Puntos ganados: +${puntosGanados} pts</p>` : ""}
        <p style="font-size:20px;margin:8px 0 0;"><strong>Total: ${money(order.total_dinero)}</strong></p>
      </div>
      <p style="margin-top:24px;font-size:13px;color:#8B5A30;">Este documento no es valido como factura.</p>
      <p style="font-size:13px;color:#8B5A30;">Gracias por elegir Nande Alfajores Correntinos.</p>
    </div>
  `;
    const text = [
        `Comprobante de pedido #${order.id}`,
        `Fecha: ${formatDate(order.created_at)}`,
        `Cliente: ${order.cliente_nombre || "Cliente"}`,
        `Metodo de pago: ${paymentMethodLabel(pago?.metodo)}`,
        `Entrega: ${entrega}`,
        "Productos:",
        ...items.map((item) => `- ${item.nombre} x${Number(item.cantidad)}: ${money(item.subtotal_dinero)}`),
        puntosGanados > 0 ? `Puntos ganados: +${puntosGanados} pts` : "",
        `Total: ${money(order.total_dinero)}`,
        "Este documento no es valido como factura.",
    ].filter(Boolean).join("\n");
    const sent = await sendResendEmail({
        to: order.cliente_email,
        subject: `Comprobante de pedido #${order.id} - Nande`,
        html,
        text,
        devLog: `[MAIL][DEV] RESEND_API_KEY no configurada. Comprobante pedido #${order.id} para ${order.cliente_email}`,
    });
    if (sent) {
        await (0, db_1.qRun)(db_1.pool, "UPDATE ordenes SET receipt_email_sent_at = CURRENT_TIMESTAMP WHERE id = ? AND receipt_email_sent_at IS NULL", [orderId]);
    }
    return sent;
}
