const CSRF_STORAGE_KEY = "nande.csrf.token";

function generateCsrfToken(): string {
  if (typeof window === "undefined") {
    return "";
  }

  if (window.crypto?.getRandomValues) {
    const bytes = new Uint8Array(24);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 26)}`;
}

export function getCsrfToken(): string {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    const existing = window.localStorage.getItem(CSRF_STORAGE_KEY);
    if (existing && existing.length >= 16) return existing;
    const created = generateCsrfToken();
    window.localStorage.setItem(CSRF_STORAGE_KEY, created);
    return created;
  } catch {
    return generateCsrfToken();
  }
}
