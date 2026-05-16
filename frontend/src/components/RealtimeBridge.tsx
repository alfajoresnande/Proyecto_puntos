import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { API_BASE_URL } from "../lib/apiBase";
import { useAuthStore } from "../store/authStore";

type RealtimeEvent = {
  type: "event";
  topics: string[];
  ts: string;
};

function getRealtimeUrl(token: string | null): string {
  const base = API_BASE_URL || window.location.origin;
  const url = new URL(base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/api/realtime";
  url.search = "";
  if (token) {
    url.searchParams.set("token", token);
  }
  return url.toString();
}

export function RealtimeBridge() {
  const queryClient = useQueryClient();
  const token = useAuthStore((state) => state.token);
  const isRestoringSession = useAuthStore((state) => state.isRestoringSession);
  const hasRestoredSession = useAuthStore((state) => state.hasRestoredSession);
  const reconnectTimerRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);
  const topicsBufferRef = useRef<Set<string>>(new Set());
  const flushTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!hasRestoredSession || isRestoringSession) return;

    let socket: WebSocket | null = null;
    let closedManually = false;

    function invalidateTopic(topic: string) {
      if (topic === "support") {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: ["soporte"] }),
          queryClient.invalidateQueries({ queryKey: ["navbar", "support-unread"] }),
        ]);
        return;
      }

      if (topic === "productos") {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: ["productos"] }),
          queryClient.invalidateQueries({ queryKey: ["home", "productos"] }),
          queryClient.invalidateQueries({ queryKey: ["admin", "productos"] }),
          queryClient.invalidateQueries({ queryKey: ["vendedor", "productos"] }),
          queryClient.invalidateQueries({ queryKey: ["cliente", "carrito-online"] }),
        ]);
        return;
      }

      if (topic === "inventario") {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: ["admin", "inventario"] }),
          queryClient.invalidateQueries({ queryKey: ["admin", "movimientos-stock"] }),
          queryClient.invalidateQueries({ queryKey: ["productos"] }),
          queryClient.invalidateQueries({ queryKey: ["home", "productos"] }),
          queryClient.invalidateQueries({ queryKey: ["vendedor", "productos"] }),
          queryClient.invalidateQueries({ queryKey: ["cliente", "carrito-online"] }),
        ]);
        return;
      }

      if (topic === "categorias") {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: ["productos", "categorias"] }),
          queryClient.invalidateQueries({ queryKey: ["admin", "categorias"] }),
        ]);
        return;
      }

      if (topic === "sucursales") {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: ["productos", "sucursales"] }),
          queryClient.invalidateQueries({ queryKey: ["cliente", "sucursales-retiro"] }),
          queryClient.invalidateQueries({ queryKey: ["admin", "sucursales"] }),
        ]);
        return;
      }

      if (topic === "ordenes") {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: ["admin", "ordenes"] }),
          queryClient.invalidateQueries({ queryKey: ["vendedor", "ordenes"] }),
          queryClient.invalidateQueries({ queryKey: ["cliente", "ordenes"] }),
          queryClient.invalidateQueries({ queryKey: ["cliente", "orden-payment-status"] }),
          queryClient.invalidateQueries({ queryKey: ["admin", "stats"] }),
          queryClient.invalidateQueries({ queryKey: ["navbar", "staff-orders-alert"] }),
        ]);
        return;
      }

      if (topic === "canjes") {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: ["admin", "canjes"] }),
          queryClient.invalidateQueries({ queryKey: ["cliente", "canjes"] }),
          queryClient.invalidateQueries({ queryKey: ["cliente", "perfil"] }),
          queryClient.invalidateQueries({ queryKey: ["cliente", "movimientos"] }),
          queryClient.invalidateQueries({ queryKey: ["admin", "stats"] }),
        ]);
        return;
      }

      if (topic === "puntos") {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: ["cliente", "perfil"] }),
          queryClient.invalidateQueries({ queryKey: ["cliente", "movimientos"] }),
          queryClient.invalidateQueries({ queryKey: ["admin", "movimientos"] }),
          queryClient.invalidateQueries({ queryKey: ["admin", "stats"] }),
        ]);
        return;
      }

      if (topic === "paginas") {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: ["paginas"] }),
          queryClient.invalidateQueries({ queryKey: ["admin", "paginas"] }),
        ]);
        return;
      }

      if (topic === "admin-config") {
        void queryClient.invalidateQueries({ queryKey: ["admin", "configuracion"] });
      }
    }

    function flushBufferedTopics() {
      flushTimerRef.current = null;
      const topics = Array.from(topicsBufferRef.current);
      topicsBufferRef.current.clear();
      topics.forEach(invalidateTopic);
    }

    function queueTopics(topics: string[]) {
      topics.forEach((topic) => topicsBufferRef.current.add(topic));
      if (flushTimerRef.current !== null) return;
      flushTimerRef.current = window.setTimeout(flushBufferedTopics, 120);
    }

    function connect() {
      if (navigator.onLine === false) return;
      socket = new WebSocket(getRealtimeUrl(token));

      socket.addEventListener("open", () => {
        retryCountRef.current = 0;
      });

      socket.addEventListener("message", (event) => {
        try {
          const payload = JSON.parse(event.data) as RealtimeEvent | { type: string };
          if (payload.type !== "event" || !("topics" in payload) || !Array.isArray(payload.topics)) return;
          queueTopics(payload.topics);
        } catch {
          // ignore malformed messages
        }
      });

      socket.addEventListener("close", () => {
        socket = null;
        if (closedManually) return;
        if (navigator.onLine === false) return;
        const nextDelay = Math.min(1000 * 2 ** retryCountRef.current, 15000);
        retryCountRef.current += 1;
        reconnectTimerRef.current = window.setTimeout(connect, nextDelay);
      });
    }

    function reconnectAfterOnline() {
      if (socket || closedManually) return;
      retryCountRef.current = 0;
      connect();
    }

    window.addEventListener("online", reconnectAfterOnline);
    connect();

    return () => {
      closedManually = true;
      window.removeEventListener("online", reconnectAfterOnline);
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
      }
      topicsBufferRef.current.clear();
      socket?.close();
    };
  }, [hasRestoredSession, isRestoringSession, queryClient, token]);

  return null;
}
