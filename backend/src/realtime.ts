import type { Server as HttpServer, IncomingMessage } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { authCookiePolicy, verifyToken, type TokenPayload } from "./auth";
import { readTokenFromCookies } from "./authCookie";

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

/**
 * El token del WebSocket sale SOLO de la cookie HttpOnly (SEC-03).
 *
 * Antes se aceptaba `?token=<JWT>` en la URL del upgrade: esa URL termina en
 * los logs de cualquier proxy u observabilidad que haya en el camino.
 */
function getTokenFromUpgrade(req: IncomingMessage): string | null {
  return readTokenFromCookies(req.headers.cookie, authCookiePolicy);
}

function getClientAuth(req: IncomingMessage): { role: RealtimeClientRole; userId: number | null } {
  const token = getTokenFromUpgrade(req);
  if (!token) {
    return { role: "guest", userId: null };
  }

  const payload: TokenPayload | null = verifyToken(token);
  if (!payload) {
    return { role: "guest", userId: null };
  }
  return { role: payload.rol, userId: payload.id };
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
