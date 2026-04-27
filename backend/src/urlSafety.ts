const SAFE_IMAGE_PROTOCOLS = new Set(["http:", "https:"]);

export function normalizeSafeImageUrl(value: string | null | undefined): string | null {
  const raw = value?.trim() || "";
  if (!raw) return null;

  if (raw.startsWith("/")) {
    if (raw.startsWith("//")) return null;
    return raw;
  }

  if (raw.startsWith("uploads/")) return `/${raw}`;
  if (raw.startsWith("api/uploads/")) return `/${raw}`;

  try {
    const parsed = new URL(raw);
    if (!SAFE_IMAGE_PROTOCOLS.has(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}
