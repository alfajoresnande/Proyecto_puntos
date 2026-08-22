"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CSRF_HEADER_NAME = exports.CSRF_COOKIE_NAME = void 0;
exports.csrfSessionBinding = csrfSessionBinding;
exports.emitCsrfToken = emitCsrfToken;
exports.verifyCsrfToken = verifyCsrfToken;
exports.setCsrfCookie = setCsrfCookie;
exports.readCsrfCookie = readCsrfCookie;
const crypto_1 = require("crypto");
/**
 * CSRF: double-submit cookie FIRMADA con HMAC y ligada a la sesion (SEC-07).
 *
 * El control anterior solo medía que el header `x-csrf-token` tuviera 16
 * caracteres, asi que `0123456789abcdef` pasaba. Aca el servidor emite el
 * token, lo firma y comprueba que:
 *
 *   1. el header y la cookie `csrf_token` coincidan (double submit);
 *   2. la firma HMAC sea nuestra (nadie puede fabricar un token);
 *   3. el token este atado al `sid` de la sesion actual, de modo que un token
 *      valido de otra sesion no sirve;
 *   4. no haya vencido.
 *
 * Formato del token: `<nonce>.<expEpochSeconds>.<hmac>`
 */
exports.CSRF_COOKIE_NAME = "csrf_token";
exports.CSRF_HEADER_NAME = "x-csrf-token";
const TOKEN_TTL_SECONDS = 12 * 60 * 60;
const NONCE_BYTES = 18;
function hmac(secret, data) {
    return (0, crypto_1.createHmac)("sha256", secret).update(data).digest("hex");
}
function safeEqual(a, b) {
    const left = Buffer.from(a, "utf8");
    const right = Buffer.from(b, "utf8");
    if (left.length !== right.length || left.length === 0)
        return false;
    return (0, crypto_1.timingSafeEqual)(left, right);
}
/**
 * Identificador de sesion al que se ata el token. Para una sesion iniciada es
 * un hash del JWT de la cookie; para un visitante anonimo se usa un valor
 * estable ("anon") porque no hay sesion que suplantar todavia.
 */
function csrfSessionBinding(sessionToken, secret) {
    if (!sessionToken)
        return "anon";
    return hmac(secret, `csrf-binding:${sessionToken}`).slice(0, 32);
}
function emitCsrfToken(binding, deps) {
    const nonce = (0, crypto_1.randomBytes)(NONCE_BYTES).toString("base64url");
    const exp = Math.floor((deps.nowMs ?? Date.now()) / 1000) + TOKEN_TTL_SECONDS;
    const signature = hmac(deps.secret, `${nonce}.${exp}.${binding}`);
    return `${nonce}.${exp}.${signature}`;
}
function verifyCsrfToken(headerToken, cookieToken, binding, deps) {
    const header = (headerToken || "").trim();
    const cookie = (cookieToken || "").trim();
    if (!header)
        return { ok: false, reason: "token_ausente" };
    if (!cookie)
        return { ok: false, reason: "cookie_ausente" };
    if (!safeEqual(header, cookie))
        return { ok: false, reason: "no_coinciden" };
    const parts = header.split(".");
    if (parts.length !== 3)
        return { ok: false, reason: "formato_invalido" };
    const [nonce, expRaw, signature] = parts;
    const exp = Number(expRaw);
    if (!Number.isFinite(exp) || exp <= 0)
        return { ok: false, reason: "formato_invalido" };
    if (exp * 1000 < (deps.nowMs ?? Date.now()))
        return { ok: false, reason: "vencido" };
    const expected = hmac(deps.secret, `${nonce}.${exp}.${binding}`);
    if (!safeEqual(expected, signature))
        return { ok: false, reason: "firma_invalida" };
    return { ok: true };
}
/**
 * La cookie del double-submit NO es HttpOnly a proposito: el frontend tiene
 * que poder leerla para reenviarla en el header. Lo que la protege es la firma
 * HMAC y el vinculo con la sesion, no el secreto de su valor.
 */
function setCsrfCookie(res, token, options) {
    res.cookie(exports.CSRF_COOKIE_NAME, token, {
        httpOnly: false,
        secure: options.secure,
        sameSite: options.sameSite,
        path: "/",
        maxAge: TOKEN_TTL_SECONDS * 1000,
    });
}
function readCsrfCookie(req) {
    const header = req.headers.cookie;
    if (!header)
        return null;
    for (const part of header.split(";")) {
        const separator = part.indexOf("=");
        if (separator <= 0)
            continue;
        if (part.slice(0, separator).trim() !== exports.CSRF_COOKIE_NAME)
            continue;
        const value = part.slice(separator + 1).trim();
        try {
            return decodeURIComponent(value);
        }
        catch {
            return value;
        }
    }
    return null;
}
