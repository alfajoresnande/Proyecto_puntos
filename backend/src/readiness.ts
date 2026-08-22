import { pool } from "./db";

/**
 * Liveness vs readiness (SEC-05 / A10).
 *
 * `/api/health` respondia siempre `200 {ok:true}` aunque MySQL estuviera
 * caido, asi que un balanceador mandaba trafico a una instancia que no podia
 * autenticar, ni limitar intentos, ni persistir eventos de seguridad.
 *
 * - liveness: el proceso esta vivo y responde. No mira dependencias.
 * - readiness: la instancia puede atender de verdad. Si MySQL no responde,
 *   devuelve 503 para que la saquen de rotacion.
 */

const DEFAULT_TIMEOUT_MS = 1500;

function parseTimeoutMs(): number {
  const raw = Number(process.env.READINESS_DB_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(raw)) return DEFAULT_TIMEOUT_MS;
  return Math.max(300, Math.min(10_000, Math.floor(raw)));
}

export type DependencyStatus = {
  ok: boolean;
  latency_ms: number;
  error?: "timeout" | "connection_error";
};

export type ReadinessReport = {
  ready: boolean;
  ts: string;
  uptime_seconds: number;
  checks: {
    /** MySQL sostiene autenticacion, rate limiting y eventos de seguridad. */
    db: DependencyStatus;
  };
};

export async function checkDatabase(): Promise<DependencyStatus> {
  const startedAt = Date.now();
  const timeoutMs = parseTimeoutMs();
  let timer: NodeJS.Timeout | undefined;

  try {
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      }),
    ]);
    return { ok: true, latency_ms: Date.now() - startedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    return {
      ok: false,
      latency_ms: Date.now() - startedAt,
      error: message.includes("timeout") ? "timeout" : "connection_error",
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function buildReadinessReport(): Promise<ReadinessReport> {
  const db = await checkDatabase();
  return {
    ready: db.ok,
    ts: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
    checks: { db },
  };
}
