const rawApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();

export const API_BASE_URL = rawApiBaseUrl ? rawApiBaseUrl.replace(/\/+$/, "") : "";

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

export function mediaUrl(path: string | null | undefined): string {
  const raw = path?.trim() || "";
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;

  const normalizedPath = raw.startsWith("/") ? raw : `/${raw}`;
  if (normalizedPath.startsWith("/uploads/") || normalizedPath.startsWith("/api/uploads/")) {
    return apiUrl(normalizedPath);
  }

  return normalizedPath;
}

export type MediaVariant = "card" | "thumb";

/**
 * URL de una variante de tamaño generada por el pipeline de subida del
 * backend (imageVariants.ts): base.webp -> base-card.webp / base-thumb.webp.
 * Devuelve null si la imagen no es un upload propio (URL externa o asset
 * de public/), que no tiene variantes.
 */
export function mediaVariantUrl(path: string | null | undefined, variant: MediaVariant): string | null {
  const canonical = mediaUrl(path);
  if (!canonical || !canonical.includes("/uploads/")) return null;
  const match = canonical.match(/^(.+)\.(png|jpe?g|webp)$/i);
  if (!match) return null;
  return `${match[1]}-${variant}.webp`;
}

/**
 * srcset para imágenes de grilla de producto. La variante -card (600px)
 * cubre el ancho máximo real de una card (~490px) a 1x; el canónico
 * (tope 1600px) cubre pantallas retina.
 */
export function mediaCardSrcSet(path: string | null | undefined): string | undefined {
  const card = mediaVariantUrl(path, "card");
  if (!card) return undefined;
  return `${card} 600w, ${mediaUrl(path)} 1600w`;
}

/** sizes acorde a las columnas reales de .catalog-grid (ver catalog.css). */
export const CARD_IMG_SIZES = "(min-width: 1024px) 330px, (min-width: 640px) 50vw, 100vw";

/**
 * Fallback para imágenes viejas sin variantes generadas: si el candidato
 * del srcset da 404, se quita el srcset y el navegador recarga desde src
 * (el archivo canónico, que sí existe).
 */
export function dropSrcSetOnError(event: { currentTarget: HTMLImageElement }): void {
  const img = event.currentTarget;
  if (img.hasAttribute("srcset")) {
    img.removeAttribute("srcset");
    img.removeAttribute("sizes");
  }
}
