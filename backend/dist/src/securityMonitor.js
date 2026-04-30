"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordSecurityEvent = recordSecurityEvent;
exports.getSecurityMonitorSnapshot = getSecurityMonitorSnapshot;
exports.getPersistedSecurityEvents = getPersistedSecurityEvents;
const db_1 = require("./db");
const MAX_RECENT_EVENTS = 200;
const MAX_PERSISTED_EVENTS = 200;
const recentEvents = [];
const counters = new Map();
let persistQueue = Promise.resolve();
let persistenceWarned = false;
function getClientIp(req) {
    const forwarded = req.get("x-forwarded-for");
    if (forwarded) {
        const first = forwarded.split(",")[0]?.trim();
        if (first)
            return first;
    }
    return req.ip || "unknown";
}
function parseDetallesDb(raw) {
    if (!raw)
        return null;
    if (typeof raw === "object")
        return raw;
    if (typeof raw !== "string")
        return null;
    try {
        const parsed = JSON.parse(raw);
        return typeof parsed === "object" && parsed ? parsed : null;
    }
    catch {
        return null;
    }
}
function toIso(value) {
    if (value instanceof Date)
        return value.toISOString();
    if (typeof value === "string") {
        const date = new Date(value);
        if (!Number.isNaN(date.getTime()))
            return date.toISOString();
    }
    return new Date().toISOString();
}
async function persistEvent(payload) {
    const detailsJson = payload.details ? JSON.stringify(payload.details) : null;
    await (0, db_1.qRun)(db_1.pool, `INSERT INTO eventos_seguridad
      (evento, ip, metodo, ruta, origen, agente_usuario, detalles_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`, [
        payload.event,
        payload.ip,
        payload.method,
        payload.path,
        payload.origin,
        payload.userAgent,
        detailsJson,
    ]);
}
function enqueuePersist(payload) {
    persistQueue = persistQueue
        .then(() => persistEvent(payload))
        .catch((err) => {
        if (persistenceWarned)
            return;
        persistenceWarned = true;
        console.error("[SECURITY] No se pudo persistir evento en DB:", err?.message || err);
    });
}
function recordSecurityEvent(event, req, details) {
    const payload = {
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
function getSecurityMonitorSnapshot() {
    const countersByEvent = {};
    for (const [event, count] of counters.entries()) {
        countersByEvent[event] = count;
    }
    return {
        counters: countersByEvent,
        recent: [...recentEvents].reverse().slice(0, 50),
    };
}
async function getPersistedSecurityEvents(limit = 50) {
    const safeLimit = Math.max(1, Math.min(limit, MAX_PERSISTED_EVENTS));
    try {
        const rows = await (0, db_1.qAll)(db_1.pool, `SELECT id, created_at, evento, ip, metodo, ruta, origen, agente_usuario, detalles_json
       FROM eventos_seguridad
       ORDER BY id DESC
       LIMIT ?`, [safeLimit]);
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
    }
    catch (err) {
        if (!persistenceWarned) {
            persistenceWarned = true;
            console.error("[SECURITY] No se pudieron leer eventos persistidos:", err?.message || err);
        }
        return [];
    }
}
