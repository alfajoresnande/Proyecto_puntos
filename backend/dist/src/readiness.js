"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkDatabase = checkDatabase;
exports.buildReadinessReport = buildReadinessReport;
const db_1 = require("./db");
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
function parseTimeoutMs() {
    const raw = Number(process.env.READINESS_DB_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
    if (!Number.isFinite(raw))
        return DEFAULT_TIMEOUT_MS;
    return Math.max(300, Math.min(10_000, Math.floor(raw)));
}
async function checkDatabase() {
    const startedAt = Date.now();
    const timeoutMs = parseTimeoutMs();
    let timer;
    try {
        await Promise.race([
            db_1.pool.query("SELECT 1"),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
            }),
        ]);
        return { ok: true, latency_ms: Date.now() - startedAt };
    }
    catch (error) {
        const message = error instanceof Error ? error.message.toLowerCase() : "";
        return {
            ok: false,
            latency_ms: Date.now() - startedAt,
            error: message.includes("timeout") ? "timeout" : "connection_error",
        };
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
async function buildReadinessReport() {
    const db = await checkDatabase();
    return {
        ready: db.ok,
        ts: new Date().toISOString(),
        uptime_seconds: Math.floor(process.uptime()),
        checks: { db },
    };
}
