import { useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { apiUrl } from "../lib/apiBase";
import { getCsrfToken } from "../lib/csrf";
import { useAuthStore } from "../store/authStore";

const HEARTBEAT_INTERVAL_MS = 30 * 60 * 1000;
const DUPLICATE_GUARD_MS = 5000;
const PRESENCE_SESSION_STORAGE_KEY = "nande.app.presence.session";

let lastHeartbeatFingerprint = "";
let lastHeartbeatAt = 0;

function isStaffRole(role: string | null | undefined): boolean {
  return role === "admin" || role === "superAdmin" || role === "vendedor";
}

function shouldTrackPath(pathname: string): boolean {
  return !pathname.startsWith("/admin")
    && !pathname.startsWith("/superadmin")
    && !pathname.startsWith("/vendedor")
    && !pathname.startsWith("/staff");
}

function makePresenceSessionId(): string {
  if (typeof window === "undefined") return "server-session";

  try {
    const existing = window.sessionStorage.getItem(PRESENCE_SESSION_STORAGE_KEY);
    if (existing) return existing;

    const nextValue = window.crypto?.randomUUID?.()
      ?? `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

    window.sessionStorage.setItem(PRESENCE_SESSION_STORAGE_KEY, nextValue);
    return nextValue;
  } catch {
    return window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

function sendPresenceHeartbeat(sessionId: string, path: string, identityKey: string, keepalive = false) {
  if (typeof window === "undefined") return;

  const now = Date.now();
  const fingerprint = `${sessionId}|${identityKey}|${path}`;
  if (lastHeartbeatFingerprint === fingerprint && now - lastHeartbeatAt < DUPLICATE_GUARD_MS) {
    return;
  }

  lastHeartbeatFingerprint = fingerprint;
  lastHeartbeatAt = now;

  void fetch(apiUrl("/api/presencia/heartbeat"), {
    method: "POST",
    credentials: "include",
    keepalive,
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": getCsrfToken(),
    },
    body: JSON.stringify({
      session_id: sessionId,
      path,
      page_title: document.title || null,
      referrer: document.referrer || null,
    }),
  }).catch(() => undefined);
}

export function AppPresenceTracker() {
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const isRestoringSession = useAuthStore((state) => state.isRestoringSession);
  const hasRestoredSession = useAuthStore((state) => state.hasRestoredSession);
  const sessionId = useMemo(() => makePresenceSessionId(), []);
  const path = `${location.pathname}${location.search}`;
  const identityKey = user?.rol === "cliente" ? `cliente:${user.id}` : "anonimo";
  const trackingEnabled = hasRestoredSession && !isRestoringSession && !isStaffRole(user?.rol) && shouldTrackPath(location.pathname);

  useEffect(() => {
    if (!trackingEnabled) return;
    sendPresenceHeartbeat(sessionId, path, identityKey);
  }, [identityKey, path, sessionId, trackingEnabled]);

  useEffect(() => {
    if (!trackingEnabled) return;

    const intervalId = window.setInterval(() => {
      sendPresenceHeartbeat(sessionId, path, identityKey);
    }, HEARTBEAT_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [identityKey, path, sessionId, trackingEnabled]);

  useEffect(() => {
    if (!trackingEnabled) return;

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        sendPresenceHeartbeat(sessionId, path, identityKey);
      }
    }

    function onPageHide() {
      sendPresenceHeartbeat(sessionId, path, identityKey, true);
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [identityKey, path, sessionId, trackingEnabled]);

  return null;
}
