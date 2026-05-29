"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAiProviderCandidates = getAiProviderCandidates;
exports.getGroqErrorStatus = getGroqErrorStatus;
exports.recordAiProviderSuccess = recordAiProviderSuccess;
exports.recordAiProviderFailure = recordAiProviderFailure;
const groqClients_1 = require("./groqClients");
const providerHealth = new Map();
const AUTH_COOLDOWN_MS = 30 * 60 * 1000;
const RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000;
const REPEATED_ERROR_COOLDOWN_MS = 2 * 60 * 1000;
const REPEATED_ERROR_THRESHOLD = 3;
function getState(slot) {
    const current = providerHealth.get(slot);
    if (current)
        return current;
    const created = {
        consecutiveFailures: 0,
        cooldownUntil: 0,
    };
    providerHealth.set(slot, created);
    return created;
}
function readBooleanEnv(name, fallback) {
    const value = process.env[name]?.trim().toLowerCase();
    if (!value)
        return fallback;
    return ["1", "true", "yes", "on"].includes(value);
}
function readPercentEnv(name, fallback) {
    const parsed = Number.parseInt(process.env[name] ?? "", 10);
    if (!Number.isInteger(parsed))
        return fallback;
    return Math.max(0, Math.min(100, parsed));
}
function choosePreferredProvider() {
    if (!readBooleanEnv("AI_CHAT_AB_TEST_ENABLED", false)) {
        return "primary";
    }
    const secondaryPercent = readPercentEnv("AI_CHAT_SECONDARY_PERCENT", 50);
    return Math.random() * 100 < secondaryPercent ? "secondary" : "primary";
}
function isCoolingDown(client, now) {
    return getState(client.slot).cooldownUntil > now;
}
function healthyClientsByProvider(provider, now) {
    return (0, groqClients_1.getConfiguredGroqClients)().filter((client) => client.publicProvider === provider && !isCoolingDown(client, now));
}
function getAiProviderCandidates() {
    const now = Date.now();
    const preferredProvider = choosePreferredProvider();
    const primary = healthyClientsByProvider("primary", now);
    const secondary = healthyClientsByProvider("secondary", now);
    return {
        preferredProvider,
        candidates: preferredProvider === "secondary" ? [...secondary, ...primary] : [...primary, ...secondary],
    };
}
function getGroqErrorStatus(error) {
    if (!error || typeof error !== "object" || !("status" in error))
        return undefined;
    const status = error.status;
    return typeof status === "number" ? status : undefined;
}
function cooldownMsForStatus(status) {
    if (status === 429)
        return RATE_LIMIT_COOLDOWN_MS;
    if (status === 401 || status === 403)
        return AUTH_COOLDOWN_MS;
    return null;
}
function recordAiProviderSuccess(client) {
    const state = getState(client.slot);
    state.consecutiveFailures = 0;
    state.lastStatus = undefined;
    state.lastFailureAt = undefined;
}
function recordAiProviderFailure(client, error) {
    const state = getState(client.slot);
    const status = getGroqErrorStatus(error);
    const now = Date.now();
    state.consecutiveFailures += 1;
    state.lastStatus = status;
    state.lastFailureAt = new Date(now).toISOString();
    const statusCooldown = cooldownMsForStatus(status);
    const repeatedErrorCooldown = state.consecutiveFailures >= REPEATED_ERROR_THRESHOLD ? REPEATED_ERROR_COOLDOWN_MS : null;
    const cooldownMs = statusCooldown ?? repeatedErrorCooldown;
    if (cooldownMs) {
        state.cooldownUntil = Math.max(state.cooldownUntil, now + cooldownMs);
    }
    return {
        status,
        cooldownUntil: state.cooldownUntil > now ? new Date(state.cooldownUntil).toISOString() : undefined,
    };
}
