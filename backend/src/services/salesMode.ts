import { qOne, type Queryable } from "../db";

export const SALES_MODE_CONFIG_KEY = "modo_venta";
export const SALES_MODE_ECOMMERCE = "ecommerce";
export const SALES_MODE_WHATSAPP = "catalogo_whatsapp";

export type SalesMode = typeof SALES_MODE_ECOMMERCE | typeof SALES_MODE_WHATSAPP;

export function normalizeSalesMode(value: unknown): SalesMode {
  return String(value ?? "").trim().toLowerCase() === SALES_MODE_WHATSAPP
    ? SALES_MODE_WHATSAPP
    : SALES_MODE_ECOMMERCE;
}

export async function getSalesMode(conn: Queryable): Promise<SalesMode> {
  const row = await qOne<{ valor: string }>(
    conn,
    "SELECT valor FROM configuracion WHERE clave = ? LIMIT 1",
    [SALES_MODE_CONFIG_KEY],
  );
  return normalizeSalesMode(row?.valor);
}

export async function isWhatsappCatalogMode(conn: Queryable): Promise<boolean> {
  return (await getSalesMode(conn)) === SALES_MODE_WHATSAPP;
}
