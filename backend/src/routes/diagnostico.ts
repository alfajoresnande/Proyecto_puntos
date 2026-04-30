import { timingSafeEqual } from "crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { getAuthPayload } from "../auth";
import { pool, qOne } from "../db";
import { recordSecurityEvent } from "../securityMonitor";

const router = Router();
const DEFAULT_DB_TIMEOUT_MS = 1500;
const ALLOWED_ROLES = new Set(["cliente", "vendedor", "admin"]);
const accessDeniedLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiadas solicitudes" },
});

function isEnabled(raw: string | undefined): boolean {
  if (!raw) return false;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

function secureEquals(value: string, expected: string): boolean {
  const current = Buffer.from(value);
  const target = Buffer.from(expected);
  if (current.length !== target.length) return false;
  return timingSafeEqual(current, target);
}

function hasDiagnosticsAccess(req: Parameters<typeof getAuthPayload>[0]): boolean {
  // Por defecto el diagnostico es publico para facilitar puesta en marcha.
  // Si queres protegerlo, define DIAGNOSTICO_REQUIRE_AUTH=true.
  if (!isEnabled(process.env.DIAGNOSTICO_REQUIRE_AUTH)) return true;

  if (isEnabled(process.env.DIAGNOSTICO_PUBLIC)) return true;

  const auth = getAuthPayload(req);
  if (auth?.rol === "admin") return true;

  const expectedToken = (process.env.DIAGNOSTICO_TOKEN || "").trim();
  if (!expectedToken) return false;
  const providedToken = (req.get("x-diagnostico-token") || "").trim();
  if (!providedToken) return false;

  return secureEquals(providedToken, expectedToken);
}

function parseDbTimeoutMs(): number {
  const raw = Number(process.env.DIAGNOSTICO_DB_TIMEOUT_MS ?? DEFAULT_DB_TIMEOUT_MS);
  if (!Number.isFinite(raw)) return DEFAULT_DB_TIMEOUT_MS;
  return Math.max(300, Math.min(10000, Math.floor(raw)));
}

type DbStatus = {
  ok: boolean;
  latency_ms: number;
  error?: "timeout" | "connection_error";
};

async function checkDbStatus(): Promise<DbStatus> {
  const started = Date.now();
  const timeoutMs = parseDbTimeoutMs();

  try {
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("timeout")), timeoutMs);
      }),
    ]);
    return { ok: true, latency_ms: Date.now() - started };
  } catch (error) {
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
    recordSecurityEvent("diagnostico_acceso_denegado", req);
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
    recordSecurityEvent("diagnostico_db_acceso_denegado", req);
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
        .map((value: unknown) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
        .filter((value: string) => ALLOWED_ROLES.has(value))
        .slice(0, 10)
    : [];

  const payload = getAuthPayload(req);
  let actor: Record<string, unknown>;

  if (payload) {
    const usuario = await qOne<{ id: number; nombre: string; email: string; rol: string }>(
      pool,
      "SELECT id, nombre, email, rol FROM usuarios WHERE id = ? LIMIT 1",
      [payload.id]
    );
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
  } else {
    actor = { autenticado: false, tipo: "anonimo" };
  }

  recordSecurityEvent("acceso_ruta_restringida_bloqueado", req, {
    attempted_path: attemptedPath,
    required_roles: requiredRoles,
    ...actor,
  });

  res.json({ ok: true });
});

export default router;
