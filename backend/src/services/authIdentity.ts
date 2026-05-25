import crypto from "crypto";
import net from "net";
import { Request, Response } from "express";

const DEVICE_COOKIE_NAME = "device_id";
const DEVICE_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const DEVICE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASIC_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function loadDeviceCookieSecret(): string {
  const explicit = process.env.DEVICE_COOKIE_SECRET?.trim();
  if (explicit) return explicit;

  const jwtSecret = process.env.JWT_SECRET?.trim();
  if (jwtSecret) return jwtSecret;

  if ((process.env.NODE_ENV || "").toLowerCase() === "production") {
    throw new Error("DEVICE_COOKIE_SECRET no configurado para firmar device_id.");
  }

  return "dev-device-cookie-secret-change-me";
}

function signDeviceId(deviceId: string): string {
  return crypto
    .createHmac("sha256", loadDeviceCookieSecret())
    .update(deviceId)
    .digest("hex");
}

function parseCookieHeader(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    const rawValue = part.slice(idx + 1).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(rawValue);
    } catch {
      out[name] = rawValue;
    }
  }
  return out;
}

function safeEqualHex(a: string, b: string): boolean {
  if (!/^[a-f0-9]+$/i.test(a) || !/^[a-f0-9]+$/i.test(b)) return false;
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function parseSignedDeviceCookie(raw: string | undefined): string | null {
  if (!raw) return null;
  const [deviceId, signature] = raw.split(".");
  if (!deviceId || !signature || !DEVICE_ID_RE.test(deviceId)) return null;
  return safeEqualHex(signature, signDeviceId(deviceId)) ? deviceId : null;
}

export function getOrCreateDeviceId(req: Request, res: Response): string {
  const cookies = parseCookieHeader(req.headers.cookie);
  const existing = parseSignedDeviceCookie(cookies[DEVICE_COOKIE_NAME]);
  if (existing) return existing;

  const deviceId = crypto.randomUUID();
  const value = `${deviceId}.${signDeviceId(deviceId)}`;
  res.cookie(DEVICE_COOKIE_NAME, value, {
    httpOnly: true,
    secure: (process.env.NODE_ENV || "").toLowerCase() === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DEVICE_COOKIE_MAX_AGE_MS,
  });
  return deviceId;
}

function normalizeIpCandidate(raw: string | undefined): string | null {
  const value = (raw || "").trim();
  if (!value) return null;

  const withoutMappedPrefix = value.startsWith("::ffff:") ? value.slice(7) : value;
  if (net.isIP(withoutMappedPrefix)) return withoutMappedPrefix;

  const ipv4WithPort = withoutMappedPrefix.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (ipv4WithPort?.[1] && net.isIP(ipv4WithPort[1])) return ipv4WithPort[1];

  return null;
}

export function getClientIp(req: Request): string {
  const forwardedFor = req.get("x-forwarded-for");
  if (forwardedFor) {
    for (const part of forwardedFor.split(",")) {
      const ip = normalizeIpCandidate(part);
      if (ip) return ip;
    }
  }

  return (
    normalizeIpCandidate(req.get("x-real-ip")) ||
    normalizeIpCandidate(req.ip) ||
    normalizeIpCandidate(req.socket.remoteAddress) ||
    "unknown"
  );
}

export function normalizeEmail(email: unknown): string | null {
  if (typeof email !== "string") return null;
  const normalized = email.trim().toLowerCase();
  if (!normalized || normalized.length > 254 || !BASIC_EMAIL_RE.test(normalized)) return null;
  return normalized;
}

export function hashIdentifier(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
