import { getCsrfToken } from "./lib/csrf";
import { apiUrl } from "./lib/apiBase";
import { useAuthStore } from "./store/authStore";

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: BodyInit | Record<string, unknown> | null;
};

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const AUTH_STORAGE_KEY = "nande-auth";

function isFormData(value: unknown): value is FormData {
  return typeof FormData !== "undefined" && value instanceof FormData;
}

function parseErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body) {
    const err = (body as { error?: unknown }).error;
    if (typeof err === "string") return err;
  }
  return fallback;
}

function isNetworkErrorLike(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    error.name === "TypeError" ||
    error.name === "NetworkError" ||
    message.includes("failed to fetch") ||
    message.includes("load failed") ||
    message.includes("networkerror") ||
    message.includes("fetch failed")
  );
}

function buildFetchFailureMessage(path: string, error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") {
    return "La solicitud tardó demasiado y fue cancelada. Intenta nuevamente.";
  }

  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (offline) {
    return "No hay conexión a internet en este dispositivo. Revisa la red y vuelve a intentar.";
  }

  if (isNetworkErrorLike(error)) {
    const route = `/api${path}`;
    return `No se pudo conectar con el servidor para ${route}. Revisa si el backend está levantado, si la URL de la API es correcta y si el origen actual está permitido por CORS/CSRF.`;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "No se pudo completar la solicitud por un problema de conexión inesperado.";
}

// Lee el token primero del store de Zustand. Si no hay (race condition de
// hidratación al inicializar), cae a leer directo de localStorage. Esto blinda
// el caso donde main.tsx dispara llamadas antes que persist termine de hidratar.
function getStoredToken(): string | null {
  const fromStore = useAuthStore.getState().token;
  if (fromStore) return fromStore;
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { token?: unknown } };
    if (typeof parsed?.state?.token === "string") return parsed.state.token;
  } catch {
    // ignore
  }
  return null;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const isAuthPath = path.startsWith("/auth/");
  const hasBody = options.body !== undefined && options.body !== null;
  const formDataBody = isFormData(options.body);
  const method = (options.method || "GET").toUpperCase();

  const headers = new Headers(options.headers);
  if (hasBody && !formDataBody) headers.set("Content-Type", "application/json");
  if (!SAFE_METHODS.has(method)) headers.set("X-CSRF-Token", getCsrfToken());

  const token = getStoredToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(apiUrl(`/api${path}`), {
      ...options,
      credentials: "include",
      headers,
      body:
        hasBody && !formDataBody && typeof options.body === "object"
          ? JSON.stringify(options.body)
          : (options.body as BodyInit | null | undefined),
    });
  } catch (error) {
    throw new Error(buildFetchFailureMessage(path, error));
  }

  const body = await response
    .clone()
    .json()
    .catch(() => null);

  if (response.status === 401) {
    if (isAuthPath) {
      throw new Error(parseErrorMessage(body, "Credenciales invalidas."));
    }

    // Auto-logout SOLO si efectivamente enviamos un token y el server lo rechazó.
    // Si no había token (caso edge: store no hidratado, llamada prematura, etc.)
    // no destruimos la sesión persistida — solo lanzamos el error y dejamos que
    // ProtectedRoute / restoreSession resuelvan el flujo.
    //
    // Tampoco hacemos window.location.assign(): el hard reload destruye la
    // sesión recién guardada antes de que React lea el localStorage hidratado.
    if (token) {
      useAuthStore.getState().logout();
    }

    throw new Error(parseErrorMessage(body, "Sesion expirada. Inicia sesion nuevamente."));
  }

  if (!response.ok) {
    throw new Error(parseErrorMessage(body, `Error ${response.status}`));
  }

  if (response.status === 204) {
    return null as T;
  }

  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: RequestOptions["body"]) => request<T>(path, { method: "POST", body }),
  put: <T>(path: string, body?: RequestOptions["body"]) => request<T>(path, { method: "PUT", body }),
  patch: <T>(path: string, body?: RequestOptions["body"]) => request<T>(path, { method: "PATCH", body }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
