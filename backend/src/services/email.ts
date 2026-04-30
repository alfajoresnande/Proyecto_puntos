import "dotenv/config";

type PasswordResetEmailInput = {
  to: string;
  nombre: string;
  resetLink: string;
  expiresMinutes: number;
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export async function sendPasswordResetEmail(input: PasswordResetEmailInput): Promise<void> {
  const resendApiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || process.env.EMAIL_FROM || "Sistema de Puntos <no-reply@nande.local>";
  const replyTo = process.env.RESEND_REPLY_TO || undefined;

  const safeName = escapeHtml(input.nombre || "Usuario");
  const safeLink = escapeHtml(input.resetLink);
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #2D1200;">
      <h2 style="color:#D4621A;">Recuperacion de contrasena</h2>
      <p>Hola ${safeName},</p>
      <p>Recibimos una solicitud para restablecer tu contrasena.</p>
      <p>Este enlace vence en <strong>${input.expiresMinutes} minutos</strong>.</p>
      <p>
        <a href="${safeLink}" style="display:inline-block;background:#D4621A;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;">
          Restablecer contrasena
        </a>
      </p>
      <p style="font-size:13px;color:#8B5A30;">
        Si no hiciste esta solicitud, podes ignorar este correo.
      </p>
    </div>
  `;

  const text = [
    "Recuperacion de contrasena",
    `Hola ${input.nombre || "Usuario"},`,
    `Usa este enlace para restablecer tu contrasena (vence en ${input.expiresMinutes} minutos):`,
    input.resetLink,
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
      subject: "Restablecer contrasena - Sistema de Puntos",
      html,
      text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Error enviando email de reset (${res.status}): ${body || "sin detalle"}`);
  }
}
