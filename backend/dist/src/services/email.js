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
    const from = process.env.EMAIL_FROM || "Sistema de Puntos <no-reply@nande.local>";
    const safeName = escapeHtml(input.nombre || "Usuario");
    const safeLink = escapeHtml(input.resetLink);
    const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #2D1200;">
      <h2 style="color:#D4621A;">Recuperación de contraseña</h2>
      <p>Hola ${safeName},</p>
      <p>Recibimos una solicitud para restablecer tu contraseña.</p>
      <p>Este enlace vence en <strong>${input.expiresMinutes} minutos</strong>.</p>
      <p>
        <a href="${safeLink}" style="display:inline-block;background:#D4621A;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;">
          Restablecer contraseña
        </a>
      </p>
      <p style="font-size:13px;color:#8B5A30;">
        Si no hiciste esta solicitud, podés ignorar este correo.
      </p>
    </div>
  `;
    const text = [
        "Recuperación de contraseña",
        `Hola ${input.nombre || "Usuario"},`,
        `Usá este enlace para restablecer tu contraseña (vence en ${input.expiresMinutes} minutos):`,
        input.resetLink,
        "Si no hiciste esta solicitud, ignorá este correo.",
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
            to: input.to,
            subject: "Restablecer contraseña - Sistema de Puntos",
            html,
            text,
        }),
    });
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Error enviando email de reset (${res.status}): ${body || "sin detalle"}`);
    }
}
