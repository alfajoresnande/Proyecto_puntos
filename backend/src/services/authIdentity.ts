import crypto from "crypto";
import net from "net";
import { Request, Response } from "express";
import { resolveCookiePolicy } from "../authCookie";

const authCookiePolicy = resolveCookiePolicy();

const DEVICE_COOKIE_NAME = "device_id";
const DEVICE_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const DEVICE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASIC_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DEVICE_SECRET_INFO = "nande/device-id-cookie/v1";

let deviceSecretWarned = false;

/**
 * Clave para firmar `device_id`, SEPARADA de JWT_SECRET (SEC-09).
 *
 * Si no hay DEVICE_COOKIE_SECRET propia, se deriva una con HKDF a partir de
 * JWT_SECRET en vez de reutilizarlo tal cual: la clave resultante es distinta
 * y no permite reusar firmas entre los dos usos. No se aborta el arranque
 * porque una cookie de device_id invalida solo reinicia contadores de rate
 * limiting, no rompe la sesion.
 */
function loadDeviceCookieSecret(): Buffer {
  const explicit = process.env.DEVICE_COOKIE_SECRET?.trim();
  if (explicit) return Buffer.from(explicit, "utf8");

  const jwtSecret = process.env.JWT_SECRET?.trim();
  if (jwtSecret) {
    if (!deviceSecretWarned) {
      deviceSecretWarned = true;
      console.warn(
        "[auth] DEVICE_COOKIE_SECRET no configurado: se deriva una clave propia desde JWT_SECRET. " +
          "Configura DEVICE_COOKIE_SECRET con un valor aleatorio distinto para separar las claves.",
      );
    }
    return Buffer.from(
      crypto.hkdfSync("sha256", Buffer.from(jwtSecret, "utf8"), Buffer.alloc(0), Buffer.from(DEVICE_SECRET_INFO), 32),
    );
  }

  if ((process.env.NODE_ENV || "").toLowerCase() === "production") {
    throw new Error("DEVICE_COOKIE_SECRET no configurado para firmar device_id.");
  }

  return Buffer.from("dev-device-cookie-secret-change-me", "utf8");
}

let cachedDeviceSecret: Buffer | null = null;

function deviceCookieSecret(): Buffer {
  if (!cachedDeviceSecret) cachedDeviceSecret = loadDeviceCookieSecret();
  return cachedDeviceSecret;
}

function signDeviceId(deviceId: string): string {
  return crypto
    .createHmac("sha256", deviceCookieSecret())
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
  // Misma politica de Secure/SameSite que la cookie de sesion, para que en un
  // despliegue cross-site el navegador tampoco descarte esta.
  res.cookie(DEVICE_COOKIE_NAME, value, {
    httpOnly: true,
    secure: authCookiePolicy.secure,
    sameSite: authCookiePolicy.sameSite,
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
  // Express calcula req.ip usando TRUST_PROXY. Leer X-Forwarded-For a mano
  // permitiria que un cliente directo falsifique la IP y eluda los limites.
  return (
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
