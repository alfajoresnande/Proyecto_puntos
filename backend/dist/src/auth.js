"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authCookiePolicy = exports.JWT_SECRET = exports.JWT_AUDIENCE = exports.JWT_ISSUER = void 0;
exports.signToken = signToken;
exports.getAuthPayload = getAuthPayload;
exports.verifyToken = verifyToken;
exports.setAuthCookie = setAuthCookie;
exports.clearAuthCookie = clearAuthCookie;
exports.resolveVerifiedUser = resolveVerifiedUser;
exports.getVerifiedUser = getVerifiedUser;
exports.requireAuth = requireAuth;
exports.requireRole = requireRole;
const crypto_1 = require("crypto");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const authCookie_1 = require("./authCookie");
const WEAK_SECRETS = new Set(["dev-secret-cambialo", "cambia-esto-en-produccion"]);
const MIN_SECRET_LENGTH = 64;
const JWT_ALGORITHM = "HS256";
exports.JWT_ISSUER = (process.env.JWT_ISSUER || "nande-puntos-api").trim();
exports.JWT_AUDIENCE = (process.env.JWT_AUDIENCE || "nande-puntos-web").trim();
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
exports.JWT_SECRET = loadJwtSecret();
exports.authCookiePolicy = (0, authCookie_1.resolveCookiePolicy)();
/**
 * En produccion no se arranca con cookies inseguras: una cookie de sesion sin
 * `Secure` viaja en claro y anula todo lo demas (SEC-09).
 */
const problemasCookie = (0, authCookie_1.validarPoliticaCookie)(exports.authCookiePolicy);
if (problemasCookie.length) {
    const detalle = problemasCookie.map((p) => `- ${p.message}`).join("\n");
    throw new Error(`Configuracion de cookies de sesion invalida:\n${detalle}`);
}
/**
 * El token ya NO se acepta por header Authorization desde el navegador.
 * Solo se lee de la cookie HttpOnly, que es lo que el JavaScript de la
 * pagina no puede tocar (SEC-03).
 */
function getTokenFromRequest(req) {
    return (0, authCookie_1.readTokenFromCookies)(req.headers.cookie, exports.authCookiePolicy);
}
/** TTL corto para staff; el cliente mantiene una sesion mas larga. */
function tokenTtl(rol) {
    return rol === "admin" || rol === "superAdmin" || rol === "vendedor" ? "8h" : "7d";
}
function signToken(payload) {
    const { id, rol, email, tv } = payload;
    return jsonwebtoken_1.default.sign({ id, rol, email, tv: tv ?? 0 }, exports.JWT_SECRET, {
        algorithm: JWT_ALGORITHM,
        expiresIn: tokenTtl(rol),
        issuer: exports.JWT_ISSUER,
        audience: exports.JWT_AUDIENCE,
        jwtid: (0, crypto_1.randomUUID)(),
    });
}
/**
 * Verifica firma y claims del JWT. NO comprueba estado en base: para eso esta
 * `requireAuth` / `resolveVerifiedUser`, que consultan rol, activo y
 * token_version actuales.
 */
function getAuthPayload(req) {
    const token = getTokenFromRequest(req);
    if (!token)
        return null;
    return verifyToken(token);
}
function verifyToken(token) {
    try {
        return jsonwebtoken_1.default.verify(token, exports.JWT_SECRET, {
            algorithms: [JWT_ALGORITHM],
            issuer: exports.JWT_ISSUER,
            audience: exports.JWT_AUDIENCE,
        });
    }
    catch {
        return null;
    }
}
function setAuthCookie(res, token) {
    (0, authCookie_1.applyAuthCookie)(res, token, exports.authCookiePolicy);
}
function clearAuthCookie(res) {
    (0, authCookie_1.clearAuthCookies)(res, exports.authCookiePolicy);
}
/**
 * Autenticacion completa: firma valida + cuenta vigente en base.
 *
 * El rol que queda en `req.user` sale SIEMPRE de la base, nunca del JWT: un
 * token viejo de un usuario degradado no puede seguir actuando como admin.
 */
async function resolveVerifiedUser(req) {
    const payload = getAuthPayload(req);
    if (!payload) {
        return { ok: false, status: 401, error: "Token requerido" };
    }
    // Import diferido: sessionRevocation depende de db.ts y db.ts no debe
    // cargarse al importar auth.ts (los tests unitarios lo agradecen).
    const { cargarCuentaVigente, estaRevocadoElJti } = await Promise.resolve().then(() => __importStar(require("./services/sessionRevocation")));
    const cuenta = await cargarCuentaVigente(payload.id);
    if (!cuenta) {
        return { ok: false, status: 401, error: "Sesion invalida" };
    }
    if (!cuenta.activo) {
        return { ok: false, status: 403, error: "Cuenta deshabilitada" };
    }
    if (Number(payload.tv ?? 0) !== cuenta.tokenVersion) {
        return { ok: false, status: 401, error: "Sesion expirada. Inicia sesion nuevamente." };
    }
    if (payload.jti && (await estaRevocadoElJti(payload.jti))) {
        return { ok: false, status: 401, error: "Sesion cerrada" };
    }
    return {
        ok: true,
        user: {
            id: cuenta.id,
            email: cuenta.email,
            rol: cuenta.rol,
            tv: cuenta.tokenVersion,
            jti: payload.jti,
            exp: payload.exp,
        },
    };
}
/**
 * Version opcional: devuelve el usuario verificado o null, sin responder.
 * Para rutas publicas que ajustan su salida si hay sesion.
 */
async function getVerifiedUser(req) {
    const resultado = await resolveVerifiedUser(req);
    return resultado.ok ? resultado.user : null;
}
async function requireAuth(req, res, next) {
    const resultado = await resolveVerifiedUser(req);
    if (!resultado.ok) {
        if (resultado.status === 401)
            clearAuthCookie(res);
        return res.status(resultado.status).json({ error: resultado.error });
    }
    req.user = resultado.user;
    next();
}
function requireRole(...roles) {
    return (req, res, next) => {
        const currentRole = req.user?.rol;
        if (!currentRole) {
            return res.status(403).json({ error: "No autorizado" });
        }
        if (roles.includes(currentRole)) {
            next();
            return;
        }
        const inheritedRoles = {
            admin: ["vendedor"],
            superAdmin: ["admin", "vendedor"],
        };
        const impliedRoles = inheritedRoles[currentRole] ?? [];
        if (roles.some((role) => impliedRoles.includes(role))) {
            next();
            return;
        }
        return res.status(403).json({ error: "No autorizado" });
    };
}
