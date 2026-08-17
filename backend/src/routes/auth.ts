import { Request, Response, Router } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { pool, qOne, qRun, type Queryable } from "../db";
import { isPointsProgramEnabled, recalcularSaldoPuntosUsuario, registrarMovimientoPuntos } from "../services/points";
import { clearAuthCookie, getAuthPayload, requireAuth, setAuthCookie, signToken } from "../auth";
import { recordSecurityEvent } from "../securityMonitor";
import { sendEmailVerificationCode, sendPasswordResetEmail } from "../services/email";
import { getClientIp, getOrCreateDeviceId, hashIdentifier, normalizeEmail } from "../services/authIdentity";
import { checkActiveCooldown, checkRateLimit, type RateLimitCheckResult } from "../services/authRateLimit";
import {
  confirmRegisterLimitKeys,
  googleLimitKeys,
  loginLimitKeys,
  loginUserLimitKeys,
  passwordChangeAttemptLimitKeys,
  passwordChangeLimitKeys,
  passwordResetLimitKeys,
  passwordResetUserLimitKeys,
  registerLimitKeys,
  resetConfirmLimitKeys,
} from "../services/authLimits";

const router = Router();
const googleClient = new OAuth2Client();
const DEFAULT_INVITE_CODE_LENGTH = 9;
const MIN_INVITE_CODE_LENGTH = 6;
const MAX_INVITE_CODE_LENGTH = 20;
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomBytes(24).toString("hex"), 10);
const MINIMUM_ALLOWED_AGE_YEARS = 13;
const EMAIL_VERIFICATION_CODE_DIGITS = 6;
const EMAIL_VERIFICATION_MAX_ATTEMPTS = 5;
const RESEND_VERIFICATION_COOLDOWN_SECONDS = 60;
const REGISTER_PUBLIC_MESSAGE = "Si los datos son validos, te enviaremos un correo de verificacion.";
const PASSWORD_RESET_PUBLIC_MESSAGE = "Si el correo esta registrado, te enviaremos instrucciones para recuperar tu contrasena.";
const ACCEPT_TERMS_MESSAGE = "Debes aceptar los Terminos y Condiciones.";

// Política:
// - Minimo 8 caracteres.
// - Al menos un caracter especial y un numero.
// - Máximo 128 para frenar DoS por hashing bcrypt.
const strongPasswordSchema = z
  .string()
  .min(8, "La contrasena debe tener al menos 8 caracteres")
  .max(128, "La contrasena no puede superar 128 caracteres")
  .regex(/[^A-Za-z0-9]/, "La contrasena debe incluir al menos 1 caracter especial")
  .regex(/\d/, "La contrasena debe incluir al menos un numero");

const acceptedTermsSchema = z.literal(true, {
  errorMap: () => ({ message: ACCEPT_TERMS_MESSAGE }),
});

function secondsToPublicText(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `${minutes} minuto${minutes === 1 ? "" : "s"}`;
}

function sendRateLimited(res: Response, result: RateLimitCheckResult) {
  const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterSeconds ?? 60));
  res.setHeader("Retry-After", String(retryAfterSeconds));
  res.status(429).json({
    error: `Demasiados intentos. Proba nuevamente en ${secondsToPublicText(retryAfterSeconds)}.`,
    retryAfterSeconds,
  });
}

function reportBlockedAuthRateLimit(
  req: Request,
  res: Response,
  action: string,
  details: Record<string, unknown>,
  result: RateLimitCheckResult,
): false {
  recordSecurityEvent("auth_rate_limit_bloqueado", req, {
    action,
    retryAfterSeconds: result.retryAfterSeconds,
    reason: result.reason,
    ...details,
  });
  sendRateLimited(res, result);
  return false;
}

async function enforceAuthRateLimit(
  req: Request,
  res: Response,
  input: Parameters<typeof checkRateLimit>[0],
  details: Record<string, unknown>,
): Promise<boolean> {
  const result = await checkRateLimit(input);
  if (result.allowed) return true;

  return reportBlockedAuthRateLimit(req, res, input.action, details, result);
}

async function enforceActiveAuthCooldown(
  req: Request,
  res: Response,
  input: Parameters<typeof checkActiveCooldown>[0],
  details: Record<string, unknown>,
): Promise<boolean> {
  const result = await checkActiveCooldown(input);
  if (result.allowed) return true;

  return reportBlockedAuthRateLimit(req, res, input.action, details, result);
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

function toTime(value: Date | string | null | undefined): number {
  if (!value) return 0;
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function makeCode(length: number): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length }, () => chars[crypto.randomInt(chars.length)]).join("");
}

async function uniqueInviteCode(length: number, conn: Queryable = pool): Promise<string> {
  while (true) {
    const code = makeCode(length);
    const exists = await qOne(conn, "SELECT id FROM usuarios WHERE codigo_invitacion = ?", [code]);
    if (!exists) return code;
  }
}

function hashResetToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

function hashEmailVerificationCode(email: string, code: string): string {
  return crypto
    .createHash("sha256")
    .update(`${email.trim().toLowerCase()}:${code.trim()}`)
    .digest("hex");
}

function makeResetToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function makeEmailVerificationCode(): string {
  const min = 10 ** (EMAIL_VERIFICATION_CODE_DIGITS - 1);
  const max = 10 ** EMAIL_VERIFICATION_CODE_DIGITS;
  return String(crypto.randomInt(min, max));
}

function parseResetTtlMinutes(): number {
  const raw = Number(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES ?? 30);
  if (Number.isNaN(raw)) return 30;
  return Math.max(15, Math.min(raw, 30));
}

function parseEmailVerificationTtlMinutes(): number {
  const raw = Number(process.env.EMAIL_VERIFICATION_CODE_TTL_MINUTES ?? 15);
  if (Number.isNaN(raw)) return 15;
  return Math.max(15, Math.min(raw, 30));
}

function normalizeResetPasswordUrl(): string {
  const explicitUrl = process.env.FRONTEND_RESET_PASSWORD_URL?.trim();
  if (explicitUrl) return explicitUrl.replace(/\/+$/, "");

  const frontendUrl = process.env.FRONTEND_URL
    ?.split(",")
    .map((item) => item.trim())
    .find(Boolean);

  const baseUrl = frontendUrl || "http://localhost:5173";
  return `${baseUrl.replace(/\/+$/, "")}/reset-password`;
}

function makeRandomPasswordHash(): Promise<string> {
  return bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
}

async function getInviteCodeLength(conn: Queryable = pool): Promise<number> {
  const row = await qOne<{ valor: string }>(conn, "SELECT valor FROM configuracion WHERE clave = 'longitud_codigo_invitacion' LIMIT 1");
  const parsed = Number(row?.valor ?? DEFAULT_INVITE_CODE_LENGTH);
  if (!Number.isInteger(parsed)) return DEFAULT_INVITE_CODE_LENGTH;
  return Math.max(MIN_INVITE_CODE_LENGTH, Math.min(MAX_INVITE_CODE_LENGTH, parsed));
}

function isValidInviteCode(code: string, length: number): boolean {
  return new RegExp(`^[A-Z0-9]{${length}}$`).test(code);
}

function publicUser(user: any) {
  const { password_hash, activo, google_id, email_verificado, email_verificado_at, ...safeUser } = user;
  return safeUser;
}

async function createEmailVerificationCode(
  conn: Queryable,
  input: { usuarioId: number; email: string; ip?: string | null; userAgent?: string | null },
): Promise<{ code: string; ttlMinutes: number }> {
  const ttlMinutes = parseEmailVerificationTtlMinutes();
  const code = makeEmailVerificationCode();
  const codeHash = hashEmailVerificationCode(input.email, code);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

  await qRun(conn,
    "UPDATE email_verification_codes SET used_at = NOW() WHERE usuario_id = ? AND used_at IS NULL",
    [input.usuarioId]
  );

  await qRun(conn,
    `INSERT INTO email_verification_codes
       (usuario_id, codigo_hash, expires_at, requested_ip, requested_user_agent)
     VALUES (?, ?, ?, ?, ?)`,
    [input.usuarioId, codeHash, expiresAt, input.ip ?? null, (input.userAgent || "").slice(0, 255) || null]
  );

  return { code, ttlMinutes };
}

type PendingRegistrationRow = {
  id: number;
  email_hash: string;
  email: string;
  token_hash: string;
  nombre: string;
  password_hash: string;
  dni: string | null;
  fecha_nacimiento: Date | string | null;
  localidad: string | null;
  provincia: string | null;
  codigo_invitacion_usado: string | null;
  attempts: number;
  expires_at: Date | string;
  resend_available_at: Date | string | null;
  used_at: Date | string | null;
};

function makePendingRegistrationCode(email: string): { code: string; tokenHash: string; ttlMinutes: number; expiresAt: Date } {
  const ttlMinutes = parseEmailVerificationTtlMinutes();
  const code = makeEmailVerificationCode();
  return {
    code,
    tokenHash: hashEmailVerificationCode(email, code),
    ttlMinutes,
    expiresAt: addSeconds(new Date(), ttlMinutes * 60),
  };
}

function pendingRegistrationPayload(input: {
  email: string;
  emailHash: string;
  nombre: string;
  passwordHash: string;
  dni: string | null;
  fechaNacimiento: string | null;
  localidad: string | null;
  provincia: string | null;
  codigoInvitacion: string | null;
  tokenHash: string;
  expiresAt: Date;
  deviceId: string;
  ip: string;
}) {
  return [
    input.emailHash,
    input.email,
    input.tokenHash,
    input.nombre,
    input.passwordHash,
    input.dni,
    input.fechaNacimiento,
    input.localidad,
    input.provincia,
    input.codigoInvitacion,
    input.deviceId,
    input.ip,
    addSeconds(new Date(), RESEND_VERIFICATION_COOLDOWN_SECONDS),
    input.expiresAt,
  ];
}

async function grantReferralBonusAfterVerification(conn: Queryable, usuarioId: number): Promise<void> {
  // Con el programa de puntos apagado no se otorgan bonos de referido.
  // Early return silencioso: esto corre durante la verificación de email
  // y un error acá rompería la verificación de la cuenta.
  if (!(await isPointsProgramEnabled(conn))) return;

  const invited = await qOne<{
    id: number;
    nombre: string;
    referido_por: number | null;
  }>(conn, "SELECT id, nombre, referido_por FROM usuarios WHERE id = ? FOR UPDATE", [usuarioId]);

  if (!invited?.referido_por) return;

  const existing = await qOne(conn, "SELECT id FROM referidos WHERE invitado_id = ? LIMIT 1", [usuarioId]);
  if (existing) return;

  const inviter = await qOne<{ id: number; nombre: string }>(
    conn,
    "SELECT id, nombre FROM usuarios WHERE id = ? AND activo = 1 FOR UPDATE",
    [invited.referido_por]
  );
  if (!inviter) return;

  const cfgRows = await qOne<any>(conn,
    `SELECT
       MAX(CASE WHEN clave='puntos_referido_invitador' THEN CAST(valor AS UNSIGNED) END) AS inv,
       MAX(CASE WHEN clave='puntos_referido_invitado'  THEN CAST(valor AS UNSIGNED) END) AS nuev
     FROM configuracion
     WHERE clave IN ('puntos_referido_invitador','puntos_referido_invitado')`
  );
  const ptsInv = Number(cfgRows?.inv ?? 50);
  const ptsNuev = Number(cfgRows?.nuev ?? 30);

  const { insertId: refId } = await qRun(conn,
    `INSERT INTO referidos (invitador_id, invitado_id, puntos_invitador, puntos_invitado)
     VALUES (?, ?, ?, ?)`,
    [inviter.id, usuarioId, ptsInv, ptsNuev]
  );

  await registrarMovimientoPuntos(conn, {
    usuarioId: Number(inviter.id),
    tipo: "referido_invitador",
    puntos: ptsInv,
    descripcion: `${invited.nombre} verifico su correo con tu codigo`,
    referenciaId: Number(refId),
    referenciaTipo: "referidos",
  });

  await registrarMovimientoPuntos(conn, {
    usuarioId,
    tipo: "referido_invitado",
    puntos: ptsNuev,
    descripcion: `Bono de bienvenida por codigo de ${inviter.nombre}`,
    referenciaId: Number(refId),
    referenciaTipo: "referidos",
  });
}

function parseBirthDate(raw: string): Date | null {
  const text = (raw || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const dt = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(dt.getTime())) return null;
  const [y, m, d] = text.split("-").map((x) => Number(x));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() + 1 !== m || dt.getUTCDate() !== d) return null;
  return dt;
}

function isAtLeastAge(date: Date, minYears: number): boolean {
  const today = new Date();
  const limit = new Date(Date.UTC(today.getUTCFullYear() - minYears, today.getUTCMonth(), today.getUTCDate()));
  return date.getTime() <= limit.getTime();
}

const registerSchema = z.object({
  nombre: z.string().min(1).max(100),
  email: z.string().email(),
  password: strongPasswordSchema,
  accepted_terms: acceptedTermsSchema,
  dni: z.string().regex(/^\d{6,15}$/, "El DNI debe contener solo numeros (6 a 15 digitos)").optional().nullable(),
  fecha_nacimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha_nacimiento debe tener formato YYYY-MM-DD").optional().nullable(),
  localidad: z.string().min(2).max(120).optional().nullable(),
  provincia: z.string().min(2).max(120).optional().nullable(),
  codigo_invitacion_usado: z.string().optional().nullable(),
});

router.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }
  const { nombre, email, password, dni, fecha_nacimiento, localidad, provincia, codigo_invitacion_usado } = parsed.data;
  const emailNormalized = normalizeEmail(email);
  if (!emailNormalized) {
    res.status(400).json({ error: "Email invalido" });
    return;
  }
  const emailHash = hashIdentifier(emailNormalized);
  const deviceId = getOrCreateDeviceId(req, res);
  const ip = getClientIp(req);
  const codigoInvitacionNormalizado = codigo_invitacion_usado?.trim().toUpperCase() || null;
  const dniNormalized = dni?.trim() || null;
  const fechaNacimiento = fecha_nacimiento?.trim() || null;
  const localidadValue = localidad?.trim() || null;
  const provinciaValue = provincia?.trim() || null;
  if (fechaNacimiento) {
    const birthDate = parseBirthDate(fechaNacimiento);
    if (!birthDate || !isAtLeastAge(birthDate, MINIMUM_ALLOWED_AGE_YEARS)) {
      res.status(400).json({ error: `Debes tener al menos ${MINIMUM_ALLOWED_AGE_YEARS} años para registrarte.` });
      return;
    }
  }

  const allowed = await enforceAuthRateLimit(
    req,
    res,
    {
      action: "register",
      keys: registerLimitKeys({ emailHash, ip, deviceId }),
      progressiveCooldown: true,
    },
    { emailHash, ip, deviceId },
  );
  if (!allowed) return;

  const publicResponse = {
    ok: true,
    email: emailNormalized,
    verification_required: true,
    message: REGISTER_PUBLIC_MESSAGE,
  };

  const existing = dniNormalized
    ? await qOne<{ id: number }>(pool, "SELECT id FROM usuarios WHERE email = ? OR dni = ? LIMIT 1", [emailNormalized, dniNormalized])
    : await qOne<{ id: number }>(pool, "SELECT id FROM usuarios WHERE email = ? LIMIT 1", [emailNormalized]);
  if (existing) {
    res.status(202).json(publicResponse);
    return;
  }

  const longitud = await getInviteCodeLength(pool);
  if (codigoInvitacionNormalizado && !isValidInviteCode(codigoInvitacionNormalizado, longitud)) {
    res.status(400).json({ error: `El codigo de invitacion debe tener ${longitud} caracteres alfanumericos` });
    return;
  }
  if (codigoInvitacionNormalizado) {
    const inv = await qOne(pool, "SELECT id FROM usuarios WHERE codigo_invitacion = ? AND activo = 1 LIMIT 1", [codigoInvitacionNormalizado]);
    if (!inv) {
      res.status(404).json({ error: "Codigo de invitacion invalido" });
      return;
    }
  }

  const pending = await qOne<PendingRegistrationRow>(
    pool,
    "SELECT id, resend_available_at, used_at, expires_at FROM pending_registrations WHERE email_hash = ? LIMIT 1",
    [emailHash],
  );
  if (pending && !pending.used_at && toTime(pending.resend_available_at) > Date.now()) {
    res.status(202).json(publicResponse);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const verificationCode = makePendingRegistrationCode(emailNormalized);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await qRun(
      conn,
      `INSERT INTO pending_registrations
         (email_hash, email, token_hash, nombre, password_hash, dni, fecha_nacimiento, localidad, provincia,
          codigo_invitacion_usado, device_id, ip, resend_available_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         email = VALUES(email),
         token_hash = VALUES(token_hash),
         nombre = VALUES(nombre),
         password_hash = VALUES(password_hash),
         dni = VALUES(dni),
         fecha_nacimiento = VALUES(fecha_nacimiento),
         localidad = VALUES(localidad),
         provincia = VALUES(provincia),
         codigo_invitacion_usado = VALUES(codigo_invitacion_usado),
         device_id = VALUES(device_id),
         ip = VALUES(ip),
         attempts = 0,
         resend_available_at = VALUES(resend_available_at),
         expires_at = VALUES(expires_at),
         used_at = NULL`,
      pendingRegistrationPayload({
        email: emailNormalized,
        emailHash,
        nombre: nombre.trim(),
        passwordHash,
        dni: dniNormalized,
        fechaNacimiento,
        localidad: localidadValue,
        provincia: provinciaValue,
        codigoInvitacion: codigoInvitacionNormalizado,
        tokenHash: verificationCode.tokenHash,
        expiresAt: verificationCode.expiresAt,
        deviceId,
        ip,
      }),
    );

    await conn.commit();

    try {
      await sendEmailVerificationCode({
        to: emailNormalized,
        nombre: nombre.trim(),
        code: verificationCode.code,
        expiresMinutes: verificationCode.ttlMinutes,
      });
    } catch (err) {
      console.error("[AUTH] Error enviando codigo de verificacion:", err);
    }

    res.status(202).json(publicResponse);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

router.post("/resend-email-verification", async (req, res) => {
  const schema = z.object({ email: z.string().email() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Email invalido" });
    return;
  }

  const email = normalizeEmail(parsed.data.email);
  if (!email) {
    res.status(400).json({ error: "Email invalido" });
    return;
  }
  const emailHash = hashIdentifier(email);
  const deviceId = getOrCreateDeviceId(req, res);
  const ip = getClientIp(req);

  const genericResponse = {
    ok: true,
    email,
    message: REGISTER_PUBLIC_MESSAGE,
  };

  const allowed = await enforceAuthRateLimit(
    req,
    res,
    {
      action: "register",
      keys: registerLimitKeys({ emailHash, ip, deviceId }),
      progressiveCooldown: true,
    },
    { emailHash, ip, deviceId },
  );
  if (!allowed) return;

  const conn = await pool.getConnection();
  let verificationCode: { code: string; ttlMinutes: number } | null = null;
  let destinationEmail = email;
  let destinationName = "Usuario";
  let user: { id: number; nombre: string; email: string; email_verificado: number; activo: number } | undefined;
  try {
    await conn.beginTransaction();

    const pending = await qOne<PendingRegistrationRow>(
      conn,
      `SELECT id, email, nombre, resend_available_at, expires_at, used_at
       FROM pending_registrations
       WHERE email_hash = ?
       LIMIT 1
       FOR UPDATE`,
      [emailHash],
    );

    if (pending && !pending.used_at && toTime(pending.expires_at) > Date.now()) {
      if (toTime(pending.resend_available_at) > Date.now()) {
        await conn.commit();
        res.json(genericResponse);
        return;
      }

      const nextCode = makePendingRegistrationCode(email);
      await qRun(
        conn,
        `UPDATE pending_registrations
         SET token_hash = ?, attempts = 0, device_id = ?, ip = ?,
             resend_available_at = ?, expires_at = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          nextCode.tokenHash,
          deviceId,
          ip,
          addSeconds(new Date(), RESEND_VERIFICATION_COOLDOWN_SECONDS),
          nextCode.expiresAt,
          pending.id,
        ],
      );
      verificationCode = { code: nextCode.code, ttlMinutes: nextCode.ttlMinutes };
      destinationEmail = pending.email;
      destinationName = pending.nombre;
      await conn.commit();
    } else {
      user = await qOne(conn,
      "SELECT id, nombre, email, email_verificado, activo FROM usuarios WHERE email = ? FOR UPDATE",
      [email]
      );

      if (!user || !user.activo || user.email_verificado) {
        await conn.commit();
        res.json(genericResponse);
        return;
      }

      verificationCode = await createEmailVerificationCode(conn, {
        usuarioId: user.id,
        email: user.email,
        ip,
        userAgent: req.get("user-agent") ?? null,
      });
      destinationEmail = user.email;
      destinationName = user.nombre;

      await conn.commit();
    }
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  if (verificationCode) {
    try {
      await sendEmailVerificationCode({
        to: destinationEmail,
        nombre: destinationName,
        code: verificationCode.code,
        expiresMinutes: verificationCode.ttlMinutes,
      });
    } catch (err) {
      console.error("[AUTH] Error reenviando codigo de verificacion:", err);
    }
  }

  res.json(genericResponse);
});

async function confirmRegisterWithCode(req: Request, res: Response) {
  const schema = z.object({
    email: z.string().email(),
    code: z.string().regex(/^\d{6}$/, "El codigo debe tener 6 digitos"),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
      return;
  }

  const email = normalizeEmail(parsed.data.email);
  if (!email) {
    res.status(400).json({ error: "Email invalido" });
    return;
  }
  const codeHash = hashEmailVerificationCode(email, parsed.data.code);
  const emailHash = hashIdentifier(email);
  const deviceId = getOrCreateDeviceId(req, res);
  const ip = getClientIp(req);

  const allowed = await enforceAuthRateLimit(
    req,
    res,
    {
      action: "confirm_register",
      keys: confirmRegisterLimitKeys({ tokenHash: codeHash, ip, deviceId }),
      progressiveCooldown: true,
    },
    { emailHash, tokenHash: codeHash, ip, deviceId },
  );
  if (!allowed) return;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const pending = await qOne<PendingRegistrationRow>(
      conn,
      `SELECT id, email_hash, email, token_hash, nombre, password_hash, dni, fecha_nacimiento,
              localidad, provincia, codigo_invitacion_usado, attempts, expires_at, used_at
       FROM pending_registrations
       WHERE email_hash = ?
       LIMIT 1
       FOR UPDATE`,
      [emailHash],
    );

    if (pending && !pending.used_at) {
      const expired = toTime(pending.expires_at) <= Date.now();
      if (expired || Number(pending.attempts ?? 0) >= EMAIL_VERIFICATION_MAX_ATTEMPTS) {
        await conn.rollback();
        res.status(400).json({ error: "Codigo invalido o expirado. Pedi uno nuevo." });
        return;
      }

      if (pending.token_hash !== codeHash) {
        await qRun(conn, "UPDATE pending_registrations SET attempts = attempts + 1 WHERE id = ?", [pending.id]);
        await conn.commit();
        res.status(400).json({ error: "Codigo incorrecto" });
        return;
      }

      const existing = pending.dni
        ? await qOne<{ id: number }>(conn, "SELECT id FROM usuarios WHERE email = ? OR dni = ? LIMIT 1 FOR UPDATE", [pending.email, pending.dni])
        : await qOne<{ id: number }>(conn, "SELECT id FROM usuarios WHERE email = ? LIMIT 1 FOR UPDATE", [pending.email]);
      if (existing) {
        await qRun(conn, "UPDATE pending_registrations SET used_at = NOW() WHERE id = ?", [pending.id]);
        await conn.commit();
        res.status(400).json({ error: "Codigo invalido o expirado. Pedi uno nuevo." });
        return;
      }

      let referidoPor: number | null = null;
      if (pending.codigo_invitacion_usado) {
        const inv = await qOne<{ id: number }>(
          conn,
          "SELECT id FROM usuarios WHERE codigo_invitacion = ? AND activo = 1 LIMIT 1",
          [pending.codigo_invitacion_usado],
        );
        referidoPor = inv?.id ?? null;
      }

      const longitud = await getInviteCodeLength(conn);
      const codigoPropio = await uniqueInviteCode(longitud, conn);
      const { insertId: nuevoId } = await qRun(
        conn,
        `INSERT INTO usuarios
           (nombre, email, email_verificado, email_verificado_at, password_hash, rol, dni, fecha_nacimiento,
            localidad, provincia, codigo_invitacion, referido_por)
         VALUES (?, ?, 1, NOW(), ?, 'cliente', ?, ?, ?, ?, ?, ?)`,
        [
          pending.nombre,
          pending.email,
          pending.password_hash,
          pending.dni,
          pending.fecha_nacimiento,
          pending.localidad,
          pending.provincia,
          codigoPropio,
          referidoPor,
        ],
      );

      await qRun(conn, "UPDATE pending_registrations SET used_at = NOW(), attempts = attempts + 1 WHERE id = ?", [pending.id]);
      await grantReferralBonusAfterVerification(conn, nuevoId);
      await conn.commit();

      const verifiedUser = await qOne<any>(pool,
        `SELECT id, nombre, email, rol, dni, telefono, fecha_nacimiento, localidad, provincia,
                tipo_cliente, descuento_porcentaje,
                puntos_saldo, codigo_invitacion, activo
         FROM usuarios
         WHERE id = ?`,
        [nuevoId]
      );

      const safeUser = publicUser(verifiedUser);
      const token = signToken({ id: safeUser.id, email: safeUser.email, rol: safeUser.rol });
      setAuthCookie(res, token);
      res.json({ user: safeUser, token });
      return;
    }

    const user = await qOne<any>(conn,
      `SELECT id, nombre, email, rol, dni, telefono, fecha_nacimiento, localidad, provincia,
              tipo_cliente, descuento_porcentaje,
              puntos_saldo, codigo_invitacion, email_verificado, activo
       FROM usuarios
       WHERE email = ?
       FOR UPDATE`,
      [email]
    );

    if (!user || !user.activo) {
      await conn.rollback();
      res.status(400).json({ error: "Codigo invalido o expirado" });
      return;
    }

    if (user.email_verificado) {
      await conn.commit();
      const safeUser = publicUser(user);
      const token = signToken({ id: safeUser.id, email: safeUser.email, rol: safeUser.rol });
      setAuthCookie(res, token);
      res.json({ user: safeUser, token });
      return;
    }

    const verification = await qOne<{
      id: number;
      codigo_hash: string;
      expires_at: Date | string;
      attempts: number;
    }>(conn,
      `SELECT id, codigo_hash, expires_at, attempts
       FROM email_verification_codes
       WHERE usuario_id = ? AND used_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [user.id]
    );

    const expired = verification ? new Date(verification.expires_at).getTime() <= Date.now() : true;
    if (!verification || expired || verification.attempts >= EMAIL_VERIFICATION_MAX_ATTEMPTS) {
      await conn.rollback();
      res.status(400).json({ error: "Codigo invalido o expirado. Pedi uno nuevo." });
      return;
    }

    if (verification.codigo_hash !== codeHash) {
      await qRun(conn, "UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = ?", [verification.id]);
      await conn.commit();
      res.status(400).json({ error: "Codigo incorrecto" });
      return;
    }

    await qRun(conn, "UPDATE email_verification_codes SET used_at = NOW() WHERE id = ?", [verification.id]);
    await qRun(conn, "UPDATE usuarios SET email_verificado = 1, email_verificado_at = NOW() WHERE id = ?", [user.id]);
    await grantReferralBonusAfterVerification(conn, user.id);

    await conn.commit();

    const verifiedUser = await qOne<any>(pool,
      `SELECT id, nombre, email, rol, dni, telefono, fecha_nacimiento, localidad, provincia,
              tipo_cliente, descuento_porcentaje,
              puntos_saldo, codigo_invitacion, activo
       FROM usuarios
       WHERE id = ?`,
      [user.id]
    );

    const safeUser = publicUser(verifiedUser);
    const token = signToken({ id: safeUser.id, email: safeUser.email, rol: safeUser.rol });
    setAuthCookie(res, token);
    res.json({ user: safeUser, token });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

router.post("/verify-email", confirmRegisterWithCode);
router.post("/confirm-register", confirmRegisterWithCode);

router.post("/login", async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }
  const { password } = parsed.data;
  const email = normalizeEmail(parsed.data.email);
  if (!email) {
    res.status(400).json({ error: "Email y contrasena requeridos" });
    return;
  }
  const emailHash = hashIdentifier(email);
  const deviceId = getOrCreateDeviceId(req, res);
  const ip = getClientIp(req);
  const sharedLoginKeys = loginLimitKeys({ emailHash, ip, deviceId });

  const allowed = await enforceActiveAuthCooldown(
    req,
    res,
    {
      action: "login",
      keys: sharedLoginKeys,
    },
    { emailHash, ip, deviceId },
  );
  if (!allowed) return;

  const user = await qOne<any>(pool,
    `SELECT id, nombre, email, rol, dni, telefono, fecha_nacimiento, localidad, provincia,
            tipo_cliente, descuento_porcentaje,
            puntos_saldo, codigo_invitacion, password_hash, activo, email_verificado
     FROM usuarios WHERE email = ?`,
    [email]
  );

  if (user?.id) {
    const userLoginKeys = loginUserLimitKeys({ userId: user.id });
    const userAllowed = await enforceActiveAuthCooldown(
      req,
      res,
      {
        action: "login",
        keys: userLoginKeys,
      },
      { userId: user.id, ip, deviceId },
    );
    if (!userAllowed) return;
  }

  const passwordHash = user?.password_hash || DUMMY_PASSWORD_HASH;
  const validPassword = await bcrypt.compare(password, passwordHash);
  if (!user || !validPassword) {
    const sharedAttempt = await checkRateLimit({
      action: "login",
      keys: sharedLoginKeys,
      progressiveCooldown: true,
    });
    if (!sharedAttempt.allowed) {
      reportBlockedAuthRateLimit(req, res, "login", { emailHash, ip, deviceId }, sharedAttempt);
      return;
    }

    if (user?.id) {
      const userAttempt = await checkRateLimit({
        action: "login",
        keys: loginUserLimitKeys({ userId: user.id }),
        progressiveCooldown: true,
      });
      if (!userAttempt.allowed) {
        reportBlockedAuthRateLimit(req, res, "login", { userId: user.id, ip, deviceId }, userAttempt);
        return;
      }
    }

    res.status(401).json({ error: "Credenciales invalidas" });
    return;
  }
  if (!user.activo) {
    res.status(403).json({ error: "Cuenta deshabilitada" });
    return;
  }
  if (!user.email_verificado) {
    res.status(403).json({
      error: "Debes verificar tu correo antes de ingresar",
      verification_required: true,
      email: user.email,
    });
    return;
  }

  const safeUser = publicUser(user);
  const token = signToken({ id: safeUser.id, email: safeUser.email, rol: safeUser.rol });
  setAuthCookie(res, token);
  res.json({ user: safeUser, token });
});

router.post("/google", async (req, res) => {
  const schema = z.object({
    credential: z.string().min(20),
    fecha_nacimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    localidad: z.string().min(2).max(120).optional().nullable(),
    provincia: z.string().min(2).max(120).optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    res.status(503).json({ error: "Login con Google no configurado" });
    return;
  }

  const deviceId = getOrCreateDeviceId(req, res);
  const ip = getClientIp(req);
  const allowed = await enforceAuthRateLimit(
    req,
    res,
    {
      action: "google",
      keys: googleLimitKeys({ ip, deviceId }),
      progressiveCooldown: true,
    },
    { ip, deviceId },
  );
  if (!allowed) return;

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: parsed.data.credential,
      audience: clientId,
    });
    payload = ticket.getPayload();
  } catch {
    res.status(401).json({ error: "No pudimos validar tu cuenta de Google" });
    return;
  }

  const googleId = payload?.sub;
  const email = payload?.email?.toLowerCase().trim();
  const emailVerified = payload?.email_verified;
  const nombre = payload?.name?.trim() || email?.split("@")[0] || "Cliente";

  if (!googleId || !email || !emailVerified) {
    res.status(401).json({ error: "Tu cuenta de Google no tiene un email verificado" });
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let user = await qOne<any>(conn,
       `SELECT id, nombre, email, rol, dni, telefono, fecha_nacimiento, localidad, provincia,
               tipo_cliente, descuento_porcentaje,
               puntos_saldo, codigo_invitacion, google_id, activo, email_verificado
        FROM usuarios WHERE google_id = ?`,
      [googleId]
    );

    if (!user) {
      user = await qOne<any>(conn,
        `SELECT id, nombre, email, rol, dni, telefono, fecha_nacimiento, localidad, provincia,
                tipo_cliente, descuento_porcentaje,
                puntos_saldo, codigo_invitacion, google_id, activo, email_verificado
         FROM usuarios WHERE email = ?`,
        [email]
      );

      if (user?.google_id && user.google_id !== googleId) {
        await conn.rollback();
        res.status(409).json({ error: "Ese email ya esta vinculado a otra cuenta de Google" });
        return;
      }

      if (user && !user.google_id) {
        await qRun(conn,
          "UPDATE usuarios SET google_id = ?, email_verificado = 1, email_verificado_at = COALESCE(email_verificado_at, NOW()) WHERE id = ?",
          [googleId, user.id]
        );
        user.google_id = googleId;
        user.email_verificado = 1;
      }
    }

    if (user && !user.activo) {
      await conn.rollback();
      res.status(403).json({ error: "Cuenta deshabilitada" });
      return;
    }

    if (user && !user.email_verificado) {
      await qRun(conn,
        "UPDATE usuarios SET email_verificado = 1, email_verificado_at = COALESCE(email_verificado_at, NOW()) WHERE id = ?",
        [user.id]
      );
      user.email_verificado = 1;
    }

    if (!user) {
      const fechaNacimiento = parsed.data.fecha_nacimiento?.trim() || null;
      const localidad = parsed.data.localidad?.trim() || null;
      const provincia = parsed.data.provincia?.trim() || null;
      if (fechaNacimiento) {
        const birthDate = parseBirthDate(fechaNacimiento);
        if (!birthDate || !isAtLeastAge(birthDate, MINIMUM_ALLOWED_AGE_YEARS)) {
          await conn.rollback();
          res.status(400).json({ error: `Debes tener al menos ${MINIMUM_ALLOWED_AGE_YEARS} años para registrarte.` });
          return;
        }
      }

      const longitud = await getInviteCodeLength(conn);
      const codigoPropio = await uniqueInviteCode(longitud);
      const hash = await makeRandomPasswordHash();

      const { insertId: nuevoId } = await qRun(conn,
        `INSERT INTO usuarios
           (nombre, email, email_verificado, email_verificado_at, google_id, password_hash, rol, dni, fecha_nacimiento, localidad, provincia, codigo_invitacion)
         VALUES (?, ?, 1, NOW(), ?, ?, 'cliente', NULL, ?, ?, ?, ?)`,
        [nombre, email, googleId, hash, fechaNacimiento, localidad, provincia, codigoPropio]
      );

      user = await qOne<any>(conn,
        `SELECT id, nombre, email, rol, dni, telefono, fecha_nacimiento, localidad, provincia,
                tipo_cliente, descuento_porcentaje,
                puntos_saldo, codigo_invitacion, google_id, activo, email_verificado
         FROM usuarios WHERE id = ?`,
        [nuevoId]
      );
    }

    await conn.commit();

    const safeUser = publicUser(user);
    const token = signToken({ id: safeUser.id, email: safeUser.email, rol: safeUser.rol });
    setAuthCookie(res, token);
    res.json({ user: safeUser, token });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

router.get("/me", async (req, res) => {
  const auth = getAuthPayload(req);
  if (!auth) {
    clearAuthCookie(res);
    res.json({ user: null });
    return;
  }

  // Recalcular saldo antes de devolver los datos (Option A)
  try {
    const conn = await pool.getConnection();
    try {
      const saldoCalculado = await recalcularSaldoPuntosUsuario(conn, auth.id);
      const actualEnDB = await qOne<{ puntos_saldo: number }>(conn, "SELECT puntos_saldo FROM usuarios WHERE id = ?", [auth.id]);
      
      console.log(`[AUTH/ME] Recalculo de puntos`, {
        usuario_id: auth.id,
        saldo_en_usuarios: actualEnDB?.puntos_saldo,
        saldo_calculado_por_movimientos: saldoCalculado,
        iguales: actualEnDB?.puntos_saldo === saldoCalculado
      });
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error(`[AUTH/ME] Error recalculando saldo:`, err);
  }

  const user = await qOne<any>(
    pool,
    `SELECT id, nombre, email, rol, dni, telefono, fecha_nacimiento, localidad, provincia,
            tipo_cliente, descuento_porcentaje,
            puntos_saldo, codigo_invitacion, activo, email_verificado
     FROM usuarios
     WHERE id = ?`,
    [auth.id]
  );

  if (!user || !user.activo || !user.email_verificado) {
    clearAuthCookie(res);
    res.json({ user: null });
    return;
  }

  res.json({ user: publicUser(user) });
});

router.post("/logout", (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.post("/forgot-password", async (req, res) => {
  const schema = z.object({ email: z.string().email() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Email invalido" });
    return;
  }

  const email = normalizeEmail(parsed.data.email);
  if (!email) {
    res.status(400).json({ error: "Email invalido" });
    return;
  }
  const emailHash = hashIdentifier(email);
  const deviceId = getOrCreateDeviceId(req, res);
  const ip = getClientIp(req);
  const resetAllowed = await enforceAuthRateLimit(
    req,
    res,
    {
      action: "password_reset",
      keys: passwordResetLimitKeys({ emailHash, ip, deviceId }),
      progressiveCooldown: true,
    },
    { emailHash, ip, deviceId },
  );
  if (!resetAllowed) return;
  const genericResponse = {
    ok: true,
    message: PASSWORD_RESET_PUBLIC_MESSAGE,
  };

  const user = await qOne<{
    id: number;
    nombre: string;
    email: string;
    activo: number;
    email_verificado: number;
  }>(pool, "SELECT id, nombre, email, activo, email_verificado FROM usuarios WHERE email = ?", [email]);

  if (!user || !user.activo || !user.email_verificado) {
    res.json(genericResponse);
    return;
  }

  const resetUserAllowed = await enforceAuthRateLimit(
    req,
    res,
    {
      action: "password_reset",
      keys: passwordResetUserLimitKeys({ userId: user.id }),
      progressiveCooldown: true,
    },
    { userId: user.id, ip, deviceId },
  );
  if (!resetUserAllowed) return;

  const ttlMinutes = parseResetTtlMinutes();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
  const rawToken = makeResetToken();
  const tokenHash = hashResetToken(rawToken);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await qRun(conn,
      "UPDATE password_reset_tokens SET used_at = NOW() WHERE usuario_id = ? AND used_at IS NULL",
      [user.id]
    );

    await qRun(conn,
      `INSERT INTO password_reset_tokens (usuario_id, token_hash, expires_at, requested_ip, requested_user_agent, device_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [user.id, tokenHash, expiresAt, ip, String(req.get("user-agent") || "").slice(0, 255), deviceId]
    );

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const frontendBase = normalizeResetPasswordUrl();
  const resetLink = `${frontendBase}?token=${encodeURIComponent(rawToken)}`;

  try {
    await sendPasswordResetEmail({
      to: user.email,
      nombre: user.nombre,
      resetLink,
      expiresMinutes: ttlMinutes,
    });
  } catch (err) {
    console.error("[AUTH] Error enviando email de reset:", err);
  }

  res.json(genericResponse);
});

router.post("/reset-password", async (req, res) => {
  const schema = z.object({
    token: z.string().min(40),
    new_password: strongPasswordSchema,
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const { token, new_password } = parsed.data;
  const tokenHash = hashResetToken(token);
  const deviceId = getOrCreateDeviceId(req, res);
  const ip = getClientIp(req);

  const allowed = await enforceAuthRateLimit(
    req,
    res,
    {
      action: "reset_confirm",
      keys: resetConfirmLimitKeys({ tokenHash, ip, deviceId }),
      progressiveCooldown: true,
    },
    { tokenHash, ip, deviceId },
  );
  if (!allowed) return;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const row = await qOne<{
      id: number;
      usuario_id: number;
      expires_at: Date | string;
      used_at: Date | string | null;
      activo: number;
    }>(conn,
      `SELECT pr.id, pr.usuario_id, pr.expires_at, pr.used_at, u.activo
       FROM password_reset_tokens pr
       JOIN usuarios u ON u.id = pr.usuario_id
       WHERE pr.token_hash = ?
       LIMIT 1`,
      [tokenHash]
    );

    if (!row) {
      await conn.rollback();
      res.status(400).json({ error: "Token invalido o expirado" });
      return;
    }

    const expired = new Date(row.expires_at).getTime() <= Date.now();
    if (row.used_at || expired || !row.activo) {
      await conn.rollback();
      res.status(400).json({ error: "Token invalido o expirado" });
      return;
    }

    const newHash = await bcrypt.hash(new_password, 10);
    await qRun(conn, "UPDATE usuarios SET password_hash = ? WHERE id = ?", [newHash, row.usuario_id]);

    await qRun(conn,
      "UPDATE password_reset_tokens SET used_at = NOW() WHERE usuario_id = ? AND used_at IS NULL",
      [row.usuario_id]
    );

    await conn.commit();
    res.json({ ok: true, message: "Contrasena actualizada correctamente" });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

router.post("/change-password", requireAuth, async (req, res) => {
  const schema = z.object({
    current_password: z.string().min(1),
    new_password: strongPasswordSchema,
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const auth = req.user;
  if (!auth) {
    res.status(401).json({ error: "Token requerido" });
    return;
  }

  const deviceId = getOrCreateDeviceId(req, res);
  const ip = getClientIp(req);
  const attemptAllowed = await enforceAuthRateLimit(
    req,
    res,
    {
      action: "password_change_attempt",
      keys: passwordChangeAttemptLimitKeys({ userId: auth.id, ip, deviceId }),
      progressiveCooldown: true,
    },
    { userId: auth.id, ip, deviceId },
  );
  if (!attemptAllowed) return;

  const user = await qOne<{ id: number; password_hash: string; activo: number; email_verificado: number }>(
    pool,
    "SELECT id, password_hash, activo, email_verificado FROM usuarios WHERE id = ? LIMIT 1",
    [auth.id],
  );
  if (!user || !user.activo || !user.email_verificado) {
    clearAuthCookie(res);
    res.status(401).json({ error: "Sesion invalida" });
    return;
  }

  const validPassword = await bcrypt.compare(parsed.data.current_password, user.password_hash);
  if (!validPassword) {
    recordSecurityEvent("password_change_password_actual_invalida", req, {
      userId: auth.id,
      ip,
      deviceId,
    });
    res.status(400).json({ error: "La contrasena actual no es correcta" });
    return;
  }

  const changeAllowed = await enforceAuthRateLimit(
    req,
    res,
    {
      action: "password_change",
      keys: passwordChangeLimitKeys({ userId: auth.id }),
      progressiveCooldown: false,
    },
    { userId: auth.id, ip, deviceId },
  );
  if (!changeAllowed) return;

  const newHash = await bcrypt.hash(parsed.data.new_password, 10);
  await qRun(pool, "UPDATE usuarios SET password_hash = ? WHERE id = ?", [newHash, auth.id]);
  await qRun(pool, "UPDATE password_reset_tokens SET used_at = NOW() WHERE usuario_id = ? AND used_at IS NULL", [auth.id]);

  recordSecurityEvent("password_change_ok", req, {
    userId: auth.id,
    ip,
    deviceId,
  });
  res.json({ ok: true, message: "Contrasena actualizada correctamente" });
});

export default router;
