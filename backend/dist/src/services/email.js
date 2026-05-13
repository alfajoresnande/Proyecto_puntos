"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmailVerificationCode = sendEmailVerificationCode;
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
async function sendResendEmail(input) {
    const resendApiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM || process.env.EMAIL_FROM || "Nand\u00e9 <no-reply@nande.local>";
    const replyTo = process.env.RESEND_REPLY_TO || undefined;
    if (!resendApiKey) {
        console.warn(input.devLog);
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
            subject: input.subject,
            html: input.html,
            text: input.text,
        }),
    });
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Error enviando email (${res.status}): ${body || "sin detalle"}`);
    }
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
