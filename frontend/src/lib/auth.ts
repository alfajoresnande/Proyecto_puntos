import type { Rol } from "../types";

export function defaultRouteForRole(rol: Rol): string {
  if (rol === "admin") return "/admin";
  if (rol === "vendedor") return "/vendedor";
  return "/";
}
