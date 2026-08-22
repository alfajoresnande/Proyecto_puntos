/**
 * CSRF en el cliente (SEC-07).
 *
 * Antes el navegador se inventaba un valor aleatorio y lo guardaba en
 * localStorage; el servidor solo le medía el largo, así que no protegía nada.
 * Ahora el token lo emite el servidor firmado y atado a la sesión, y llega en
 * la cookie `csrf_token`. Acá solo se lee esa cookie y se reenvía en el header
 * (double submit).
 */
import { apiUrl } from "./apiBase";

const CSRF_COOKIE_NAME = "csrf_token";
/** Clave del esquema viejo. Se borra en la migración del cliente. */
const LEGACY_CSRF_STORAGE_KEY = "nande.csrf.token";

export function readCsrfCookie(): string {
  if (typeof document === "undefined") return "";
  for (const part of document.cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    if (part.slice(0, separator).trim() !== CSRF_COOKIE_NAME) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return "";
}

/**
 * Último token emitido por el servidor.
 *
 * Hace falta porque `readCsrfCookie()` NO puede funcionar en este despliegue:
 * la cookie `csrf_token` la setea `nandengineer.shop` y el front corre en
 * `alfajorescorrentinos.com`. Un dominio no lee las cookies de otro, así que
 * ahí la cookie siempre viene vacía y toda petición que dependiera de ella
 * se comía un 403. Se conserva la lectura de cookie como respaldo para un
 * despliegue de mismo origen.
 */
let cachedToken = "";

/** Compatibilidad: el resto del código sigue llamando a `getCsrfToken()`. */
export function getCsrfToken(): string {
  return cachedToken || readCsrfCookie();
}

let inFlight: Promise<string> | null = null;

/**
 * Pide al servidor un token nuevo. Se usa al arrancar y cuando una petición
 * falla por CSRF, que es lo que pasa justo después de iniciar o cerrar sesión:
 * el token queda atado a la sesión y esa acaba de cambiar.
 */
export async function refreshCsrfToken(): Promise<string> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const response = await fetch(apiUrl("/api/csrf"), { method: "GET", credentials: "include" });
      if (!response.ok) return (cachedToken = readCsrfCookie());
      const body = (await response.json().catch(() => null)) as { token?: string } | null;
      // Se guarda en memoria: es el unico lugar del que `getCsrfToken()` puede
      // leerlo cuando el backend vive en otro dominio.
      return (cachedToken = body?.token || readCsrfCookie());
    } catch {
      return (cachedToken = readCsrfCookie());
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * Migración del cliente: retira los restos del esquema anterior. El JWT vivía
 * en `nande-auth.state.token` y el pseudo-token CSRF en `nande.csrf.token`.
 * Se ejecuta al arrancar la app para que ningún navegador siga arrastrando un
 * token de sesión legible por JavaScript.
 */
export function purgeLegacyBrowserTokens(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LEGACY_CSRF_STORAGE_KEY);

    const raw = window.localStorage.getItem("nande-auth");
    if (!raw) return;
    const parsed = JSON.parse(raw) as { state?: Record<string, unknown> };
    if (parsed?.state && "token" in parsed.state) {
      delete parsed.state.token;
      window.localStorage.setItem("nande-auth", JSON.stringify(parsed));
    }
  } catch {
    // Un localStorage inaccesible o corrupto no debe impedir que la app arranque.
  }
}
