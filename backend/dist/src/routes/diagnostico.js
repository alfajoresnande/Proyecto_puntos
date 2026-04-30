"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = require("crypto");
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const auth_1 = require("../auth");
const db_1 = require("../db");
const securityMonitor_1 = require("../securityMonitor");
const router = (0, express_1.Router)();
const DEFAULT_DB_TIMEOUT_MS = 1500;
const ALLOWED_ROLES = new Set(["cliente", "vendedor", "admin"]);
const accessDeniedLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: 40,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Demasiadas solicitudes" },
});
function isEnabled(raw) {
    if (!raw)
        return false;
    return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}
function secureEquals(value, expected) {
    const current = Buffer.from(value);
    const target = Buffer.from(expected);
    if (current.length !== target.length)
        return false;
    return (0, crypto_1.timingSafeEqual)(current, target);
}
function hasDiagnosticsAccess(req) {
    // Por defecto el diagnostico es publico para facilitar puesta en marcha.
    // Si queres protegerlo, define DIAGNOSTICO_REQUIRE_AUTH=true.
    if (!isEnabled(process.env.DIAGNOSTICO_REQUIRE_AUTH))
        return true;
    if (isEnabled(process.env.DIAGNOSTICO_PUBLIC))
        return true;
    const auth = (0, auth_1.getAuthPayload)(req);
    if (auth?.rol === "admin")
        return true;
    const expectedToken = (process.env.DIAGNOSTICO_TOKEN || "").trim();
    if (!expectedToken)
        return false;
    const providedToken = (req.get("x-diagnostico-token") || "").trim();
    if (!providedToken)
        return false;
    return secureEquals(providedToken, expectedToken);
}
function parseDbTimeoutMs() {
    const raw = Number(process.env.DIAGNOSTICO_DB_TIMEOUT_MS ?? DEFAULT_DB_TIMEOUT_MS);
    if (!Number.isFinite(raw))
        return DEFAULT_DB_TIMEOUT_MS;
    return Math.max(300, Math.min(10000, Math.floor(raw)));
}
async function checkDbStatus() {
    const started = Date.now();
    const timeoutMs = parseDbTimeoutMs();
    try {
        await Promise.race([
            db_1.pool.query("SELECT 1"),
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error("timeout")), timeoutMs);
            }),
        ]);
        return { ok: true, latency_ms: Date.now() - started };
    }
    catch (error) {
        const message = error instanceof Error ? error.message.toLowerCase() : "";
        return {
            ok: false,
            latency_ms: Date.now() - started,
            error: message.includes("timeout") ? "timeout" : "connection_error",
        };
    }
}
router.get("/", async (req, res) => {
    if (!hasDiagnosticsAccess(req)) {
        (0, securityMonitor_1.recordSecurityEvent)("diagnostico_acceso_denegado", req);
        res.status(403).json({ error: "No autorizado" });
        return;
    }
    const db = await checkDbStatus();
    const ok = db.ok;
    const payload = {
        status: ok ? "ok" : "degraded",
        ts: new Date().toISOString(),
        uptime_seconds: Math.floor(process.uptime()),
        api: { ok: true },
        db,
    };
    if (!ok) {
        res.status(503).json(payload);
        return;
    }
    res.json(payload);
});
router.get("/db", async (req, res) => {
    if (!hasDiagnosticsAccess(req)) {
        (0, securityMonitor_1.recordSecurityEvent)("diagnostico_db_acceso_denegado", req);
        res.status(403).json({ error: "No autorizado" });
        return;
    }
    const db = await checkDbStatus();
    if (!db.ok) {
        res.status(503).json(db);
        return;
    }
    res.json(db);
});
router.post("/access-denied", accessDeniedLimiter, async (req, res) => {
    const attemptedPathRaw = typeof req.body?.attempted_path === "string" ? req.body.attempted_path.trim() : "";
    const attemptedPath = attemptedPathRaw.slice(0, 180) || req.originalUrl || req.url;
    const requiredRoles = Array.isArray(req.body?.required_roles)
        ? req.body.required_roles
            .map((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
            .filter((value) => ALLOWED_ROLES.has(value))
            .slice(0, 10)
        : [];
    const payload = (0, auth_1.getAuthPayload)(req);
    let actor;
    if (payload) {
        const usuario = await (0, db_1.qOne)(db_1.pool, "SELECT id, nombre, email, rol FROM usuarios WHERE id = ? LIMIT 1", [payload.id]);
        actor = usuario
            ? {
                autenticado: true,
                usuario_id: usuario.id,
                usuario_nombre: usuario.nombre,
                usuario_email: usuario.email,
                usuario_rol: usuario.rol,
            }
            : {
                autenticado: true,
                usuario_id: payload.id,
                usuario_email: payload.email,
                usuario_rol: payload.rol,
                usuario_encontrado: false,
            };
    }
    else {
        actor = { autenticado: false, tipo: "anonimo" };
    }
    (0, securityMonitor_1.recordSecurityEvent)("acceso_ruta_restringida_bloqueado", req, {
        attempted_path: attemptedPath,
        required_roles: requiredRoles,
        ...actor,
    });
    res.json({ ok: true });
});
exports.default = router;
