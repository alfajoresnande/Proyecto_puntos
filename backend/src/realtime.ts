import type { Server as HttpServer, IncomingMessage } from "http";
import { WebSocket, WebSocketServer } from "ws";
import jwt from "jsonwebtoken";
import { JWT_SECRET, type TokenPayload } from "./auth";

type RealtimeClientRole = TokenPayload["rol"] | "guest";

type RealtimeClient = {
  socket: WebSocket;
  role: RealtimeClientRole;
  userId: number | null;
};

type RealtimeEventMessage = {
  type: "event";
  topics: string[];
  ts: string;
};

function getOriginFromRequest(req: IncomingMessage): string | null {
  const origin = req.headers.origin;
  if (!origin) return null;
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

function parseCookieHeader(header: string | string[] | undefined): Record<string, string> {
  const raw = Array.isArray(header) ? header.join(";") : header;
  if (!raw) return {};
  return raw.split(";").reduce<Record<string, string>>((acc, pair) => {
    const idx = pair.indexOf("=");
    if (idx <= 0) return acc;
    const key = pair.slice(0, idx).trim();
    if (!key) return acc;
    const value = pair.slice(idx + 1).trim();
    acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
}

function getTokenFromUpgrade(req: IncomingMessage): string | null {
  const host = req.headers.host ?? "localhost";
  const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
  const url = new URL(req.url ?? "/", `${protocol}://${host}`);
  const tokenFromQuery = url.searchParams.get("token");
  if (tokenFromQuery) return tokenFromQuery;

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  const authCookieName = process.env.AUTH_COOKIE_NAME || "auth_token";
  const cookies = parseCookieHeader(req.headers.cookie);
  return cookies[authCookieName] || null;
}

function getClientAuth(req: IncomingMessage): { role: RealtimeClientRole; userId: number | null } {
  const token = getTokenFromUpgrade(req);
  if (!token) {
    return { role: "guest", userId: null };
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as TokenPayload;
    return { role: payload.rol, userId: payload.id };
  } catch {
    return { role: "guest", userId: null };
  }
}

const clients = new Set<RealtimeClient>();

export function attachRealtimeServer(server: HttpServer, allowedOrigins: Set<string>) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 64 * 1024,
    perMessageDeflate: false,
  });

  server.on("upgrade", (req, socket, head) => {
    if (!req.url?.startsWith("/api/realtime")) {
      socket.destroy();
      return;
    }

    const origin = getOriginFromRequest(req);
    if (origin && !allowedOrigins.has(origin)) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      const auth = getClientAuth(req);
      const client: RealtimeClient = {
        socket: ws,
        role: auth.role,
        userId: auth.userId,
      };

      clients.add(client);
      ws.send(
        JSON.stringify({
          type: "hello",
          role: client.role,
          ts: new Date().toISOString(),
        }),
      );

      ws.on("close", () => {
        clients.delete(client);
      });

      ws.on("error", () => {
        clients.delete(client);
      });
    });
  });

  return wss;
}

export function emitRealtime(topics: string[]) {
  const uniqueTopics = Array.from(new Set(topics.filter(Boolean)));
  if (!uniqueTopics.length) return;

  const message: RealtimeEventMessage = {
    type: "event",
    topics: uniqueTopics,
    ts: new Date().toISOString(),
  };
  const payload = JSON.stringify(message);

  for (const client of clients) {
    if (client.socket.readyState !== WebSocket.OPEN) continue;
    client.socket.send(payload);
  }
}
