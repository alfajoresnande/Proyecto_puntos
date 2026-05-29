"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashIpForAiLogs = hashIpForAiLogs;
exports.checkAndConsumeAiUsage = checkAndConsumeAiUsage;
const crypto_1 = __importDefault(require("crypto"));
const counters = new Map();
let cleanupTick = 0;
function readLimit(name, fallback) {
    const parsed = Number.parseInt(process.env[name] ?? "", 10);
    if (!Number.isInteger(parsed))
        return fallback;
    return Math.max(0, parsed);
}
function nextUtcDayStart(now) {
    const date = new Date(now);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}
function getCounter(key, resetAt, now) {
    const current = counters.get(key);
    if (current && current.resetAt > now)
        return current;
    const created = { count: 0, resetAt };
    counters.set(key, created);
    return created;
}
function cleanupExpiredCounters(now) {
    cleanupTick += 1;
    if (cleanupTick % 100 !== 0)
        return;
    for (const [key, counter] of counters.entries()) {
        if (counter.resetAt <= now)
            counters.delete(key);
    }
}
function hashIpForAiLogs(ip) {
    const normalized = (ip || "unknown").trim().toLowerCase();
    const salt = process.env.AI_CHAT_IP_HASH_SALT?.trim() || "nande-ai-chat";
    return crypto_1.default.createHash("sha256").update(`${salt}:${normalized}`).digest("hex").slice(0, 20);
}
function checkAndConsumeAiUsage({ userId, ipHash, }) {
    const now = Date.now();
    cleanupExpiredCounters(now);
    const globalLimit = readLimit("AI_CHAT_DAILY_REQUEST_LIMIT", 10_000);
    const perUserDailyLimit = readLimit("AI_CHAT_PER_USER_DAILY_LIMIT", 50);
    const perIpMinuteLimit = readLimit("AI_CHAT_PER_IP_MINUTE_LIMIT", 10);
    const dailyResetAt = nextUtcDayStart(now);
    const minuteResetAt = now + 60_000;
    const targets = [
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
        if (target.limit > 0)
            target.counter.count += 1;
    }
    return { allowed: true };
}
