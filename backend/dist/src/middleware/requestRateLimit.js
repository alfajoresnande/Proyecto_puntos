"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestRateLimit = requestRateLimit;
const securityMonitor_1 = require("../securityMonitor");
const authRateLimit_1 = require("../services/authRateLimit");
function requestIp(req) {
    return String(req.ip || req.socket.remoteAddress || "unknown").trim().slice(0, 120);
}
function requestRateLimit(options) {
    return async (req, res, next) => {
        try {
            const ip = requestIp(req);
            const userId = options.includeUser ? Number(req.user?.id ?? 0) : 0;
            const keys = options.windows.flatMap((window) => [
                { key: `ip_${window.name}:${ip}`, limit: window.limit, windowSeconds: window.windowSeconds },
                ...(userId > 0
                    ? [{ key: `user_${window.name}:${userId}`, limit: window.limit, windowSeconds: window.windowSeconds }]
                    : []),
            ]);
            const result = await (0, authRateLimit_1.checkRateLimit)({ action: options.action, keys });
            if (result.allowed) {
                next();
                return;
            }
            const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterSeconds ?? 60));
            (0, securityMonitor_1.recordSecurityEvent)("request_rate_limit_bloqueado", req, {
                action: options.action,
                retryAfterSeconds,
                reason: result.reason,
                userId: userId || null,
            });
            res.setHeader("Retry-After", String(retryAfterSeconds));
            res.status(429).json({
                error: "Demasiadas solicitudes. Espera un momento antes de volver a intentar.",
                retryAfterSeconds,
            });
        }
        catch (error) {
            next(error);
        }
    };
}
