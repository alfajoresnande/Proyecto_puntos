"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JWT_SECRET = void 0;
exports.signToken = signToken;
exports.getAuthPayload = getAuthPayload;
exports.setAuthCookie = setAuthCookie;
exports.clearAuthCookie = clearAuthCookie;
exports.requireAuth = requireAuth;
exports.requireRole = requireRole;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const WEAK_SECRETS = new Set(["dev-secret-cambialo", "cambia-esto-en-produccion"]);
const MIN_SECRET_LENGTH = 64;
const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || "auth_token";
function loadJwtSecret() {
    const value = process.env.JWT_SECRET;
    if (!value) {
        throw new Error("JWT_SECRET no configurado. Genera uno con: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\" y pegalo en backend/.env");
    }
    if (WEAK_SECRETS.has(value)) {
        throw new Error("JWT_SECRET usa un valor por defecto conocido. Reemplazalo en backend/.env por un secret aleatorio.");
    }
    if (value.length < MIN_SECRET_LENGTH) {
        throw new Error(`JWT_SECRET demasiado corto (${value.length}). Minimo ${MIN_SECRET_LENGTH} caracteres.`);
    }
    return value;
}
function normalizeSameSite(raw) {
    const value = (raw || "lax").trim().toLowerCase();
    if (value === "strict" || value === "none")
        return value;
    return "lax";
}
function shouldUseSecureCookies() {
    const raw = process.env.AUTH_COOKIE_SECURE;
    if (raw !== undefined) {
        return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
    }
    return process.env.NODE_ENV === "production";
}
function parseCookieHeader(header) {
    if (!header)
        return {};
    const pairs = header.split(";");
    const out = {};
    for (const pair of pairs) {
        const idx = pair.indexOf("=");
        if (idx <= 0)
            continue;
        const key = pair.slice(0, idx).trim();
        if (!key)
            continue;
        const rawValue = pair.slice(idx + 1).trim();
        try {
            out[key] = decodeURIComponent(rawValue);
        }
        catch {
            out[key] = rawValue;
        }
    }
    return out;
}
function getTokenFromRequest(req) {
    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ")) {
        return header.slice(7);
    }
    const cookies = parseCookieHeader(req.headers.cookie);
    return cookies[AUTH_COOKIE_NAME] || null;
}
exports.JWT_SECRET = loadJwtSecret();
function signToken(payload) {
    const expiresIn = payload.rol === "admin" || payload.rol === "vendedor" ? "1d" : "7d";
    return jsonwebtoken_1.default.sign(payload, exports.JWT_SECRET, { expiresIn });
}
function getAuthPayload(req) {
    const token = getTokenFromRequest(req);
    if (!token)
        return null;
    try {
        return jsonwebtoken_1.default.verify(token, exports.JWT_SECRET);
    }
    catch {
        return null;
    }
}
function setAuthCookie(res, token) {
    const sameSite = normalizeSameSite(process.env.AUTH_COOKIE_SAMESITE);
    const secure = shouldUseSecureCookies();
    const maxAgeMs = process.env.AUTH_COOKIE_MAX_AGE_MS ? Number(process.env.AUTH_COOKIE_MAX_AGE_MS) : 7 * 24 * 60 * 60 * 1000;
    res.cookie(AUTH_COOKIE_NAME, token, {
        httpOnly: true,
        secure,
        sameSite,
        path: "/",
        maxAge: Number.isFinite(maxAgeMs) ? maxAgeMs : 24 * 60 * 60 * 1000,
    });
}
function clearAuthCookie(res) {
    const sameSite = normalizeSameSite(process.env.AUTH_COOKIE_SAMESITE);
    const secure = shouldUseSecureCookies();
    res.clearCookie(AUTH_COOKIE_NAME, {
        httpOnly: true,
        secure,
        sameSite,
        path: "/",
    });
}
function requireAuth(req, res, next) {
    const payload = getAuthPayload(req);
    if (!payload) {
        return res.status(401).json({ error: "Token requerido" });
    }
    req.user = payload;
    next();
}
function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.rol)) {
            return res.status(403).json({ error: "No autorizado" });
        }
        next();
    };
}
