import type { NextFunction, Request, Response } from "express";
import { recordSecurityEvent } from "../securityMonitor";
import { checkRateLimit } from "../services/authRateLimit";

type RateWindow = {
  name: string;
  limit: number;
  windowSeconds: number;
};

type RequestRateLimitOptions = {
  action: string;
  windows: RateWindow[];
  includeUser?: boolean;
};

function requestIp(req: Request): string {
  return String(req.ip || req.socket.remoteAddress || "unknown").trim().slice(0, 120);
}

export function requestRateLimit(options: RequestRateLimitOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ip = requestIp(req);
      const userId = options.includeUser ? Number(req.user?.id ?? 0) : 0;
      const keys = options.windows.flatMap((window) => [
        { key: `ip_${window.name}:${ip}`, limit: window.limit, windowSeconds: window.windowSeconds },
        ...(userId > 0
          ? [{ key: `user_${window.name}:${userId}`, limit: window.limit, windowSeconds: window.windowSeconds }]
          : []),
      ]);
      const result = await checkRateLimit({ action: options.action, keys });
      if (result.allowed) {
        next();
        return;
      }

      const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterSeconds ?? 60));
      recordSecurityEvent("request_rate_limit_bloqueado", req, {
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
    } catch (error) {
      next(error);
    }
  };
}
