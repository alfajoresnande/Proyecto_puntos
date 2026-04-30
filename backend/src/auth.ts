import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";

export type Rol = "cliente" | "vendedor" | "admin";
export interface TokenPayload {
  id: number;
  rol: Rol;
  email: string;
}

const WEAK_SECRETS = new Set(["dev-secret-cambialo", "cambia-esto-en-produccion"]);
const MIN_SECRET_LENGTH = 64;
const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || "auth_token";

function loadJwtSecret(): string {
  const value = process.env.JWT_SECRET;
  if (!value) {
    throw new Error(
      "JWT_SECRET no configurado. Genera uno con: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\" y pegalo en backend/.env",
    );
  }
  if (WEAK_SECRETS.has(value)) {
    throw new Error("JWT_SECRET usa un valor por defecto conocido. Reemplazalo en backend/.env por un secret aleatorio.");
  }
  if (value.length < MIN_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET demasiado corto (${value.length}). Minimo ${MIN_SECRET_LENGTH} caracteres.`);
  }
  return value;
}

function normalizeSameSite(raw: string | undefined): "lax" | "strict" | "none" {
  const value = (raw || "lax").trim().toLowerCase();
  if (value === "strict" || value === "none") return value;
  return "lax";
}

function shouldUseSecureCookies(): boolean {
  const raw = process.env.AUTH_COOKIE_SECURE;
  if (raw !== undefined) {
    return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
  }
  return process.env.NODE_ENV === "production";
}

function parseCookieHeader(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const pairs = header.split(";");
  const out: Record<string, string> = {};
  for (const pair of pairs) {
    const idx = pair.indexOf("=");
    if (idx <= 0) continue;
    const key = pair.slice(0, idx).trim();
    if (!key) continue;
    const rawValue = pair.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(rawValue);
    } catch {
      out[key] = rawValue;
    }
  }
  return out;
}

function getTokenFromRequest(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    return header.slice(7);
  }

  const cookies = parseCookieHeader(req.headers.cookie);
  return cookies[AUTH_COOKIE_NAME] || null;
}

export const JWT_SECRET = loadJwtSecret();

export function signToken(payload: TokenPayload): string {
  const expiresIn = payload.rol === "admin" || payload.rol === "vendedor" ? "1d" : "7d";
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

export function getAuthPayload(req: Request): TokenPayload | null {
  const token = getTokenFromRequest(req);
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch {
    return null;
  }
}

export function setAuthCookie(res: Response, token: string) {
  const sameSite = normalizeSameSite(process.env.AUTH_COOKIE_SAMESITE);
  const secure = shouldUseSecureCookies();
  const maxAgeMs = process.env.AUTH_COOKIE_MAX_AGE_MS ? Number(process.env.AUTH_COOKIE_MAX_AGE_MS) : 7 * 24 * 60 * 60 * 1000;

  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure,
    sameSite,
    path: "/",
    maxAge: Number.isFinite(maxAgeMs) ? maxAgeMs : 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookie(res: Response) {
  const sameSite = normalizeSameSite(process.env.AUTH_COOKIE_SAMESITE);
  const secure = shouldUseSecureCookies();

  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure,
    sameSite,
    path: "/",
  });
}

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const payload = getAuthPayload(req);
  if (!payload) {
    return res.status(401).json({ error: "Token requerido" });
  }
  req.user = payload;
  next();
}

export function requireRole(...roles: Rol[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.rol)) {
      return res.status(403).json({ error: "No autorizado" });
    }
    next();
  };
}
