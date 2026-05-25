import { useCallback, useEffect, useState } from "react";

type ErrorBody = {
  error?: unknown;
  retryAfterSeconds?: unknown;
};

export type RetryAfterError = Error & {
  retryAfterSeconds?: number;
};

export function createApiError(body: unknown, fallback: string): RetryAfterError {
  const payload = body && typeof body === "object" ? (body as ErrorBody) : {};
  const message = typeof payload.error === "string" ? payload.error : fallback;
  const error = new Error(message) as RetryAfterError;
  const retryAfterSeconds = Number(payload.retryAfterSeconds ?? 0);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    error.retryAfterSeconds = Math.ceil(retryAfterSeconds);
  }
  return error;
}

export function getRetryAfterSeconds(error: unknown): number {
  const value = (error as RetryAfterError | null)?.retryAfterSeconds;
  return Number.isFinite(value) && value ? Math.max(1, Math.ceil(value)) : 0;
}

export function formatRetryAfter(seconds: number): string {
  const safeSeconds = Math.max(0, Math.ceil(seconds));
  if (safeSeconds < 60) return `${safeSeconds} segundo${safeSeconds === 1 ? "" : "s"}`;
  const minutes = Math.max(1, Math.ceil(safeSeconds / 60));
  return `${minutes} minuto${minutes === 1 ? "" : "s"}`;
}

export function useRetryAfterCooldown() {
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!cooldownUntil) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);

  const cooldownSeconds = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));

  useEffect(() => {
    if (cooldownUntil && cooldownSeconds <= 0) {
      setCooldownUntil(0);
    }
  }, [cooldownSeconds, cooldownUntil]);

  const startCooldownFromError = useCallback((error: unknown) => {
    const seconds = getRetryAfterSeconds(error);
    if (!seconds) return false;
    const current = Date.now();
    setNow(current);
    setCooldownUntil(current + seconds * 1000);
    return true;
  }, []);

  const cooldownMessage = cooldownSeconds
    ? `Demasiados intentos. Proba nuevamente en ${formatRetryAfter(cooldownSeconds)}.`
    : "";

  return { cooldownSeconds, cooldownMessage, startCooldownFromError };
}
