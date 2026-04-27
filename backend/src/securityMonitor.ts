import { Request } from "express";
import { pool, qAll, qRun } from "./db";

type EventoSeguridad = {
  ts: string;
  event: string;
  ip: string;
  method: string;
  path: string;
  origin: string;
  userAgent: string;
  details?: Record<string, unknown>;
};

type EventoSeguridadPersistido = {
  id: number;
  creado_en: string;
  evento: string;
  ip: string;
  metodo: string;
  ruta: string;
  origen: string;
  agente_usuario: string;
  detalles: Record<string, unknown> | null;
};

const MAX_RECENT_EVENTS = 200;
const MAX_PERSISTED_EVENTS = 200;
const recentEvents: EventoSeguridad[] = [];
const counters = new Map<string, number>();

let persistQueue: Promise<void> = Promise.resolve();
let persistenceWarned = false;

function getClientIp(req: Request): string {
  const forwarded = req.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.ip || "unknown";
}

function parseDetallesDb(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

async function persistEvent(payload: EventoSeguridad): Promise<void> {
  const detailsJson = payload.details ? JSON.stringify(payload.details) : null;
  await qRun(
    pool,
    `INSERT INTO eventos_seguridad
      (evento, ip, metodo, ruta, origen, agente_usuario, detalles_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)` ,
    [
      payload.event,
      payload.ip,
      payload.method,
      payload.path,
      payload.origin,
      payload.userAgent,
      detailsJson,
    ]
  );
}

function enqueuePersist(payload: EventoSeguridad): void {
  persistQueue = persistQueue
    .then(() => persistEvent(payload))
    .catch((err: any) => {
      if (persistenceWarned) return;
      persistenceWarned = true;
      console.error("[SECURITY] No se pudo persistir evento en DB:", err?.message || err);
    });
}

export function recordSecurityEvent(
  event: string,
  req: Request,
  details?: Record<string, unknown>
): void {
  const payload: EventoSeguridad = {
    ts: new Date().toISOString(),
    event,
    ip: getClientIp(req),
    method: req.method,
    path: req.originalUrl || req.url,
    origin: req.get("origin") || "-",
    userAgent: req.get("user-agent") || "-",
    details,
  };

  counters.set(event, (counters.get(event) ?? 0) + 1);
  recentEvents.push(payload);
  if (recentEvents.length > MAX_RECENT_EVENTS) {
    recentEvents.splice(0, recentEvents.length - MAX_RECENT_EVENTS);
  }

  enqueuePersist(payload);
  console.warn("[SECURITY]", JSON.stringify(payload));
}

export function getSecurityMonitorSnapshot() {
  const countersByEvent: Record<string, number> = {};
  for (const [event, count] of counters.entries()) {
    countersByEvent[event] = count;
  }

  return {
    counters: countersByEvent,
    recent: [...recentEvents].reverse().slice(0, 50),
  };
}

export async function getPersistedSecurityEvents(limit = 50): Promise<EventoSeguridadPersistido[]> {
  const safeLimit = Math.max(1, Math.min(limit, MAX_PERSISTED_EVENTS));

  try {
    const rows = await qAll<{
      id: number;
      created_at: Date | string;
      evento: string;
      ip: string;
      metodo: string;
      ruta: string;
      origen: string;
      agente_usuario: string;
      detalles_json: unknown;
    }>(
      pool,
      `SELECT id, created_at, evento, ip, metodo, ruta, origen, agente_usuario, detalles_json
       FROM eventos_seguridad
       ORDER BY id DESC
       LIMIT ?`,
      [safeLimit]
    );

    return rows.map((row) => ({
      id: row.id,
      creado_en: toIso(row.created_at),
      evento: row.evento,
      ip: row.ip,
      metodo: row.metodo,
      ruta: row.ruta,
      origen: row.origen,
      agente_usuario: row.agente_usuario,
      detalles: parseDetallesDb(row.detalles_json),
    }));
  } catch (err: any) {
    if (!persistenceWarned) {
      persistenceWarned = true;
      console.error("[SECURITY] No se pudieron leer eventos persistidos:", err?.message || err);
    }
    return [];
  }
}
