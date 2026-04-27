import { Router } from "express";
import { pool } from "../db";

const router = Router();
const DEFAULT_DB_TIMEOUT_MS = 1500;

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

router.get("/", async (_req, res) => {
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

router.get("/db", async (_req, res) => {
  const db = await checkDbStatus();
  if (!db.ok) {
    res.status(503).json(db);
    return;
  }
  res.json(db);
});

export default router;
