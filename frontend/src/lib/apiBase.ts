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
