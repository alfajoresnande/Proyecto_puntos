import { mediaUrl } from "./apiBase";
import type { Producto } from "../types";

export const LOCAL_SALE_QUICK_PRODUCT_CLICKS_KEY = "local-sale-quick-product-clicks-v1";
export const MAX_QUICK_LOCAL_PRODUCTS = 5;

export type LocalSaleQuickClickMap = Record<string, number>;

type QuickOrderLike = {
  canal?: string;
  estado?: string;
  tipo_orden?: string;
  items?: Array<{
    producto_id: number;
    cantidad: number;
  }>;
};

export function readLocalSaleQuickProductClicks(): LocalSaleQuickClickMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LOCAL_SALE_QUICK_PRODUCT_CLICKS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, value]) => Number.isFinite(Number(value)) && Number(value) > 0)
        .map(([key, value]) => [key, Number(value)]),
    );
  } catch {
    return {};
  }
}

export function writeLocalSaleQuickProductClicks(clicks: LocalSaleQuickClickMap) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCAL_SALE_QUICK_PRODUCT_CLICKS_KEY, JSON.stringify(clicks));
  } catch {
    // Ignore storage errors so the local sale flow keeps working.
  }
}

export function getLocalSaleQuickProductImage(producto: Pick<Producto, "imagenes" | "imagen_url">): string | null {
  const image = (producto.imagenes ?? []).find(Boolean) ?? producto.imagen_url ?? null;
  if (!image) return null;
  return image.startsWith("http") ? image : mediaUrl(image);
}

export function getLocalSaleQuickProductSubtitle(
  producto: Pick<Producto, "categoria" | "configuracion_tipo" | "descripcion">,
): string {
  if (producto.configuracion_tipo === "caja_sabores") return "Relleno a elección";
  if (producto.categoria?.trim()) return producto.categoria.trim();
  if (producto.descripcion?.trim()) return producto.descripcion.trim();
  return "Producto del mostrador";
}

export function buildLocalSaleQuickProducts<TProduct extends Producto, TOrder extends QuickOrderLike>(
  products: TProduct[],
  orders: TOrder[],
  {
    channel,
    clickCounts,
    limit = MAX_QUICK_LOCAL_PRODUCTS,
  }: {
    channel?: string | null;
    clickCounts?: LocalSaleQuickClickMap;
    limit?: number;
  },
): TProduct[] {
  const purchaseScore = new Map<number, number>();
  for (const order of orders) {
    if (order.tipo_orden !== "venta") continue;
    if (order.estado === "cancelada" || order.estado === "expirada") continue;
    if (channel && order.canal !== channel) continue;
    for (const item of order.items ?? []) {
      const productId = Number(item.producto_id);
      const quantity = Math.max(1, Number(item.cantidad) || 0);
      if (!Number.isInteger(productId) || productId <= 0) continue;
      purchaseScore.set(productId, (purchaseScore.get(productId) ?? 0) + quantity);
    }
  }

  return [...products]
    .sort((left, right) => {
      const leftPurchases = purchaseScore.get(Number(left.id)) ?? 0;
      const rightPurchases = purchaseScore.get(Number(right.id)) ?? 0;
      const leftClicks = Number(clickCounts?.[String(left.id)] ?? 0);
      const rightClicks = Number(clickCounts?.[String(right.id)] ?? 0);
      const leftScore = leftPurchases * 4 + leftClicks * 7;
      const rightScore = rightPurchases * 4 + rightClicks * 7;
      if (leftScore !== rightScore) return rightScore - leftScore;
      if (leftClicks !== rightClicks) return rightClicks - leftClicks;
      if (leftPurchases !== rightPurchases) return rightPurchases - leftPurchases;
      if (Boolean(left.destacado_home) !== Boolean(right.destacado_home)) {
        return Number(Boolean(right.destacado_home)) - Number(Boolean(left.destacado_home));
      }
      return left.nombre.localeCompare(right.nombre, "es");
    })
    .slice(0, limit);
}
