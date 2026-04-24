import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";

export type Rol = "cliente" | "vendedor" | "admin";
export interface TokenPayload {
  id: number;
  rol: Rol;
  email: string;
}

const SECRET = process.env.JWT_SECRET || "dev-secret-cambialo";

export function signToken(payload: TokenPayload): string {
  const expiresIn = payload.rol === "admin" || payload.rol === "vendedor" ? "1d" : "1h";
  return jwt.sign(payload, SECRET, { expiresIn });
}

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token requerido" });
  }
  try {
    const payload = jwt.verify(header.slice(7), SECRET) as TokenPayload;
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido" });
  }
}

export function requireRole(...roles: Rol[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.rol)) {
      return res.status(403).json({ error: "No autorizado" });
    }
    next();
  };
}
