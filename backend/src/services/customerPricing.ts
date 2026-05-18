import { Queryable, qAll, qOne } from "../db";

export type TipoCliente = "cliente" | "mayorista" | "empleado";
export type PricingSource = "web" | "local";

export type CustomerPricingProfile = {
  usuarioId: number;
  rol: string;
  tipoCliente: TipoCliente;
  descuentoPorcentaje: number;
};

export type ResolvedMoneyPrice = {
  precioLista: number;
  descuentoCategoriaPorcentaje: number;
  descuentoWebGlobalPorcentaje: number;
  descuentoPorcentajeAplicado: number;
  precioFinal: number;
  tipoCliente: TipoCliente;
  source: PricingSource;
};

type DiscountRow = {
  tipo_cliente: TipoCliente;
  categoria: string;
  descuento_porcentaje: number;
  activo: number;
};

type DiscountConfig = {
  activo: boolean;
  cliente: number;
  mayorista: number;
  empleado: number;
};

type PricingResolverOptions = {
  source: PricingSource;
  profile?: Pick<CustomerPricingProfile, "tipoCliente"> | null;
};

const GLOBAL_DISCOUNT_CONFIG_KEYS = [
  "descuento_web_global_activo",
  "descuento_web_global_cliente",
  "descuento_web_global_mayorista",
  "descuento_web_global_empleado",
] as const;

function normalizeTipoCliente(value: unknown): TipoCliente {
  if (value === "mayorista" || value === "empleado") return value;
  return "cliente";
}

export function normalizeDiscount(value: unknown): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round((numeric + Number.EPSILON) * 100) / 100));
}

function normalizeMoney(value: number | null | undefined): number {
  return Math.round((Number(value ?? 0) + Number.EPSILON) * 100) / 100;
}

export function applyDiscountToMoney(basePrice: number, discountPercentage: number): number {
  const price = normalizeMoney(basePrice);
  const discount = normalizeDiscount(discountPercentage);
  const finalPrice = price * (1 - discount / 100);
  return normalizeMoney(finalPrice);
}

function normalizeCategoryKey(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

export async function getCustomerPricingProfile(
  conn: Queryable,
  usuarioId: number,
): Promise<CustomerPricingProfile | null> {
  const row = await qOne<{
    id: number;
    rol: string;
    tipo_cliente: TipoCliente | null;
    descuento_porcentaje: number | null;
  }>(
    conn,
    `SELECT id, rol, tipo_cliente, descuento_porcentaje
     FROM usuarios
     WHERE id = ? AND activo = 1
     LIMIT 1`,
    [usuarioId],
  );

  if (!row) return null;

  return {
    usuarioId: Number(row.id),
    rol: row.rol,
    tipoCliente: normalizeTipoCliente(row.tipo_cliente),
    descuentoPorcentaje: normalizeDiscount(row.descuento_porcentaje),
  };
}

export async function getActiveClientePricingProfile(
  conn: Queryable,
  usuarioId: number,
): Promise<CustomerPricingProfile | null> {
  const profile = await getCustomerPricingProfile(conn, usuarioId);
  if (!profile || profile.rol !== "cliente") return null;
  return profile;
}

async function loadCategoryDiscounts(conn: Queryable): Promise<Map<string, number>> {
  const rows = await qAll<DiscountRow>(
    conn,
    `SELECT tipo_cliente, categoria, descuento_porcentaje, activo
     FROM descuentos_tipo_categoria
     WHERE activo = 1`,
  ).catch(() => []);

  const map = new Map<string, number>();
  for (const row of rows) {
    const categoria = normalizeCategoryKey(row.categoria);
    if (!categoria) continue;
    const tipoCliente = normalizeTipoCliente(row.tipo_cliente);
    map.set(`${tipoCliente}:${categoria}`, normalizeDiscount(row.descuento_porcentaje));
  }
  return map;
}

async function loadWebGlobalDiscountConfig(conn: Queryable): Promise<DiscountConfig> {
  const placeholders = GLOBAL_DISCOUNT_CONFIG_KEYS.map(() => "?").join(", ");
  const rows = await qAll<{ clave: string; valor: string }>(
    conn,
    `SELECT clave, valor
     FROM configuracion
     WHERE clave IN (${placeholders})`,
    [...GLOBAL_DISCOUNT_CONFIG_KEYS],
  ).catch(() => []);

  const byKey = new Map(rows.map((row) => [row.clave, row.valor]));
  const activoRaw = String(byKey.get("descuento_web_global_activo") ?? "0").trim().toLowerCase();

  return {
    activo: activoRaw === "1" || activoRaw === "true" || activoRaw === "si" || activoRaw === "yes" || activoRaw === "on",
    cliente: normalizeDiscount(byKey.get("descuento_web_global_cliente") ?? 0),
    mayorista: normalizeDiscount(byKey.get("descuento_web_global_mayorista") ?? 0),
    empleado: normalizeDiscount(byKey.get("descuento_web_global_empleado") ?? 0),
  };
}

function getGlobalDiscountForType(config: DiscountConfig, tipoCliente: TipoCliente): number {
  if (tipoCliente === "mayorista") return config.mayorista;
  if (tipoCliente === "empleado") return config.empleado;
  return config.cliente;
}

export async function createPricingResolver(
  conn: Queryable,
  options: PricingResolverOptions,
): Promise<(product: { precio_dinero: number | null | undefined; categoria?: string | null }) => ResolvedMoneyPrice> {
  const tipoCliente = normalizeTipoCliente(options.profile?.tipoCliente);
  const categoryDiscounts = await loadCategoryDiscounts(conn);
  const webGlobalConfig = options.source === "web"
    ? await loadWebGlobalDiscountConfig(conn)
    : {
        activo: false,
        cliente: 0,
        mayorista: 0,
        empleado: 0,
      };

  return (product) => {
    const precioLista = normalizeMoney(product.precio_dinero);
    const categoriaKey = normalizeCategoryKey(product.categoria);
    const descuentoCategoriaPorcentaje = categoriaKey
      ? normalizeDiscount(categoryDiscounts.get(`${tipoCliente}:${categoriaKey}`) ?? 0)
      : 0;
    const descuentoWebGlobalPorcentaje =
      options.source === "web" && webGlobalConfig.activo
        ? getGlobalDiscountForType(webGlobalConfig, tipoCliente)
        : 0;

    // Regla conservadora: aplica el mejor descuento individual y evita acumulaciones inesperadas.
    const descuentoPorcentajeAplicado = Math.max(descuentoCategoriaPorcentaje, descuentoWebGlobalPorcentaje);

    return {
      precioLista,
      descuentoCategoriaPorcentaje,
      descuentoWebGlobalPorcentaje,
      descuentoPorcentajeAplicado,
      precioFinal: applyDiscountToMoney(precioLista, descuentoPorcentajeAplicado),
      tipoCliente,
      source: options.source,
    };
  };
}

export async function resolveEffectiveMoneyPrice(
  conn: Queryable,
  options: PricingResolverOptions & { product: { precio_dinero: number | null | undefined; categoria?: string | null } },
): Promise<ResolvedMoneyPrice> {
  const resolver = await createPricingResolver(conn, options);
  return resolver(options.product);
}
