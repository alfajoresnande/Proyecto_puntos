import { pool, qAll, qRun, type Queryable } from "../db";
import { getBuenosAiresDateStamp } from "./localSales";

const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const ACTIVE_WINDOW_MS = 35 * 60 * 1000;
const RECENT_LOGS_LIMIT = 200;
const ACTIVE_SESSION_QUERY_LIMIT = 500;

export type AppPresenceVisitorType = "anonimo" | "cliente";

export type RecordAppPresenceInput = {
  visitorId: string;
  sessionId: string;
  userId: number | null;
  visitorType: AppPresenceVisitorType;
  path: string;
  pageTitle?: string | null;
  referrer?: string | null;
  ip: string;
  userAgent?: string | null;
  occurredAt?: Date;
};

type PresenceBaseRow = {
  id: number;
  identity_key: string;
  visitor_id: string;
  session_id: string;
  usuario_id: number | null;
  visitante_tipo: AppPresenceVisitorType;
  bucket_start: Date | string;
  bucket_end: Date | string;
  first_seen_at: Date | string;
  last_seen_at: Date | string;
  first_path: string;
  last_path: string;
  page_title: string | null;
  referrer: string | null;
  ip: string;
  user_agent: string | null;
  page_views: number;
  cliente_nombre: string | null;
  cliente_email: string | null;
};

export type AppPresenceActiveSession = {
  session_id: string;
  visitor_id: string;
  usuario_id: number | null;
  visitante_tipo: AppPresenceVisitorType;
  cliente_nombre: string | null;
  cliente_email: string | null;
  started_at: string;
  last_seen_at: string;
  first_path: string;
  last_path: string;
  page_title: string | null;
  referrer: string | null;
  ip: string;
  user_agent: string | null;
  page_views: number;
};

export type AppPresenceLog = {
  id: number;
  session_id: string;
  visitor_id: string;
  usuario_id: number | null;
  visitante_tipo: AppPresenceVisitorType;
  cliente_nombre: string | null;
  cliente_email: string | null;
  bucket_start: string;
  bucket_end: string;
  first_seen_at: string;
  last_seen_at: string;
  first_path: string;
  last_path: string;
  page_title: string | null;
  referrer: string | null;
  ip: string;
  user_agent: string | null;
  page_views: number;
};

export type AppPresenceOverview = {
  summary: {
    active_now: number;
    active_clientes: number;
    active_anonimos: number;
    unique_devices_today: number;
    unique_sessions_today: number;
    registros_hoy: number;
  };
  active_sessions: AppPresenceActiveSession[];
  recent_logs: AppPresenceLog[];
};

function normalizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function normalizePath(value: unknown): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return "/";
  const prefixed = trimmed.startsWith("/") ? trimmed : `/${trimmed.replace(/^\/+/, "")}`;
  return prefixed.slice(0, 255) || "/";
}

function toMysqlDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function toIso(value: Date | string | null | undefined): string {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function toTimestamp(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function floorToHalfHour(date: Date): Date {
  const bucket = new Date(date);
  bucket.setUTCSeconds(0, 0);
  bucket.setUTCMinutes(bucket.getUTCMinutes() - (bucket.getUTCMinutes() % 30));
  return bucket;
}

function getTodayRangeInBuenosAires(now: Date = new Date()): { start: Date; end: Date } {
  const dateStamp = getBuenosAiresDateStamp(now);
  const start = new Date(`${dateStamp}T00:00:00-03:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

function getPresenceIdentityKey(
  row: Pick<PresenceBaseRow, "identity_key" | "visitante_tipo" | "usuario_id" | "visitor_id">,
): string {
  const explicit = row.identity_key?.trim();
  if (explicit) return explicit;
  if (row.visitante_tipo === "cliente" && Number.isInteger(row.usuario_id) && Number(row.usuario_id) > 0) {
    return `cliente:${Number(row.usuario_id)}`;
  }
  return `anonimo:${row.visitor_id}`;
}

function serializePresenceRow(row: PresenceBaseRow): AppPresenceLog {
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

function aggregateRecentPresenceRows(rows: PresenceBaseRow[]): AppPresenceLog[] {
  const grouped = new Map<string, {
    latest: PresenceBaseRow;
    firstSeenAt: number;
    bucketStart: number;
    bucketEnd: number;
    pageViews: number;
  }>();

  for (const row of rows) {
    const key = getPresenceIdentityKey(row);
    const current = grouped.get(key);
    const rowFirstSeenAt = toTimestamp(row.first_seen_at);
    const rowBucketStart = toTimestamp(row.bucket_start);
    const rowBucketEnd = toTimestamp(row.bucket_end);
    const rowLastSeenAt = toTimestamp(row.last_seen_at);
    const rowPageViews = Number(row.page_views ?? 0);

    if (!current) {
      grouped.set(key, {
        latest: row,
        firstSeenAt: rowFirstSeenAt,
        bucketStart: rowBucketStart,
        bucketEnd: rowBucketEnd,
        pageViews: rowPageViews,
      });
      continue;
    }

    if (rowLastSeenAt > toTimestamp(current.latest.last_seen_at)) {
      current.latest = row;
    }
    current.firstSeenAt = Math.min(current.firstSeenAt, rowFirstSeenAt);
    current.bucketStart = Math.min(current.bucketStart, rowBucketStart);
    current.bucketEnd = Math.max(current.bucketEnd, rowBucketEnd);
    current.pageViews += rowPageViews;
  }

  return Array.from(grouped.values())
    .sort((left, right) => toTimestamp(right.latest.last_seen_at) - toTimestamp(left.latest.last_seen_at))
    .map<AppPresenceLog>(({ latest, firstSeenAt, bucketStart, bucketEnd, pageViews }) => ({
      id: Number(latest.id),
      session_id: latest.session_id,
      visitor_id: latest.visitor_id,
      usuario_id: latest.usuario_id === null ? null : Number(latest.usuario_id),
      visitante_tipo: latest.visitante_tipo,
      cliente_nombre: latest.cliente_nombre ?? null,
      cliente_email: latest.cliente_email ?? null,
      bucket_start: new Date(bucketStart || Date.now()).toISOString(),
      bucket_end: new Date(bucketEnd || Date.now()).toISOString(),
      first_seen_at: new Date(firstSeenAt || Date.now()).toISOString(),
      last_seen_at: toIso(latest.last_seen_at),
      first_path: latest.first_path,
      last_path: latest.last_path,
      page_title: latest.page_title ?? null,
      referrer: latest.referrer ?? null,
      ip: latest.ip,
      user_agent: latest.user_agent ?? null,
      page_views: pageViews,
    }));
}

export async function recordAppPresence(input: RecordAppPresenceInput, conn: Queryable = pool): Promise<void> {
  const occurredAt = input.occurredAt ?? new Date();
  const bucketStart = floorToHalfHour(occurredAt);
  const bucketEnd = new Date(bucketStart.getTime() + THIRTY_MINUTES_MS);
  const identityKey =
    input.visitorType === "cliente" && Number.isInteger(input.userId) && Number(input.userId) > 0
      ? `cliente:${Number(input.userId)}`
      : `anonimo:${input.visitorId}`;

  await qRun(
    conn,
    `INSERT INTO app_presencia_registros
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
       page_views = page_views + IF(last_path <> VALUES(last_path), 1, 0),
       updated_at = CURRENT_TIMESTAMP`,
    [
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
    ],
  );
}

export async function getAppPresenceOverview(limit = 80, conn: Queryable = pool): Promise<AppPresenceOverview> {
  const safeLimit = Math.max(10, Math.min(limit, RECENT_LOGS_LIMIT));
  const now = new Date();
  const recentThreshold = new Date(now.getTime() - THIRTY_MINUTES_MS);
  const activeThreshold = new Date(now.getTime() - ACTIVE_WINDOW_MS);
  const { start, end } = getTodayRangeInBuenosAires(now);

  const [
    todaySummary,
    recentLogsRows,
    activeCandidateRows,
  ] = await Promise.all([
    qAll<{
      unique_devices_today: number;
      unique_sessions_today: number;
      registros_hoy: number;
    }>(
      conn,
      `SELECT
          COUNT(DISTINCT visitor_id) AS unique_devices_today,
          COUNT(DISTINCT session_id) AS unique_sessions_today,
          COUNT(*) AS registros_hoy
       FROM app_presencia_registros
       WHERE bucket_start >= ? AND bucket_start < ?`,
      [toMysqlDateTime(start), toMysqlDateTime(end)],
    ),
    qAll<PresenceBaseRow>(
      conn,
      `SELECT apr.id, apr.identity_key, apr.visitor_id, apr.session_id, apr.usuario_id, apr.visitante_tipo,
              apr.bucket_start, apr.bucket_end, apr.first_seen_at, apr.last_seen_at,
              apr.first_path, apr.last_path, apr.page_title, apr.referrer, apr.ip, apr.user_agent, apr.page_views,
              u.nombre AS cliente_nombre, u.email AS cliente_email
       FROM app_presencia_registros apr
       LEFT JOIN usuarios u ON u.id = apr.usuario_id
       WHERE apr.last_seen_at >= ?
       ORDER BY apr.last_seen_at DESC, apr.id DESC
       LIMIT ?`,
      [toMysqlDateTime(recentThreshold), safeLimit],
    ),
    qAll<PresenceBaseRow>(
      conn,
      `SELECT apr.id, apr.identity_key, apr.visitor_id, apr.session_id, apr.usuario_id, apr.visitante_tipo,
              apr.bucket_start, apr.bucket_end, apr.first_seen_at, apr.last_seen_at,
              apr.first_path, apr.last_path, apr.page_title, apr.referrer, apr.ip, apr.user_agent, apr.page_views,
              u.nombre AS cliente_nombre, u.email AS cliente_email
       FROM app_presencia_registros apr
       LEFT JOIN usuarios u ON u.id = apr.usuario_id
       WHERE apr.last_seen_at >= ?
       ORDER BY apr.last_seen_at DESC, apr.id DESC
       LIMIT ?`,
      [toMysqlDateTime(activeThreshold), ACTIVE_SESSION_QUERY_LIMIT],
    ),
  ]);

  const latestBySession = new Map<string, PresenceBaseRow>();
  for (const row of activeCandidateRows) {
    if (!latestBySession.has(row.session_id)) {
      latestBySession.set(row.session_id, row);
    }
  }

  const sessionIds = Array.from(latestBySession.keys());
  const sessionHistoryRows = sessionIds.length
    ? await qAll<PresenceBaseRow>(
        conn,
        `SELECT apr.id, apr.identity_key, apr.visitor_id, apr.session_id, apr.usuario_id, apr.visitante_tipo,
                apr.bucket_start, apr.bucket_end, apr.first_seen_at, apr.last_seen_at,
                apr.first_path, apr.last_path, apr.page_title, apr.referrer, apr.ip, apr.user_agent, apr.page_views,
                u.nombre AS cliente_nombre, u.email AS cliente_email
         FROM app_presencia_registros apr
         LEFT JOIN usuarios u ON u.id = apr.usuario_id
         WHERE apr.session_id IN (${sessionIds.map(() => "?").join(", ")})
         ORDER BY apr.first_seen_at ASC, apr.id ASC`,
        sessionIds,
      )
    : [];

  const sessionMeta = new Map<string, { startedAt: number; pageViews: number }>();
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

  const activePeople = new Map<string, {
    latest: PresenceBaseRow;
    startedAt: number;
    pageViews: number;
  }>();

  for (const row of latestBySession.values()) {
    const key = getPresenceIdentityKey(row);
    const meta = sessionMeta.get(row.session_id);
    const startedAt = meta?.startedAt ?? toTimestamp(row.first_seen_at);
    const pageViews = meta?.pageViews ?? Number(row.page_views ?? 0);
    const current = activePeople.get(key);

    if (!current) {
      activePeople.set(key, {
        latest: row,
        startedAt,
        pageViews,
      });
      continue;
    }

    if (toTimestamp(row.last_seen_at) > toTimestamp(current.latest.last_seen_at)) {
      current.latest = row;
    }
    current.startedAt = Math.min(current.startedAt, startedAt);
    current.pageViews += pageViews;
  }

  const activeSessions = Array.from(activePeople.values())
    .map<AppPresenceActiveSession>(({ latest, startedAt, pageViews }) => ({
      session_id: latest.session_id,
      visitor_id: latest.visitor_id,
      usuario_id: latest.usuario_id === null ? null : Number(latest.usuario_id),
      visitante_tipo: latest.visitante_tipo,
      cliente_nombre: latest.cliente_nombre ?? null,
      cliente_email: latest.cliente_email ?? null,
      started_at: new Date(startedAt || Date.now()).toISOString(),
      last_seen_at: toIso(latest.last_seen_at),
      first_path: latest.first_path,
      last_path: latest.last_path,
      page_title: latest.page_title ?? null,
      referrer: latest.referrer ?? null,
      ip: latest.ip,
      user_agent: latest.user_agent ?? null,
      page_views: pageViews,
    }))
    .sort((left, right) => new Date(right.last_seen_at).getTime() - new Date(left.last_seen_at).getTime());

  const recentLogs = aggregateRecentPresenceRows(recentLogsRows);

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
    recent_logs: recentLogs,
  };
}
