"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordAppPresence = recordAppPresence;
exports.getAppPresenceOverview = getAppPresenceOverview;
const db_1 = require("../db");
const localSales_1 = require("./localSales");
const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const ACTIVE_WINDOW_MS = 35 * 60 * 1000;
const RECENT_LOGS_LIMIT = 200;
const ACTIVE_SESSION_QUERY_LIMIT = 500;
function normalizeText(value, maxLength) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!trimmed)
        return null;
    return trimmed.slice(0, maxLength);
}
function normalizePath(value) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (!trimmed)
        return "/";
    const prefixed = trimmed.startsWith("/") ? trimmed : `/${trimmed.replace(/^\/+/, "")}`;
    return prefixed.slice(0, 255) || "/";
}
function toMysqlDateTime(date) {
    return date.toISOString().slice(0, 19).replace("T", " ");
}
function toIso(value) {
    if (!value)
        return new Date().toISOString();
    if (value instanceof Date)
        return value.toISOString();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}
function floorToHalfHour(date) {
    const bucket = new Date(date);
    bucket.setUTCSeconds(0, 0);
    bucket.setUTCMinutes(bucket.getUTCMinutes() - (bucket.getUTCMinutes() % 30));
    return bucket;
}
function getTodayRangeInBuenosAires(now = new Date()) {
    const dateStamp = (0, localSales_1.getBuenosAiresDateStamp)(now);
    const start = new Date(`${dateStamp}T00:00:00-03:00`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { start, end };
}
function serializePresenceRow(row) {
    return {
        id: Number(row.id),
        session_id: row.session_id,
        visitor_id: row.visitor_id,
        usuario_id: row.usuario_id === null ? null : Number(row.usuario_id),
        visitante_tipo: row.visitante_tipo,
        cliente_nombre: row.cliente_nombre ?? null,
        cliente_email: row.cliente_email ?? null,
        bucket_start: toIso(row.bucket_start),
        bucket_end: toIso(row.bucket_end),
        first_seen_at: toIso(row.first_seen_at),
        last_seen_at: toIso(row.last_seen_at),
        first_path: row.first_path,
        last_path: row.last_path,
        page_title: row.page_title ?? null,
        referrer: row.referrer ?? null,
        ip: row.ip,
        user_agent: row.user_agent ?? null,
        page_views: Number(row.page_views ?? 0),
    };
}
async function recordAppPresence(input, conn = db_1.pool) {
    const occurredAt = input.occurredAt ?? new Date();
    const bucketStart = floorToHalfHour(occurredAt);
    const bucketEnd = new Date(bucketStart.getTime() + THIRTY_MINUTES_MS);
    const identityKey = input.visitorType === "cliente" && Number.isInteger(input.userId) && Number(input.userId) > 0
        ? `cliente:${Number(input.userId)}`
        : `anonimo:${input.visitorId}`;
    await (0, db_1.qRun)(conn, `INSERT INTO app_presencia_registros
      (identity_key, visitor_id, session_id, usuario_id, visitante_tipo,
       bucket_start, bucket_end, first_seen_at, last_seen_at,
       first_path, last_path, page_title, referrer, ip, user_agent, page_views)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE
       usuario_id = VALUES(usuario_id),
       visitante_tipo = VALUES(visitante_tipo),
       last_seen_at = VALUES(last_seen_at),
       last_path = VALUES(last_path),
       page_title = COALESCE(VALUES(page_title), page_title),
       referrer = COALESCE(VALUES(referrer), referrer),
       ip = VALUES(ip),
       user_agent = COALESCE(VALUES(user_agent), user_agent),
       page_views = page_views + 1,
       updated_at = CURRENT_TIMESTAMP`, [
        identityKey,
        input.visitorId,
        input.sessionId,
        input.userId,
        input.visitorType,
        toMysqlDateTime(bucketStart),
        toMysqlDateTime(bucketEnd),
        toMysqlDateTime(occurredAt),
        toMysqlDateTime(occurredAt),
        normalizePath(input.path),
        normalizePath(input.path),
        normalizeText(input.pageTitle, 255),
        normalizeText(input.referrer, 255),
        normalizeText(input.ip, 64) ?? "unknown",
        normalizeText(input.userAgent, 255),
    ]);
}
async function getAppPresenceOverview(limit = 80, conn = db_1.pool) {
    const safeLimit = Math.max(10, Math.min(limit, RECENT_LOGS_LIMIT));
    const now = new Date();
    const activeThreshold = new Date(now.getTime() - ACTIVE_WINDOW_MS);
    const { start, end } = getTodayRangeInBuenosAires(now);
    const [todaySummary, recentLogsRows, activeCandidateRows,] = await Promise.all([
        (0, db_1.qAll)(conn, `SELECT
          COUNT(DISTINCT visitor_id) AS unique_devices_today,
          COUNT(DISTINCT session_id) AS unique_sessions_today,
          COUNT(*) AS registros_hoy
       FROM app_presencia_registros
       WHERE bucket_start >= ? AND bucket_start < ?`, [toMysqlDateTime(start), toMysqlDateTime(end)]),
        (0, db_1.qAll)(conn, `SELECT apr.id, apr.identity_key, apr.visitor_id, apr.session_id, apr.usuario_id, apr.visitante_tipo,
              apr.bucket_start, apr.bucket_end, apr.first_seen_at, apr.last_seen_at,
              apr.first_path, apr.last_path, apr.page_title, apr.referrer, apr.ip, apr.user_agent, apr.page_views,
              u.nombre AS cliente_nombre, u.email AS cliente_email
       FROM app_presencia_registros apr
       LEFT JOIN usuarios u ON u.id = apr.usuario_id
       ORDER BY apr.last_seen_at DESC, apr.id DESC
       LIMIT ?`, [safeLimit]),
        (0, db_1.qAll)(conn, `SELECT apr.id, apr.identity_key, apr.visitor_id, apr.session_id, apr.usuario_id, apr.visitante_tipo,
              apr.bucket_start, apr.bucket_end, apr.first_seen_at, apr.last_seen_at,
              apr.first_path, apr.last_path, apr.page_title, apr.referrer, apr.ip, apr.user_agent, apr.page_views,
              u.nombre AS cliente_nombre, u.email AS cliente_email
       FROM app_presencia_registros apr
       LEFT JOIN usuarios u ON u.id = apr.usuario_id
       WHERE apr.last_seen_at >= ?
       ORDER BY apr.last_seen_at DESC, apr.id DESC
       LIMIT ?`, [toMysqlDateTime(activeThreshold), ACTIVE_SESSION_QUERY_LIMIT]),
    ]);
    const latestBySession = new Map();
    for (const row of activeCandidateRows) {
        if (!latestBySession.has(row.session_id)) {
            latestBySession.set(row.session_id, row);
        }
    }
    const sessionIds = Array.from(latestBySession.keys());
    const sessionHistoryRows = sessionIds.length
        ? await (0, db_1.qAll)(conn, `SELECT apr.id, apr.identity_key, apr.visitor_id, apr.session_id, apr.usuario_id, apr.visitante_tipo,
                apr.bucket_start, apr.bucket_end, apr.first_seen_at, apr.last_seen_at,
                apr.first_path, apr.last_path, apr.page_title, apr.referrer, apr.ip, apr.user_agent, apr.page_views,
                u.nombre AS cliente_nombre, u.email AS cliente_email
         FROM app_presencia_registros apr
         LEFT JOIN usuarios u ON u.id = apr.usuario_id
         WHERE apr.session_id IN (${sessionIds.map(() => "?").join(", ")})
         ORDER BY apr.first_seen_at ASC, apr.id ASC`, sessionIds)
        : [];
    const sessionMeta = new Map();
    for (const row of sessionHistoryRows) {
        const sessionId = row.session_id;
        const startedAt = new Date(row.first_seen_at).getTime();
        const current = sessionMeta.get(sessionId);
        if (!current) {
            sessionMeta.set(sessionId, {
                startedAt,
                pageViews: Number(row.page_views ?? 0),
            });
            continue;
        }
        current.startedAt = Math.min(current.startedAt, startedAt);
        current.pageViews += Number(row.page_views ?? 0);
    }
    const activeSessions = Array.from(latestBySession.values())
        .map((row) => {
        const meta = sessionMeta.get(row.session_id);
        return {
            session_id: row.session_id,
            visitor_id: row.visitor_id,
            usuario_id: row.usuario_id === null ? null : Number(row.usuario_id),
            visitante_tipo: row.visitante_tipo,
            cliente_nombre: row.cliente_nombre ?? null,
            cliente_email: row.cliente_email ?? null,
            started_at: new Date(meta?.startedAt ?? new Date(row.first_seen_at).getTime()).toISOString(),
            last_seen_at: toIso(row.last_seen_at),
            first_path: row.first_path,
            last_path: row.last_path,
            page_title: row.page_title ?? null,
            referrer: row.referrer ?? null,
            ip: row.ip,
            user_agent: row.user_agent ?? null,
            page_views: meta?.pageViews ?? Number(row.page_views ?? 0),
        };
    })
        .sort((left, right) => new Date(right.last_seen_at).getTime() - new Date(left.last_seen_at).getTime());
    const summaryRow = todaySummary[0] ?? {
        unique_devices_today: 0,
        unique_sessions_today: 0,
        registros_hoy: 0,
    };
    return {
        summary: {
            active_now: activeSessions.length,
            active_clientes: activeSessions.filter((item) => item.visitante_tipo === "cliente").length,
            active_anonimos: activeSessions.filter((item) => item.visitante_tipo === "anonimo").length,
            unique_devices_today: Number(summaryRow.unique_devices_today ?? 0),
            unique_sessions_today: Number(summaryRow.unique_sessions_today ?? 0),
            registros_hoy: Number(summaryRow.registros_hoy ?? 0),
        },
        active_sessions: activeSessions,
        recent_logs: recentLogsRows.map((row) => serializePresenceRow(row)),
    };
}
