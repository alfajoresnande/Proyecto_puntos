import type { GroqClientDescriptor, AiPublicProvider, GroqClientSlot } from "./groqClients";
import { getConfiguredGroqClients } from "./groqClients";

type ProviderHealthState = {
  consecutiveFailures: number;
  cooldownUntil: number;
  lastStatus?: number;
  lastFailureAt?: string;
};

export type AiProviderSelection = {
  preferredProvider: AiPublicProvider;
  candidates: GroqClientDescriptor[];
};

export type AiProviderFailureResult = {
  status?: number;
  cooldownUntil?: string;
};

const providerHealth = new Map<GroqClientSlot, ProviderHealthState>();
const AUTH_COOLDOWN_MS = 30 * 60 * 1000;
const RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000;
const REPEATED_ERROR_COOLDOWN_MS = 2 * 60 * 1000;
const REPEATED_ERROR_THRESHOLD = 3;

function getState(slot: GroqClientSlot): ProviderHealthState {
  const current = providerHealth.get(slot);
  if (current) return current;

  const created: ProviderHealthState = {
    consecutiveFailures: 0,
    cooldownUntil: 0,
  };
  providerHealth.set(slot, created);
  return created;
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value);
}

function readPercentEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(0, Math.min(100, parsed));
}

function choosePreferredProvider(): AiPublicProvider {
  if (!readBooleanEnv("AI_CHAT_AB_TEST_ENABLED", false)) {
    return "primary";
  }

  const secondaryPercent = readPercentEnv("AI_CHAT_SECONDARY_PERCENT", 50);
  return Math.random() * 100 < secondaryPercent ? "secondary" : "primary";
}

function isCoolingDown(client: GroqClientDescriptor, now: number): boolean {
  return getState(client.slot).cooldownUntil > now;
}

function healthyClientsByProvider(provider: AiPublicProvider, now: number): GroqClientDescriptor[] {
  return getConfiguredGroqClients().filter(
    (client) => client.publicProvider === provider && !isCoolingDown(client, now),
  );
}

export function getAiProviderCandidates(): AiProviderSelection {
  const now = Date.now();
  const preferredProvider = choosePreferredProvider();
  const primary = healthyClientsByProvider("primary", now);
  const secondary = healthyClientsByProvider("secondary", now);

  return {
    preferredProvider,
    candidates: preferredProvider === "secondary" ? [...secondary, ...primary] : [...primary, ...secondary],
  };
}

export function getGroqErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("status" in error)) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function cooldownMsForStatus(status: number | undefined): number | null {
  if (status === 429) return RATE_LIMIT_COOLDOWN_MS;
  if (status === 401 || status === 403) return AUTH_COOLDOWN_MS;
  return null;
}

export function recordAiProviderSuccess(client: GroqClientDescriptor): void {
  const state = getState(client.slot);
  state.consecutiveFailures = 0;
  state.lastStatus = undefined;
  state.lastFailureAt = undefined;
}

export function recordAiProviderFailure(
  client: GroqClientDescriptor,
  error: unknown,
): AiProviderFailureResult {
  const state = getState(client.slot);
  const status = getGroqErrorStatus(error);
  const now = Date.now();
  state.consecutiveFailures += 1;
  state.lastStatus = status;
  state.lastFailureAt = new Date(now).toISOString();

  const statusCooldown = cooldownMsForStatus(status);
  const repeatedErrorCooldown =
    state.consecutiveFailures >= REPEATED_ERROR_THRESHOLD ? REPEATED_ERROR_COOLDOWN_MS : null;
  const cooldownMs = statusCooldown ?? repeatedErrorCooldown;

  if (cooldownMs) {
    state.cooldownUntil = Math.max(state.cooldownUntil, now + cooldownMs);
  }

  return {
    status,
    cooldownUntil: state.cooldownUntil > now ? new Date(state.cooldownUntil).toISOString() : undefined,
  };
}
