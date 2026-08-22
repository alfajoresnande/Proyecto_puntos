"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LEGACY_COOKIE_NAME = exports.HOST_PREFIXED_COOKIE_NAME = void 0;
exports.normalizeSameSite = normalizeSameSite;
exports.parseBooleanEnv = parseBooleanEnv;
exports.resolveCookiePolicy = resolveCookiePolicy;
exports.validarPoliticaCookie = validarPoliticaCookie;
exports.applyAuthCookie = applyAuthCookie;
exports.clearAuthCookies = clearAuthCookies;
exports.parseCookieHeader = parseCookieHeader;
exports.readTokenFromCookies = readTokenFromCookies;
/**
 * Politica de la cookie de sesion (SEC-03 / SEC-09).
 *
 * Modulo aparte de auth.ts para poder testear la politica sin arrastrar
 * jsonwebtoken ni la carga del JWT_SECRET.
 */
exports.HOST_PREFIXED_COOKIE_NAME = "__Host-auth_token";
exports.LEGACY_COOKIE_NAME = "auth_token";
function normalizeSameSite(raw) {
    const value = (raw || "lax").trim().toLowerCase();
    if (value === "strict" || value === "none")
        return value;
    return "lax";
}
function parseBooleanEnv(raw) {
    if (raw === undefined)
        return null;
    const value = raw.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(value))
        return true;
    if (["0", "false", "no", "off"].includes(value))
        return false;
    return null;
}
/**
 * Resuelve la politica de cookie. Funcion pura sobre el entorno recibido.
 *
 * - `Secure` es obligatorio en produccion (se valida aparte, ver
 *   `validarPoliticaCookie`).
 * - El prefijo `__Host-` solo se usa cuando la cookie es `Secure`: los
 *   navegadores descartan una cookie `__Host-` sin `Secure`, y en desarrollo
 *   sobre http eso dejaria la sesion rota.
 */
function resolveCookiePolicy(env = process.env) {
    const isProduction = (env.NODE_ENV || "").trim().toLowerCase() === "production";
    const secureOverride = parseBooleanEnv(env.AUTH_COOKIE_SECURE);
    const secure = secureOverride ?? isProduction;
    const sameSite = normalizeSameSite(env.AUTH_COOKIE_SAMESITE);
    // AUTH_COOKIE_NAME sigue soportado para no romper despliegues que lo tengan
    // definido, pero el default pasa a ser el nombre con prefijo __Host-.
    const explicitName = (env.AUTH_COOKIE_NAME || "").trim();
    const name = explicitName || (secure ? exports.HOST_PREFIXED_COOKIE_NAME : exports.LEGACY_COOKIE_NAME);
    const readCandidates = Array.from(new Set([name, exports.HOST_PREFIXED_COOKIE_NAME, exports.LEGACY_COOKIE_NAME].filter(Boolean)));
    return { name, secure, sameSite, path: "/", httpOnly: true, readCandidates };
}
/**
 * Comprobaciones que deben abortar el arranque en produccion.
 */
function validarPoliticaCookie(policy, env = process.env) {
    const isProduction = (env.NODE_ENV || "").trim().toLowerCase() === "production";
    const problemas = [];
    if (isProduction && !policy.secure) {
        problemas.push({
            code: "cookie_insegura_en_produccion",
            message: "AUTH_COOKIE_SECURE=false en produccion: la cookie de sesion viajaria en claro. " +
                "Configura AUTH_COOKIE_SECURE=true (o quita la variable) antes de arrancar.",
        });
    }
    // Los navegadores descartan SameSite=None sin Secure.
    if (policy.sameSite === "none" && !policy.secure) {
        problemas.push({
            code: "samesite_none_sin_secure",
            message: "AUTH_COOKIE_SAMESITE=none exige AUTH_COOKIE_SECURE=true; el navegador descartaria la cookie.",
        });
    }
    // El prefijo __Host- exige Secure y Path=/ sin Domain.
    if (policy.name.startsWith("__Host-") && !policy.secure) {
        problemas.push({
            code: "host_prefix_sin_secure",
            message: "El prefijo __Host- exige Secure. Configura AUTH_COOKIE_SECURE=true o cambia AUTH_COOKIE_NAME.",
        });
    }
    return problemas;
}
function maxAgeMs(env) {
    const raw = Number(env.AUTH_COOKIE_MAX_AGE_MS);
    if (Number.isFinite(raw) && raw > 0)
        return raw;
    return 7 * 24 * 60 * 60 * 1000;
}
function applyAuthCookie(res, token, policy) {
    res.cookie(policy.name, token, {
        httpOnly: true,
        secure: policy.secure,
        sameSite: policy.sameSite,
        path: "/",
        // Sin `domain`: la cookie queda host-only, requisito de __Host-.
        maxAge: maxAgeMs(process.env),
    });
}
/**
 * Limpia todos los nombres candidatos, no solo el vigente: si un navegador
 * arrastra el `auth_token` viejo, tiene que irse tambien.
 */
function clearAuthCookies(res, policy) {
    for (const name of policy.readCandidates) {
        res.clearCookie(name, {
            httpOnly: true,
            secure: name.startsWith("__Host-") ? true : policy.secure,
            sameSite: policy.sameSite,
            path: "/",
        });
    }
}
function parseCookieHeader(header) {
    const raw = Array.isArray(header) ? header.join(";") : header;
    if (!raw)
        return {};
    const out = {};
    for (const part of raw.split(";")) {
        const separator = part.indexOf("=");
        if (separator <= 0)
            continue;
        const name = part.slice(0, separator).trim();
        if (!name)
            continue;
        const value = part.slice(separator + 1).trim();
        try {
            out[name] = decodeURIComponent(value);
        }
        catch {
            out[name] = value;
        }
    }
    return out;
}
function readTokenFromCookies(header, policy) {
    const cookies = parseCookieHeader(header);
    for (const name of policy.readCandidates) {
        const value = cookies[name];
        if (value)
            return value;
    }
    return null;
}
