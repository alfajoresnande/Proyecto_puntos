// Valida URLs antes de meterlas en un href/to. Espejo de
// backend/src/urlSafety.ts: el backend ya filtra lo que guarda, pero el
// texto que devuelve el chatbot no pasa por ahi, y un href="javascript:..."
// lo ejecuta React 18 igual (solo avisa por consola).
const SAFE_NAVIGATION_PROTOCOLS = new Set(["http:", "https:"]);

export function normalizeSafeNavigationUrl(value: string | null | undefined): string | null {
  const raw = value?.trim() || "";
  if (!raw) return null;

  if (raw.startsWith("#")) {
    return raw.length > 1 ? raw : null;
  }

  if (raw.startsWith("/")) {
    // "//evil.com" es protocol-relative: sale del sitio aunque arranque con "/".
    if (raw.startsWith("//")) return null;
    return raw;
  }

  try {
    const parsed = new URL(raw);
    if (!SAFE_NAVIGATION_PROTOCOLS.has(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function isInternalNavigationPath(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//");
}
