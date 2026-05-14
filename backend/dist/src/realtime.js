"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachRealtimeServer = attachRealtimeServer;
exports.emitRealtime = emitRealtime;
const ws_1 = require("ws");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const auth_1 = require("./auth");
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
function parseCookieHeader(header) {
    const raw = Array.isArray(header) ? header.join(";") : header;
    if (!raw)
        return {};
    return raw.split(";").reduce((acc, pair) => {
        const idx = pair.indexOf("=");
        if (idx <= 0)
            return acc;
        const key = pair.slice(0, idx).trim();
        if (!key)
            return acc;
        const value = pair.slice(idx + 1).trim();
        acc[key] = decodeURIComponent(value);
        return acc;
    }, {});
}
function getTokenFromUpgrade(req) {
    const host = req.headers.host ?? "localhost";
    const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
    const url = new URL(req.url ?? "/", `${protocol}://${host}`);
    const tokenFromQuery = url.searchParams.get("token");
    if (tokenFromQuery)
        return tokenFromQuery;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
        return authHeader.slice(7);
    }
    const authCookieName = process.env.AUTH_COOKIE_NAME || "auth_token";
    const cookies = parseCookieHeader(req.headers.cookie);
    return cookies[authCookieName] || null;
}
function getClientAuth(req) {
    const token = getTokenFromUpgrade(req);
    if (!token) {
        return { role: "guest", userId: null };
    }
    try {
        const payload = jsonwebtoken_1.default.verify(token, auth_1.JWT_SECRET);
        return { role: payload.rol, userId: payload.id };
    }
    catch {
        return { role: "guest", userId: null };
    }
}
const clients = new Set();
function attachRealtimeServer(server, allowedOrigins) {
    const wss = new ws_1.WebSocketServer({ noServer: true });
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
