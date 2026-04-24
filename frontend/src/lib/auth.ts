import type { Rol } from "../types";

export function defaultRouteForRole(rol: Rol): string {
  if (rol === "admin") return "/admin";
  if (rol === "vendedor") return "/vendedor";
  return "/";
}

export function parseJwtExp(token: string | null): number | null {
  if (!token) return null;
  try {
    const payloadRaw = token.split(".")[1];
    if (!payloadRaw) return null;
    const base64 = payloadRaw.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(atob(base64));
    return typeof decoded.exp === "number" ? decoded.exp : null;
  } catch {
    return null;
  }
}

export function isTokenExpired(token: string | null): boolean {
  const exp = parseJwtExp(token);
  if (!exp) return true;
  return exp * 1000 <= Date.now();
}
