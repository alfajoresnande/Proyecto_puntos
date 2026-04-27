import { getCsrfToken } from "./lib/csrf";
import { useAuthStore } from "./store/authStore";

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: BodyInit | Record<string, unknown> | null;
};

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

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

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const isAuthPath = path.startsWith("/auth/");
  const hasBody = options.body !== undefined && options.body !== null;
  const formDataBody = isFormData(options.body);
  const method = (options.method || "GET").toUpperCase();

  const headers = new Headers(options.headers);
  if (hasBody && !formDataBody) headers.set("Content-Type", "application/json");
  if (!SAFE_METHODS.has(method)) headers.set("X-CSRF-Token", getCsrfToken());

  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: "include",
    headers,
    body:
      hasBody && !formDataBody && typeof options.body === "object"
        ? JSON.stringify(options.body)
        : (options.body as BodyInit | null | undefined),
  });

  const body = await response
    .clone()
    .json()
    .catch(() => null);

  if (response.status === 401) {
    if (!isAuthPath) {
      useAuthStore.getState().logout();
      if (window.location.pathname !== "/login") {
        window.location.assign("/login");
      }
    }

    const authFallback = isAuthPath
      ? "Credenciales invalidas."
      : "Sesion expirada. Inicia sesion nuevamente.";
    throw new Error(parseErrorMessage(body, authFallback));
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
