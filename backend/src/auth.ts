import { randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";
import {
  applyAuthCookie,
  clearAuthCookies,
  readTokenFromCookies,
  resolveCookiePolicy,
  validarPoliticaCookie,
  type CookiePolicy,
} from "./authCookie";

export type Rol = "cliente" | "vendedor" | "admin" | "superAdmin";

export interface TokenPayload {
  id: number;
  rol: Rol;
  email: string;
  /** Version de sesion del usuario. Ver services/sessionRevocation.ts. */
  tv?: number;
  jti?: string;
  iss?: string;
  aud?: string;
  exp?: number;
}

const WEAK_SECRETS = new Set(["dev-secret-cambialo", "cambia-esto-en-produccion"]);
const MIN_SECRET_LENGTH = 64;

const JWT_ALGORITHM = "HS256" as const;
export const JWT_ISSUER = (process.env.JWT_ISSUER || "nande-puntos-api").trim();
export const JWT_AUDIENCE = (process.env.JWT_AUDIENCE || "nande-puntos-web").trim();

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

export const JWT_SECRET = loadJwtSecret();

export const authCookiePolicy: CookiePolicy = resolveCookiePolicy();

/**
 * En produccion no se arranca con cookies inseguras: una cookie de sesion sin
 * `Secure` viaja en claro y anula todo lo demas (SEC-09).
 */
const problemasCookie = validarPoliticaCookie(authCookiePolicy);
if (problemasCookie.length) {
  const detalle = problemasCookie.map((p) => `- ${p.message}`).join("\n");
  throw new Error(`Configuracion de cookies de sesion invalida:\n${detalle}`);
}

/**
 * El token ya NO se acepta por header Authorization desde el navegador.
 * Solo se lee de la cookie HttpOnly, que es lo que el JavaScript de la
 * pagina no puede tocar (SEC-03).
 */
function getTokenFromRequest(req: Request): string | null {
  return readTokenFromCookies(req.headers.cookie, authCookiePolicy);
}

/** TTL corto para staff; el cliente mantiene una sesion mas larga. */
function tokenTtl(rol: Rol): "8h" | "7d" {
  return rol === "admin" || rol === "superAdmin" || rol === "vendedor" ? "8h" : "7d";
}

export function signToken(payload: TokenPayload): string {
  const { id, rol, email, tv } = payload;
  return jwt.sign({ id, rol, email, tv: tv ?? 0 }, JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
    expiresIn: tokenTtl(rol),
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    jwtid: randomUUID(),
  });
}

/**
 * Verifica firma y claims del JWT. NO comprueba estado en base: para eso esta
 * `requireAuth` / `resolveVerifiedUser`, que consultan rol, activo y
 * token_version actuales.
 */
export function getAuthPayload(req: Request): TokenPayload | null {
  const token = getTokenFromRequest(req);
  if (!token) return null;
  return verifyToken(token);
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET, {
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }) as TokenPayload;
  } catch {
    return null;
  }
}

export function setAuthCookie(res: Response, token: string) {
  applyAuthCookie(res, token, authCookiePolicy);
}

export function clearAuthCookie(res: Response) {
  clearAuthCookies(res, authCookiePolicy);
}

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

export type ResultadoAutenticacion =
  | { ok: true; user: TokenPayload }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Autenticacion completa: firma valida + cuenta vigente en base.
 *
 * El rol que queda en `req.user` sale SIEMPRE de la base, nunca del JWT: un
 * token viejo de un usuario degradado no puede seguir actuando como admin.
 */
export async function resolveVerifiedUser(req: Request): Promise<ResultadoAutenticacion> {
  const payload = getAuthPayload(req);
  if (!payload) {
    return { ok: false, status: 401, error: "Token requerido" };
  }

  // Import diferido: sessionRevocation depende de db.ts y db.ts no debe
  // cargarse al importar auth.ts (los tests unitarios lo agradecen).
  const { cargarCuentaVigente, estaRevocadoElJti } = await import("./services/sessionRevocation");

  const cuenta = await cargarCuentaVigente(payload.id);
  if (!cuenta) {
    return { ok: false, status: 401, error: "Sesion invalida" };
  }
  if (!cuenta.activo) {
    return { ok: false, status: 403, error: "Cuenta deshabilitada" };
  }
  if (Number(payload.tv ?? 0) !== cuenta.tokenVersion) {
    return { ok: false, status: 401, error: "Sesion expirada. Inicia sesion nuevamente." };
  }
  if (payload.jti && (await estaRevocadoElJti(payload.jti))) {
    return { ok: false, status: 401, error: "Sesion cerrada" };
  }

  return {
    ok: true,
    user: {
      id: cuenta.id,
      email: cuenta.email,
      rol: cuenta.rol,
      tv: cuenta.tokenVersion,
      jti: payload.jti,
      exp: payload.exp,
    },
  };
}

/**
 * Version opcional: devuelve el usuario verificado o null, sin responder.
 * Para rutas publicas que ajustan su salida si hay sesion.
 */
export async function getVerifiedUser(req: Request): Promise<TokenPayload | null> {
  const resultado = await resolveVerifiedUser(req);
  return resultado.ok ? resultado.user : null;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const resultado = await resolveVerifiedUser(req);
  if (!resultado.ok) {
    if (resultado.status === 401) clearAuthCookie(res);
    return res.status(resultado.status).json({ error: resultado.error });
  }
  req.user = resultado.user;
  next();
}

export function requireRole(...roles: Rol[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const currentRole = req.user?.rol;
    if (!currentRole) {
      return res.status(403).json({ error: "No autorizado" });
    }

    if (roles.includes(currentRole)) {
      next();
      return;
    }

    const inheritedRoles: Partial<Record<Rol, Rol[]>> = {
      admin: ["vendedor"],
      superAdmin: ["admin", "vendedor"],
    };

    const impliedRoles = inheritedRoles[currentRole] ?? [];
    if (roles.some((role) => impliedRoles.includes(role))) {
      next();
      return;
    }

    return res.status(403).json({ error: "No autorizado" });
  };
}
