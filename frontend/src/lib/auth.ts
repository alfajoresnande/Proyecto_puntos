import type { Rol } from "../types";

export function defaultRouteForRole(rol: Rol): string {
  if (rol === "superAdmin") return "/superadmin";
  if (rol === "admin") return "/admin";
  if (rol === "vendedor") return "/vendedor";
  return "/catalogo";
}
