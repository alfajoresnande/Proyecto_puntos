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
  descuentoUsuarioPorcentaje: number;
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
  profile?: Pick<CustomerPricingProfile, "tipoCliente" | "descuentoPorcentaje"> | null;
};

const GLOBAL_DISCOUNT_CONFIG_KEYS = [
  "descuento_web_global_activo",
  "descuento_web_global_cliente",
  "descuento_web_global_mayorista",
  "descuento_web_global_empleado",
] as const;

const EVENTBAR_SPECIAL_DISCOUNT_CONFIG_KEYS = [
  "eventbar_activo",
  "eventbar_fecha_fin",
  "eventbar_descuento_especial_activo",
  "eventbar_descuento_especial_tipo",
] as const;

export type EventbarSpecialDiscountType = "none" | "2x1" | "3x2" | "4x3";

export type EventbarSpecialDiscountConfig = {
  activo: boolean;
  tipo: EventbarSpecialDiscountType;
  cantidadRequerida: number;
  cantidadPaga: number;
  label: string | null;
};

function normalizeTipoCliente(value: unknown): TipoCliente {
  if (value === "mayorista" || value === "empleado") return value;
  return "cliente";
}

function parseConfigBoolean(value: unknown): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["1", "true", "si", "yes", "on"].includes(normalized);
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

export function normalizeEventbarSpecialDiscountType(value: unknown): EventbarSpecialDiscountType {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/×/g, "x");
  if (normalized === "2x1" || normalized === "3x2" || normalized === "4x3") return normalized;
  return "none";
}

export function getEventbarSpecialDiscountTerms(type: EventbarSpecialDiscountType): {
  cantidadRequerida: number;
  cantidadPaga: number;
} | null {
  if (type === "2x1") return { cantidadRequerida: 2, cantidadPaga: 1 };
  if (type === "3x2") return { cantidadRequerida: 3, cantidadPaga: 2 };
  if (type === "4x3") return { cantidadRequerida: 4, cantidadPaga: 3 };
  return null;
}

function parseEventbarEndDate(value: unknown): Date | null {
  const date = new Date(String(value ?? ""));
  if (!Number.isFinite(date.getTime())) return null;
  return date;
}

export async function loadEventbarSpecialDiscountConfig(conn: Queryable): Promise<EventbarSpecialDiscountConfig> {
  const inactive: EventbarSpecialDiscountConfig = {
    activo: false,
    tipo: "none",
    cantidadRequerida: 0,
    cantidadPaga: 0,
    label: null,
  };

  const placeholders = EVENTBAR_SPECIAL_DISCOUNT_CONFIG_KEYS.map(() => "?").join(", ");
  const rows = await qAll<{ clave: string; valor: string }>(
    conn,
    `SELECT clave, valor
     FROM configuracion
     WHERE clave IN (${placeholders})`,
    [...EVENTBAR_SPECIAL_DISCOUNT_CONFIG_KEYS],
  ).catch(() => []);

  const byKey = new Map(rows.map((row) => [row.clave, row.valor]));
  const eventbarActiva = parseConfigBoolean(byKey.get("eventbar_activo"));
  const fechaFin = parseEventbarEndDate(byKey.get("eventbar_fecha_fin"));
  const tipo = normalizeEventbarSpecialDiscountType(byKey.get("eventbar_descuento_especial_tipo"));
  const terms = getEventbarSpecialDiscountTerms(tipo);

  if (!eventbarActiva || !fechaFin || fechaFin.getTime() <= Date.now() || !terms) {
    return inactive;
  }

  return {
    activo: true,
    tipo,
    cantidadRequerida: terms.cantidadRequerida,
    cantidadPaga: terms.cantidadPaga,
    label: tipo.toUpperCase(),
  };
}

export function calculateEventbarSpecialDiscountSubtotal(
  unitPrice: number | null | undefined,
  quantity: number | null | undefined,
  discount: EventbarSpecialDiscountConfig | null | undefined,
): number {
  const price = normalizeMoney(unitPrice ?? 0);
  const qty = Math.max(0, Math.floor(Number(quantity ?? 0)));
  if (!discount?.activo || discount.cantidadRequerida <= 0 || discount.cantidadPaga <= 0 || qty <= 0 || price <= 0) {
    return normalizeMoney(price * qty);
  }

  const promoGroups = Math.floor(qty / discount.cantidadRequerida);
  const remainder = qty % discount.cantidadRequerida;
  const chargedQuantity = promoGroups * discount.cantidadPaga + remainder;
  return normalizeMoney(price * chargedQuantity);
}

export function getEventbarSpecialEffectiveUnitPrice(
  unitPrice: number | null | undefined,
  discount: EventbarSpecialDiscountConfig | null | undefined,
): number | null {
  const price = normalizeMoney(unitPrice ?? 0);
  if (!discount?.activo || discount.cantidadRequerida <= 0 || discount.cantidadPaga <= 0 || price <= 0) {
    return null;
  }
  return normalizeMoney(price * (discount.cantidadPaga / discount.cantidadRequerida));
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
    `SELECT d.tipo_cliente, d.categoria, d.descuento_porcentaje, d.activo
     FROM descuentos_tipo_categoria d
     LEFT JOIN categorias c ON LOWER(c.nombre) = LOWER(d.categoria)
     WHERE d.activo = 1
       AND (c.id IS NULL OR c.activo = 1)`,
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

  return {
    activo: parseConfigBoolean(byKey.get("descuento_web_global_activo") ?? "0"),
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
    const descuentoUsuarioPorcentaje = normalizeDiscount(options.profile?.descuentoPorcentaje ?? 0);
    const categoriaKey = normalizeCategoryKey(product.categoria);
    const descuentoCategoriaPorcentaje = categoriaKey
      ? normalizeDiscount(categoryDiscounts.get(`${tipoCliente}:${categoriaKey}`) ?? 0)
      : 0;
    const descuentoWebGlobalPorcentaje =
      options.source === "web" && webGlobalConfig.activo
        ? getGlobalDiscountForType(webGlobalConfig, tipoCliente)
        : 0;

    // Regla conservadora: aplica el mejor descuento individual y evita acumulaciones inesperadas.
    const descuentoPorcentajeAplicado = Math.max(
      descuentoUsuarioPorcentaje,
      descuentoCategoriaPorcentaje,
      descuentoWebGlobalPorcentaje,
    );

    return {
      precioLista,
      descuentoUsuarioPorcentaje,
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
