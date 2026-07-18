"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkRateLimit = checkRateLimit;
exports.checkActiveCooldown = checkActiveCooldown;
exports.recordAbuseOrCooldown = recordAbuseOrCooldown;
const db_1 = require("../db");
const COOLDOWN_SECONDS = [5 * 60, 30 * 60, 24 * 60 * 60];
const COOLDOWN_MEMORY_SECONDS = 7 * 24 * 60 * 60;
function addSeconds(date, seconds) {
    return new Date(date.getTime() + seconds * 1000);
}
function toMs(value) {
    if (!value)
        return 0;
    return value instanceof Date ? value.getTime() : new Date(value).getTime();
}
function secondsUntil(value) {
    return Math.max(1, Math.ceil((toMs(value) - Date.now()) / 1000));
}
function rateKey(action, key) {
    return `auth:rl:${action}:${key}`;
}
function cooldownKey(action, key) {
    return `auth:cooldown:${action}:${key}`;
}
class DatabaseAuthRateLimitStore {
    async checkRateLimit(input) {
        if (!input.keys.length)
            return { allowed: true };
        const conn = await db_1.pool.getConnection();
        try {
            await conn.beginTransaction();
            const result = await this.checkRateLimitInTransaction(conn, input);
            await conn.commit();
            return result;
        }
        catch (error) {
            await conn.rollback();
            throw error;
        }
        finally {
            conn.release();
        }
    }
    async checkActiveCooldown(input) {
        if (!input.keys.length)
            return { allowed: true };
        for (const item of input.keys) {
            const currentCooldown = await (0, db_1.qOne)(db_1.pool, "SELECT strikes, blocked_until, expires_at FROM auth_cooldowns WHERE cooldown_key = ?", [cooldownKey(input.action, item.key)]);
            if (currentCooldown && toMs(currentCooldown.blocked_until) > Date.now()) {
                return {
                    allowed: false,
                    retryAfterSeconds: secondsUntil(currentCooldown.blocked_until),
                    reason: `cooldown:${item.key}`,
                };
            }
        }
        return { allowed: true };
    }
    async recordAbuseOrCooldown(action, key) {
        const conn = await db_1.pool.getConnection();
        try {
            await conn.beginTransaction();
            const result = await this.recordCooldownInTransaction(conn, action, key);
            await conn.commit();
            return result;
        }
        catch (error) {
            await conn.rollback();
            throw error;
        }
        finally {
            conn.release();
        }
    }
    async checkRateLimitInTransaction(conn, input) {
        const now = new Date();
        for (const item of input.keys) {
            const currentCooldown = await (0, db_1.qOne)(conn, "SELECT strikes, blocked_until, expires_at FROM auth_cooldowns WHERE cooldown_key = ? FOR UPDATE", [cooldownKey(input.action, item.key)]);
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
            const existing = await (0, db_1.qOne)(conn, "SELECT count, expires_at FROM auth_rate_limit_counters WHERE rate_key = ? FOR UPDATE", [fullKey]);
            let nextCount = 1;
            let activeExpiresAt = expiresAt;
            if (!existing || toMs(existing.expires_at) <= now.getTime()) {
                await (0, db_1.qRun)(conn, `INSERT INTO auth_rate_limit_counters
             (rate_key, action, count, window_start, expires_at)
           VALUES (?, ?, 1, ?, ?)
           ON DUPLICATE KEY UPDATE
             action = VALUES(action),
             count = VALUES(count),
             window_start = VALUES(window_start),
             expires_at = VALUES(expires_at)`, [fullKey, input.action, now, expiresAt]);
            }
            else {
                nextCount = Number(existing.count || 0) + 1;
                activeExpiresAt = existing.expires_at instanceof Date ? existing.expires_at : new Date(existing.expires_at);
                await (0, db_1.qRun)(conn, "UPDATE auth_rate_limit_counters SET count = ?, updated_at = CURRENT_TIMESTAMP WHERE rate_key = ?", [nextCount, fullKey]);
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
    async recordCooldownInTransaction(conn, action, key) {
        const now = new Date();
        const fullKey = cooldownKey(action, key);
        const existing = await (0, db_1.qOne)(conn, "SELECT strikes, blocked_until, expires_at FROM auth_cooldowns WHERE cooldown_key = ? FOR UPDATE", [fullKey]);
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
        await (0, db_1.qRun)(conn, `INSERT INTO auth_cooldowns
         (cooldown_key, action, strikes, blocked_until, expires_at)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         action = VALUES(action),
         strikes = VALUES(strikes),
         blocked_until = VALUES(blocked_until),
         expires_at = VALUES(expires_at)`, [fullKey, action, strikes, blockedUntil, expiresAt]);
        return {
            allowed: false,
            retryAfterSeconds: secondsUntil(blockedUntil),
            reason: `limit:${key}`,
        };
    }
}
const store = new DatabaseAuthRateLimitStore();
function checkRateLimit(input) {
    return store.checkRateLimit(input);
}
function checkActiveCooldown(input) {
    return store.checkActiveCooldown(input);
}
function recordAbuseOrCooldown(action, key) {
    return store.recordAbuseOrCooldown(action, key);
}
