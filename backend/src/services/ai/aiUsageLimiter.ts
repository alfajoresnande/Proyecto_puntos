import crypto from "crypto";

export type AiUsageLimitReason =
  | "daily_request_limit"
  | "per_user_daily_limit"
  | "per_ip_minute_limit";

export type AiUsageLimitResult =
  | { allowed: true }
  | { allowed: false; reason: AiUsageLimitReason; retryAfterMs: number };

type CounterWindow = {
  count: number;
  resetAt: number;
};

const counters = new Map<string, CounterWindow>();
let cleanupTick = 0;

function readLimit(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(0, parsed);
}

function nextUtcDayStart(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

function getCounter(key: string, resetAt: number, now: number): CounterWindow {
  const current = counters.get(key);
  if (current && current.resetAt > now) return current;

  const created = { count: 0, resetAt };
  counters.set(key, created);
  return created;
}

function cleanupExpiredCounters(now: number): void {
  cleanupTick += 1;
  if (cleanupTick % 100 !== 0) return;

  for (const [key, counter] of counters.entries()) {
    if (counter.resetAt <= now) counters.delete(key);
  }
}

export function hashIpForAiLogs(ip: string | undefined): string {
  const normalized = (ip || "unknown").trim().toLowerCase();
  const salt = process.env.AI_CHAT_IP_HASH_SALT?.trim() || "nande-ai-chat";
  return crypto.createHash("sha256").update(`${salt}:${normalized}`).digest("hex").slice(0, 20);
}

export function checkAndConsumeAiUsage({
  userId,
  ipHash,
}: {
  userId?: number;
  ipHash: string;
}): AiUsageLimitResult {
  const now = Date.now();
  cleanupExpiredCounters(now);

  const globalLimit = readLimit("AI_CHAT_DAILY_REQUEST_LIMIT", 10_000);
  const perUserDailyLimit = readLimit("AI_CHAT_PER_USER_DAILY_LIMIT", 50);
  const perIpMinuteLimit = readLimit("AI_CHAT_PER_IP_MINUTE_LIMIT", 10);
  const dailyResetAt = nextUtcDayStart(now);
  const minuteResetAt = now + 60_000;

  const targets: Array<{
    limit: number;
    reason: AiUsageLimitReason;
    counter: CounterWindow;
  }> = [
    {
      limit: globalLimit,
      reason: "daily_request_limit",
      counter: getCounter("global:daily", dailyResetAt, now),
    },
    {
      limit: perIpMinuteLimit,
      reason: "per_ip_minute_limit",
      counter: getCounter(`ip:${ipHash}:minute`, minuteResetAt, now),
    },
  ];

  if (userId) {
    targets.push({
      limit: perUserDailyLimit,
      reason: "per_user_daily_limit",
      counter: getCounter(`user:${userId}:daily`, dailyResetAt, now),
    });
  }

  for (const target of targets) {
    if (target.limit > 0 && target.counter.count >= target.limit) {
      return {
        allowed: false,
        reason: target.reason,
        retryAfterMs: Math.max(0, target.counter.resetAt - now),
      };
    }
  }

  for (const target of targets) {
    if (target.limit > 0) target.counter.count += 1;
  }

  return { allowed: true };
}
