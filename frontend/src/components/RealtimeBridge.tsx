import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { API_BASE_URL } from "../lib/apiBase";
import { useAuthStore } from "../store/authStore";
import { useToast } from "./ToastProvider";

type RealtimeEvent = {
  type: "event";
  topics: string[];
  ts: string;
};

type StaffRole = "vendedor" | "admin" | "superAdmin";

type StaffOrderAlert = {
  id: number;
  cliente_nombre?: string | null;
};

const ADMIN_ALERT_ORDER_IDS_KEY = "admin_alert_known_ordenes_v1";
const VENDEDOR_ALERT_ORDER_IDS_KEY = "vendedor_alert_known_ordenes_v1";

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

function isStaffRole(role: string | undefined): role is StaffRole {
  return role === "vendedor" || role === "admin" || role === "superAdmin";
}

function getStaffOrdersEndpoint(role: StaffRole): string {
  return role === "vendedor" ? "/vendedor/ordenes" : "/admin/ordenes";
}

function getStaffOrdersPath(role: StaffRole): string {
  if (role === "vendedor") return "/vendedor/ventas/pedidos";
  if (role === "superAdmin") return "/superadmin/ventas/pedidos";
  return "/admin/ventas/pedidos";
}

function getStaffOrderIdsKey(role: StaffRole): string {
  return role === "vendedor" ? VENDEDOR_ALERT_ORDER_IDS_KEY : ADMIN_ALERT_ORDER_IDS_KEY;
}

function readStoredOrderIds(key: string): number[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0);
  } catch {
    return [];
  }
}

function hasStoredOrderIds(key: string): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(key) !== null;
}

function writeStoredOrderIds(key: string, ids: number[]) {
  if (typeof window === "undefined") return;
  const uniqueIds = Array.from(new Set(ids.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)));
  window.localStorage.setItem(key, JSON.stringify(uniqueIds.slice(0, 250)));
}

export function RealtimeBridge() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const token = useAuthStore((state) => state.token);
  const userRole = useAuthStore((state) => state.user?.rol);
  const isRestoringSession = useAuthStore((state) => state.isRestoringSession);
  const hasRestoredSession = useAuthStore((state) => state.hasRestoredSession);
  const reconnectTimerRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);
  const topicsBufferRef = useRef<Set<string>>(new Set());
  const flushTimerRef = useRef<number | null>(null);
  const staffOrdersCheckPendingRef = useRef(false);

  const syncStaffOrderAlerts = useCallback(
    async (notify: boolean) => {
      if (!isStaffRole(userRole)) return;
      if (staffOrdersCheckPendingRef.current) return;

      staffOrdersCheckPendingRef.current = true;
      try {
        const orders = await api.get<StaffOrderAlert[]>(getStaffOrdersEndpoint(userRole));
        const storageKey = getStaffOrderIdsKey(userRole);
        const currentIds = orders.map((order) => Number(order.id)).filter((id) => Number.isInteger(id) && id > 0);
        const hadStoredIds = hasStoredOrderIds(storageKey);
        const knownIds = readStoredOrderIds(storageKey);
        const knownSet = new Set(knownIds);
        const nuevas = hadStoredIds ? orders.filter((order) => !knownSet.has(Number(order.id))) : [];

        writeStoredOrderIds(storageKey, [...currentIds, ...knownIds]);
        if (!notify || !hadStoredIds || nuevas.length === 0) return;

        const latest = nuevas[0];
        const targetPath = getStaffOrdersPath(userRole);
        const clienteNombre = latest.cliente_nombre?.trim() || "Un cliente";

        showToast({
          tone: "info",
          title: nuevas.length === 1 ? `Nueva compra #${latest.id}` : `${nuevas.length} compras nuevas`,
          message: nuevas.length === 1
            ? `${clienteNombre} hizo una compra. Toca para verla.`
            : "Toca para revisar los pedidos.",
          actionLabel: nuevas.length === 1 ? "Ver pedido" : "Ver pedidos",
          onClick: () => navigate(targetPath),
          onAction: () => navigate(targetPath),
          persistent: true,
        });
      } catch {
        // Las alertas no deben romper la sincronizacion en tiempo real.
      } finally {
        staffOrdersCheckPendingRef.current = false;
      }
    },
    [navigate, showToast, userRole],
  );

  useEffect(() => {
    if (!hasRestoredSession || isRestoringSession || !isStaffRole(userRole)) return;
    void syncStaffOrderAlerts(false);
  }, [hasRestoredSession, isRestoringSession, syncStaffOrderAlerts, userRole]);

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
        void syncStaffOrderAlerts(true);
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
  }, [hasRestoredSession, isRestoringSession, queryClient, syncStaffOrderAlerts, token]);

  return null;
}
