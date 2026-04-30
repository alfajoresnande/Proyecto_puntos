"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendPasswordResetEmail = sendPasswordResetEmail;
require("dotenv/config");
function escapeHtml(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
async function sendPasswordResetEmail(input) {
    const resendApiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM || process.env.EMAIL_FROM || "Nand\u00e9 <no-reply@nande.local>";
    const replyTo = process.env.RESEND_REPLY_TO || undefined;
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
        Si no encontr&aacute;s este mail en tu bandeja principal, revis&aacute; Spam o Correo no deseado.
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
        "Si no encontrás este mail, revisá Spam o Correo no deseado.",
        "Si no hiciste esta solicitud, ignora este correo.",
    ].join("\n");
    if (!resendApiKey) {
        console.warn("[MAIL][DEV] RESEND_API_KEY no configurada. Link de reset:");
        console.warn(`to=${input.to} link=${input.resetLink}`);
        return;
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
            subject: "Restablecer contrase\u00f1a - Nand\u00e9",
            html,
            text,
        }),
    });
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Error enviando email de reset (${res.status}): ${body || "sin detalle"}`);
    }
}
