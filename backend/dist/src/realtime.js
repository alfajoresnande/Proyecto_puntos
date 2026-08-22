"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachRealtimeServer = attachRealtimeServer;
exports.emitRealtime = emitRealtime;
const ws_1 = require("ws");
const auth_1 = require("./auth");
const authCookie_1 = require("./authCookie");
function getOriginFromRequest(req) {
    const origin = req.headers.origin;
    if (!origin)
        return null;
    try {
        return new URL(origin).origin;
    }
    catch {
        return null;
    }
}
/**
 * El token del WebSocket sale SOLO de la cookie HttpOnly (SEC-03).
 *
 * Antes se aceptaba `?token=<JWT>` en la URL del upgrade: esa URL termina en
 * los logs de cualquier proxy u observabilidad que haya en el camino.
 */
function getTokenFromUpgrade(req) {
    return (0, authCookie_1.readTokenFromCookies)(req.headers.cookie, auth_1.authCookiePolicy);
}
function getClientAuth(req) {
    const token = getTokenFromUpgrade(req);
    if (!token) {
        return { role: "guest", userId: null };
    }
    const payload = (0, auth_1.verifyToken)(token);
    if (!payload) {
        return { role: "guest", userId: null };
    }
    return { role: payload.rol, userId: payload.id };
}
const clients = new Set();
function attachRealtimeServer(server, allowedOrigins) {
    const wss = new ws_1.WebSocketServer({
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
            const client = {
                socket: ws,
                role: auth.role,
                userId: auth.userId,
            };
            clients.add(client);
            ws.send(JSON.stringify({
                type: "hello",
                role: client.role,
                ts: new Date().toISOString(),
            }));
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
function emitRealtime(topics) {
    const uniqueTopics = Array.from(new Set(topics.filter(Boolean)));
    if (!uniqueTopics.length)
        return;
    const message = {
        type: "event",
        topics: uniqueTopics,
        ts: new Date().toISOString(),
    };
    const payload = JSON.stringify(message);
    for (const client of clients) {
        if (client.socket.readyState !== ws_1.WebSocket.OPEN)
            continue;
        client.socket.send(payload);
    }
}
