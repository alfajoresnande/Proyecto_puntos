import { pool, qAll, qOne, type Queryable } from "../db";

export type TipoClienteCompra = "cliente" | "mayorista" | "empleado";

export const DEFAULT_PURCHASE_QUANTITY_LIMIT = 100;
export const MAX_SYSTEM_PURCHASE_QUANTITY = 100000;

const LIMIT_KEYS: Record<TipoClienteCompra, string> = {
  cliente: "limite_compra_cliente",
  mayorista: "limite_compra_mayorista",
  empleado: "limite_compra_empleado",
};

function normalizeTipoCliente(value: unknown): TipoClienteCompra {
  return value === "mayorista" || value === "empleado" ? value : "cliente";
}

function normalizePurchaseLimit(value: unknown): number | null {
  const parsed = Number(value ?? DEFAULT_PURCHASE_QUANTITY_LIMIT);
  if (!Number.isFinite(parsed)) return DEFAULT_PURCHASE_QUANTITY_LIMIT;
  const floored = Math.floor(parsed);
  if (floored <= 0) return null;
  return Math.min(MAX_SYSTEM_PURCHASE_QUANTITY, floored);
}

export function getPurchaseLimitConfigKey(tipoCliente: unknown): string {
  return LIMIT_KEYS[normalizeTipoCliente(tipoCliente)];
}

export async function getPurchaseQuantityLimit(
  conn: Queryable = pool,
  tipoCliente: unknown = "cliente",
): Promise<number | null> {
  const key = getPurchaseLimitConfigKey(tipoCliente);
  const row = await qOne<{ valor: string }>(conn, "SELECT valor FROM configuracion WHERE clave = ? LIMIT 1", [key]);
  return normalizePurchaseLimit(row?.valor);
}

export async function getPurchaseQuantityLimits(
  conn: Queryable = pool,
): Promise<Record<TipoClienteCompra, number | null>> {
  const rows = await qAll<{ clave: string; valor: string }>(
    conn,
    `SELECT clave, valor
     FROM configuracion
     WHERE clave IN (?, ?, ?)`,
    [LIMIT_KEYS.cliente, LIMIT_KEYS.mayorista, LIMIT_KEYS.empleado],
  );
  const values = new Map(rows.map((row) => [row.clave, row.valor]));
  return {
    cliente: normalizePurchaseLimit(values.get(LIMIT_KEYS.cliente)),
    mayorista: normalizePurchaseLimit(values.get(LIMIT_KEYS.mayorista)),
    empleado: normalizePurchaseLimit(values.get(LIMIT_KEYS.empleado)),
  };
}

export function isWithinPurchaseQuantityLimit(cantidad: number, limit: number | null): boolean {
  return limit === null || cantidad <= limit;
}

