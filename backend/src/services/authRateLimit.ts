import { PoolConnection } from "mysql2/promise";
import { pool, qOne, qRun } from "../db";
import type { AuthRateLimitRule } from "./authLimits";

export type RateLimitCheckInput = {
  action: string;
  keys: AuthRateLimitRule[];
  progressiveCooldown?: boolean;
};

export type RateLimitCheckResult = {
  allowed: boolean;
  retryAfterSeconds?: number;
  reason?: string;
};

type RateCounterRow = {
  count: number;
  expires_at: Date | string;
};

type CooldownRow = {
  strikes: number;
  blocked_until: Date | string;
  expires_at: Date | string;
};

type AuthRateLimitStore = {
  checkRateLimit(input: RateLimitCheckInput): Promise<RateLimitCheckResult>;
  recordAbuseOrCooldown(action: string, key: string): Promise<RateLimitCheckResult>;
};

const COOLDOWN_SECONDS = [5 * 60, 30 * 60, 24 * 60 * 60];
const COOLDOWN_MEMORY_SECONDS = 7 * 24 * 60 * 60;

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

function toMs(value: Date | string | null | undefined): number {
  if (!value) return 0;
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function secondsUntil(value: Date | string): number {
  return Math.max(1, Math.ceil((toMs(value) - Date.now()) / 1000));
}

function rateKey(action: string, key: string): string {
  return `auth:rl:${action}:${key}`;
}

function cooldownKey(action: string, key: string): string {
  return `auth:cooldown:${action}:${key}`;
}

class DatabaseAuthRateLimitStore implements AuthRateLimitStore {
  async checkRateLimit(input: RateLimitCheckInput): Promise<RateLimitCheckResult> {
    if (!input.keys.length) return { allowed: true };

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await this.checkRateLimitInTransaction(conn, input);
      await conn.commit();
      return result;
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async recordAbuseOrCooldown(action: string, key: string): Promise<RateLimitCheckResult> {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await this.recordCooldownInTransaction(conn, action, key);
      await conn.commit();
      return result;
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  private async checkRateLimitInTransaction(
    conn: PoolConnection,
    input: RateLimitCheckInput,
  ): Promise<RateLimitCheckResult> {
    const now = new Date();

    for (const item of input.keys) {
      const currentCooldown = await qOne<CooldownRow>(
        conn,
        "SELECT strikes, blocked_until, expires_at FROM auth_cooldowns WHERE cooldown_key = ? FOR UPDATE",
        [cooldownKey(input.action, item.key)],
      );
      if (currentCooldown && toMs(currentCooldown.blocked_until) > now.getTime()) {
        return {
          allowed: false,
          retryAfterSeconds: secondsUntil(currentCooldown.blocked_until),
          reason: `cooldown:${item.key}`,
        };
      }
    }

    for (const item of input.keys) {
      const fullKey = rateKey(input.action, item.key);
      const expiresAt = addSeconds(now, item.windowSeconds);
      const existing = await qOne<RateCounterRow>(
        conn,
        "SELECT count, expires_at FROM auth_rate_limit_counters WHERE rate_key = ? FOR UPDATE",
        [fullKey],
      );

      let nextCount = 1;
      let activeExpiresAt = expiresAt;

      if (!existing || toMs(existing.expires_at) <= now.getTime()) {
        await qRun(
          conn,
          `INSERT INTO auth_rate_limit_counters
             (rate_key, action, count, window_start, expires_at)
           VALUES (?, ?, 1, ?, ?)
           ON DUPLICATE KEY UPDATE
             action = VALUES(action),
             count = VALUES(count),
             window_start = VALUES(window_start),
             expires_at = VALUES(expires_at)`,
          [fullKey, input.action, now, expiresAt],
        );
      } else {
        nextCount = Number(existing.count || 0) + 1;
        activeExpiresAt = existing.expires_at instanceof Date ? existing.expires_at : new Date(existing.expires_at);
        await qRun(
          conn,
          "UPDATE auth_rate_limit_counters SET count = ?, updated_at = CURRENT_TIMESTAMP WHERE rate_key = ?",
          [nextCount, fullKey],
        );
      }

      if (nextCount > item.limit) {
        if (input.progressiveCooldown) {
          return this.recordCooldownInTransaction(conn, input.action, item.key);
        }
        return {
          allowed: false,
          retryAfterSeconds: secondsUntil(activeExpiresAt),
          reason: `limit:${item.key}`,
        };
      }
    }

    return { allowed: true };
  }

  private async recordCooldownInTransaction(
    conn: PoolConnection,
    action: string,
    key: string,
  ): Promise<RateLimitCheckResult> {
    const now = new Date();
    const fullKey = cooldownKey(action, key);
    const existing = await qOne<CooldownRow>(
      conn,
      "SELECT strikes, blocked_until, expires_at FROM auth_cooldowns WHERE cooldown_key = ? FOR UPDATE",
      [fullKey],
    );

    if (existing && toMs(existing.blocked_until) > now.getTime()) {
      return {
        allowed: false,
        retryAfterSeconds: secondsUntil(existing.blocked_until),
        reason: `cooldown:${key}`,
      };
    }

    const previousStrikes = existing && toMs(existing.expires_at) > now.getTime() ? Number(existing.strikes || 0) : 0;
    const strikes = Math.min(previousStrikes + 1, COOLDOWN_SECONDS.length);
    const blockedUntil = addSeconds(now, COOLDOWN_SECONDS[strikes - 1] ?? COOLDOWN_SECONDS[COOLDOWN_SECONDS.length - 1]);
    const expiresAt = addSeconds(now, COOLDOWN_MEMORY_SECONDS);

    await qRun(
      conn,
      `INSERT INTO auth_cooldowns
         (cooldown_key, action, strikes, blocked_until, expires_at)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         action = VALUES(action),
         strikes = VALUES(strikes),
         blocked_until = VALUES(blocked_until),
         expires_at = VALUES(expires_at)`,
      [fullKey, action, strikes, blockedUntil, expiresAt],
    );

    return {
      allowed: false,
      retryAfterSeconds: secondsUntil(blockedUntil),
      reason: `limit:${key}`,
    };
  }
}

const store: AuthRateLimitStore = new DatabaseAuthRateLimitStore();

export function checkRateLimit(input: RateLimitCheckInput): Promise<RateLimitCheckResult> {
  return store.checkRateLimit(input);
}

export function recordAbuseOrCooldown(action: string, key: string): Promise<RateLimitCheckResult> {
  return store.recordAbuseOrCooldown(action, key);
}
