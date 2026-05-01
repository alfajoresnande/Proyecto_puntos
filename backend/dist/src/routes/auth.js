"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const google_auth_library_1 = require("google-auth-library");
const zod_1 = require("zod");
const db_1 = require("../db");
const auth_1 = require("../auth");
const email_1 = require("../services/email");
const router = (0, express_1.Router)();
const googleClient = new google_auth_library_1.OAuth2Client();
const DEFAULT_INVITE_CODE_LENGTH = 9;
const MIN_INVITE_CODE_LENGTH = 6;
const MAX_INVITE_CODE_LENGTH = 20;
const DUMMY_PASSWORD_HASH = bcryptjs_1.default.hashSync(crypto_1.default.randomBytes(24).toString("hex"), 10);
// Política:
// - Mínimo 12 caracteres (priorizamos longitud sobre "complejidad" artificial).
// - Al menos una letra y un número (filtro mínimo contra "aaaaaaaaaaaa" y "123456789012").
// - Máximo 128 para frenar DoS por hashing bcrypt.
const strongPasswordSchema = zod_1.z
    .string()
    .min(12, "La contrasena debe tener al menos 12 caracteres")
    .max(128, "La contrasena no puede superar 128 caracteres")
    .regex(/[A-Za-z]/, "La contrasena debe incluir al menos una letra")
    .regex(/\d/, "La contrasena debe incluir al menos un numero");
function makeCode(length) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from({ length }, () => chars[crypto_1.default.randomInt(chars.length)]).join("");
}
async function uniqueInviteCode(length) {
    while (true) {
        const code = makeCode(length);
        const exists = await (0, db_1.qOne)(db_1.pool, "SELECT id FROM usuarios WHERE codigo_invitacion = ?", [code]);
        if (!exists)
            return code;
    }
}
function hashResetToken(rawToken) {
    return crypto_1.default.createHash("sha256").update(rawToken).digest("hex");
}
function makeResetToken() {
    return crypto_1.default.randomBytes(32).toString("hex");
}
function parseResetTtlMinutes() {
    const raw = Number(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES ?? 60);
    if (Number.isNaN(raw))
        return 60;
    return Math.max(10, Math.min(raw, 180));
}
function normalizeResetPasswordUrl() {
    const explicitUrl = process.env.FRONTEND_RESET_PASSWORD_URL?.trim();
    if (explicitUrl)
        return explicitUrl.replace(/\/+$/, "");
    const frontendUrl = process.env.FRONTEND_URL
        ?.split(",")
        .map((item) => item.trim())
        .find(Boolean);
    const baseUrl = frontendUrl || "http://localhost:5173";
    return `${baseUrl.replace(/\/+$/, "")}/reset-password`;
}
function makeRandomPasswordHash() {
    return bcryptjs_1.default.hash(crypto_1.default.randomBytes(32).toString("hex"), 10);
}
async function getInviteCodeLength(conn = db_1.pool) {
    const row = await (0, db_1.qOne)(conn, "SELECT valor FROM configuracion WHERE clave = 'longitud_codigo_invitacion' LIMIT 1");
    const parsed = Number(row?.valor ?? DEFAULT_INVITE_CODE_LENGTH);
    if (!Number.isInteger(parsed))
        return DEFAULT_INVITE_CODE_LENGTH;
    return Math.max(MIN_INVITE_CODE_LENGTH, Math.min(MAX_INVITE_CODE_LENGTH, parsed));
}
function isValidInviteCode(code, length) {
    return new RegExp(`^[A-Z0-9]{${length}}$`).test(code);
}
function publicUser(user) {
    const { password_hash, activo, google_id, ...safeUser } = user;
    return safeUser;
}
const registerSchema = zod_1.z.object({
    nombre: zod_1.z.string().min(1).max(100),
    email: zod_1.z.string().email(),
    password: strongPasswordSchema,
    dni: zod_1.z.string().regex(/^\d{6,15}$/, "El DNI debe contener solo numeros (6 a 15 digitos)"),
    codigo_invitacion_usado: zod_1.z.string().optional().nullable(),
});
router.post("/register", async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0].message });
        return;
    }
    const { nombre, email, password, dni, codigo_invitacion_usado } = parsed.data;
    const codigoInvitacionNormalizado = codigo_invitacion_usado?.trim().toUpperCase() || null;
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        const dup = await (0, db_1.qOne)(conn, "SELECT id FROM usuarios WHERE email = ? OR dni = ?", [email, dni]);
        if (dup) {
            res.status(409).json({ error: "El email o DNI ya esta registrado" });
            return;
        }
        const longitud = await getInviteCodeLength(conn);
        if (codigoInvitacionNormalizado && !isValidInviteCode(codigoInvitacionNormalizado, longitud)) {
            await conn.rollback();
            res.status(400).json({ error: `El codigo de invitacion debe tener ${longitud} caracteres alfanumericos` });
            return;
        }
        const codigoPropio = await uniqueInviteCode(longitud);
        const hash = await bcryptjs_1.default.hash(password, 10);
        let referidoPor = null;
        let invitador = null;
        if (codigoInvitacionNormalizado) {
            const inv = await (0, db_1.qOne)(conn, "SELECT id, nombre FROM usuarios WHERE codigo_invitacion = ? AND activo = 1", [codigoInvitacionNormalizado]);
            if (inv) {
                invitador = inv;
                referidoPor = inv.id;
            }
            else {
                await conn.rollback();
                res.status(404).json({ error: "Codigo de invitacion invalido" });
                return;
            }
        }
        const { insertId: nuevoId } = await (0, db_1.qRun)(conn, `INSERT INTO usuarios (nombre, email, password_hash, rol, dni, codigo_invitacion, referido_por)
       VALUES (?, ?, ?, 'cliente', ?, ?, ?)`, [nombre, email, hash, dni, codigoPropio, referidoPor]);
        if (invitador) {
            const cfgRows = await (0, db_1.qOne)(conn, `SELECT
           MAX(CASE WHEN clave='puntos_referido_invitador' THEN CAST(valor AS UNSIGNED) END) AS inv,
           MAX(CASE WHEN clave='puntos_referido_invitado'  THEN CAST(valor AS UNSIGNED) END) AS nuev
         FROM configuracion
         WHERE clave IN ('puntos_referido_invitador','puntos_referido_invitado')`);
            const ptsInv = Number(cfgRows?.inv ?? 50);
            const ptsNuev = Number(cfgRows?.nuev ?? 30);
            const { insertId: refId } = await (0, db_1.qRun)(conn, `INSERT INTO referidos (invitador_id, invitado_id, puntos_invitador, puntos_invitado)
         VALUES (?, ?, ?, ?)`, [invitador.id, nuevoId, ptsInv, ptsNuev]);
            await (0, db_1.qRun)(conn, `INSERT INTO movimientos_puntos (usuario_id, tipo, puntos, descripcion, referencia_id, referencia_tipo)
         VALUES (?, 'referido_invitador', ?, ?, ?, 'referidos')`, [invitador.id, ptsInv, `${nombre} se registro con tu codigo`, refId]);
            await (0, db_1.qRun)(conn, "UPDATE usuarios SET puntos_saldo = puntos_saldo + ? WHERE id = ?", [ptsInv, invitador.id]);
            await (0, db_1.qRun)(conn, `INSERT INTO movimientos_puntos (usuario_id, tipo, puntos, descripcion, referencia_id, referencia_tipo)
         VALUES (?, 'referido_invitado', ?, ?, ?, 'referidos')`, [nuevoId, ptsNuev, `Bono de bienvenida por codigo de ${invitador.nombre}`, refId]);
            await (0, db_1.qRun)(conn, "UPDATE usuarios SET puntos_saldo = puntos_saldo + ? WHERE id = ?", [ptsNuev, nuevoId]);
        }
        await conn.commit();
        const u = await (0, db_1.qOne)(conn, "SELECT id, nombre, email, rol, dni, telefono, puntos_saldo, codigo_invitacion FROM usuarios WHERE id = ?", [nuevoId]);
        const token = (0, auth_1.signToken)({ id: u.id, email: u.email, rol: u.rol });
        (0, auth_1.setAuthCookie)(res, token);
        res.status(201).json({ user: u, token });
    }
    catch (err) {
        await conn.rollback();
        throw err;
    }
    finally {
        conn.release();
    }
});
router.post("/login", async (req, res) => {
    const schema = zod_1.z.object({ email: zod_1.z.string().email(), password: zod_1.z.string().min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: "Email y contrasena requeridos" });
        return;
    }
    const { email, password } = parsed.data;
    const user = await (0, db_1.qOne)(db_1.pool, `SELECT id, nombre, email, rol, dni, telefono, puntos_saldo, codigo_invitacion, password_hash, activo
     FROM usuarios WHERE email = ?`, [email]);
    const passwordHash = user?.password_hash || DUMMY_PASSWORD_HASH;
    const validPassword = await bcryptjs_1.default.compare(password, passwordHash);
    if (!user || !validPassword) {
        res.status(401).json({ error: "Credenciales invalidas" });
        return;
    }
    if (!user.activo) {
        res.status(403).json({ error: "Cuenta deshabilitada" });
        return;
    }
    const safeUser = publicUser(user);
    const token = (0, auth_1.signToken)({ id: safeUser.id, email: safeUser.email, rol: safeUser.rol });
    (0, auth_1.setAuthCookie)(res, token);
    res.json({ user: safeUser, token });
});
router.post("/google", async (req, res) => {
    const schema = zod_1.z.object({ credential: zod_1.z.string().min(20) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: "Token de Google requerido" });
        return;
    }
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
        res.status(503).json({ error: "Login con Google no configurado" });
        return;
    }
    let payload;
    try {
        const ticket = await googleClient.verifyIdToken({
            idToken: parsed.data.credential,
            audience: clientId,
        });
        payload = ticket.getPayload();
    }
    catch {
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
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        let user = await (0, db_1.qOne)(conn, `SELECT id, nombre, email, rol, dni, telefono, puntos_saldo, codigo_invitacion, google_id, activo
       FROM usuarios WHERE google_id = ?`, [googleId]);
        if (!user) {
            user = await (0, db_1.qOne)(conn, `SELECT id, nombre, email, rol, dni, telefono, puntos_saldo, codigo_invitacion, google_id, activo
         FROM usuarios WHERE email = ?`, [email]);
            if (user?.google_id && user.google_id !== googleId) {
                await conn.rollback();
                res.status(409).json({ error: "Ese email ya esta vinculado a otra cuenta de Google" });
                return;
            }
            if (user && !user.google_id) {
                await (0, db_1.qRun)(conn, "UPDATE usuarios SET google_id = ? WHERE id = ?", [googleId, user.id]);
                user.google_id = googleId;
            }
        }
        if (user && !user.activo) {
            await conn.rollback();
            res.status(403).json({ error: "Cuenta deshabilitada" });
            return;
        }
        if (!user) {
            const longitud = await getInviteCodeLength(conn);
            const codigoPropio = await uniqueInviteCode(longitud);
            const hash = await makeRandomPasswordHash();
            const { insertId: nuevoId } = await (0, db_1.qRun)(conn, `INSERT INTO usuarios (nombre, email, google_id, password_hash, rol, dni, codigo_invitacion)
         VALUES (?, ?, ?, ?, 'cliente', NULL, ?)`, [nombre, email, googleId, hash, codigoPropio]);
            user = await (0, db_1.qOne)(conn, `SELECT id, nombre, email, rol, dni, telefono, puntos_saldo, codigo_invitacion, google_id, activo
         FROM usuarios WHERE id = ?`, [nuevoId]);
        }
        await conn.commit();
        const safeUser = publicUser(user);
        const token = (0, auth_1.signToken)({ id: safeUser.id, email: safeUser.email, rol: safeUser.rol });
        (0, auth_1.setAuthCookie)(res, token);
        res.json({ user: safeUser, token });
    }
    catch (err) {
        await conn.rollback();
        throw err;
    }
    finally {
        conn.release();
    }
});
router.get("/me", async (req, res) => {
    const auth = (0, auth_1.getAuthPayload)(req);
    if (!auth) {
        (0, auth_1.clearAuthCookie)(res);
        res.json({ user: null });
        return;
    }
    const user = await (0, db_1.qOne)(db_1.pool, `SELECT id, nombre, email, rol, dni, telefono, puntos_saldo, codigo_invitacion, activo
     FROM usuarios
     WHERE id = ?`, [auth.id]);
    if (!user || !user.activo) {
        (0, auth_1.clearAuthCookie)(res);
        res.json({ user: null });
        return;
    }
    res.json({ user: publicUser(user) });
});
router.post("/logout", (_req, res) => {
    (0, auth_1.clearAuthCookie)(res);
    res.json({ ok: true });
});
router.post("/forgot-password", async (req, res) => {
    const schema = zod_1.z.object({ email: zod_1.z.string().email() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: "Email invalido" });
        return;
    }
    const email = parsed.data.email.toLowerCase().trim();
    const genericResponse = {
        ok: true,
        message: "Te enviamos un mail de recuperación.",
    };
    const user = await (0, db_1.qOne)(db_1.pool, "SELECT id, nombre, email, activo FROM usuarios WHERE email = ?", [email]);
    if (!user || !user.activo) {
        res.json(genericResponse);
        return;
    }
    const ttlMinutes = parseResetTtlMinutes();
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
    const rawToken = makeResetToken();
    const tokenHash = hashResetToken(rawToken);
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        await (0, db_1.qRun)(conn, "UPDATE password_reset_tokens SET used_at = NOW() WHERE usuario_id = ? AND used_at IS NULL", [user.id]);
        await (0, db_1.qRun)(conn, `INSERT INTO password_reset_tokens (usuario_id, token_hash, expires_at, requested_ip, requested_user_agent)
       VALUES (?, ?, ?, ?, ?)`, [user.id, tokenHash, expiresAt, req.ip ?? null, String(req.get("user-agent") || "").slice(0, 255)]);
        await conn.commit();
    }
    catch (err) {
        await conn.rollback();
        throw err;
    }
    finally {
        conn.release();
    }
    const frontendBase = normalizeResetPasswordUrl();
    const resetLink = `${frontendBase}?token=${encodeURIComponent(rawToken)}`;
    try {
        await (0, email_1.sendPasswordResetEmail)({
            to: user.email,
            nombre: user.nombre,
            resetLink,
            expiresMinutes: ttlMinutes,
        });
    }
    catch (err) {
        console.error("[AUTH] Error enviando email de reset:", err);
    }
    res.json(genericResponse);
});
router.post("/reset-password", async (req, res) => {
    const schema = zod_1.z.object({
        token: zod_1.z.string().min(40),
        new_password: strongPasswordSchema,
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0].message });
        return;
    }
    const { token, new_password } = parsed.data;
    const tokenHash = hashResetToken(token);
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        const row = await (0, db_1.qOne)(conn, `SELECT pr.id, pr.usuario_id, pr.expires_at, pr.used_at, u.activo
       FROM password_reset_tokens pr
       JOIN usuarios u ON u.id = pr.usuario_id
       WHERE pr.token_hash = ?
       LIMIT 1`, [tokenHash]);
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
        const newHash = await bcryptjs_1.default.hash(new_password, 10);
        await (0, db_1.qRun)(conn, "UPDATE usuarios SET password_hash = ? WHERE id = ?", [newHash, row.usuario_id]);
        await (0, db_1.qRun)(conn, "UPDATE password_reset_tokens SET used_at = NOW() WHERE usuario_id = ? AND used_at IS NULL", [row.usuario_id]);
        await conn.commit();
        res.json({ ok: true, message: "Contrasena actualizada correctamente" });
    }
    catch (err) {
        await conn.rollback();
        throw err;
    }
    finally {
        conn.release();
    }
});
exports.default = router;
