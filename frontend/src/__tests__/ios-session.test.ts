/**
 * Sesión en el cliente: resiliencia (iOS Safari) + modelo cookie-only.
 *
 * Historia: iOS bloquea cookies cross-site (ITP), y el arreglo de entonces fue
 * duplicar el JWT en localStorage y mandarlo como Bearer. Eso resolvía iOS pero
 * dejaba el token al alcance de cualquier XSS o dependencia comprometida
 * (SEC-03 de la auditoría OWASP).
 *
 * Ahora la sesión vive SOLO en la cookie HttpOnly `__Host-auth_token`. Estos
 * tests cubren las dos cosas a la vez:
 *
 *  1. Que no quede ningún rastro del token en el navegador (sin localStorage,
 *     sin Zustand persistido, sin header Bearer).
 *  2. Que se conserve la resiliencia que motivó aquel arreglo: un error de red
 *     o un 5xx NO deben borrar la sesión; solo un 200 con `user: null` la borra.
 *
 * Nota de despliegue: con la API en otro dominio registrable, la cookie exige
 * `SameSite=None; Secure` (ver docs/seguridad-cookies-sesion.md).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "../store/authStore";
import { api } from "../api";
import type { User } from "../types";

// ── Mocks de infraestructura ────────────────────────────────────────────────

vi.mock("../lib/apiBase", () => ({
  apiUrl: (path: string) => `https://backend.test${path}`,
}));

vi.mock("../lib/csrf", () => ({
  getCsrfToken: () => "nonce.9999999999.firma",
  refreshCsrfToken: () => Promise.resolve("nonce-nuevo.9999999999.firma"),
  purgeLegacyBrowserTokens: () => undefined,
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const mockUser: User = {
  id: 1,
  nombre: "Test User",
  email: "test@test.com",
  rol: "cliente",
  dni: "12345678",
  puntos_saldo: 50,
  codigo_invitacion: "ABC123XYZ",
};

const STORAGE_KEY = "nande-auth";

function stubFetch(body: unknown, status = 200) {
  const response = {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    clone() {
      return { json: () => Promise.resolve(body) };
    },
  };
  return vi.fn().mockResolvedValue(response);
}

function fetchCall(index = 0) {
  return (global.fetch as ReturnType<typeof vi.fn>).mock.calls[index];
}

function capturedFetchHeaders(index = 0): Headers {
  return fetchCall(index)[1].headers as Headers;
}

// ── Reset entre tests ─────────────────────────────────────────────────────────

beforeEach(() => {
  useAuthStore.setState({
    user: null,
    isRestoringSession: false,
    hasRestoredSession: false,
  });
  localStorage.clear();
  vi.restoreAllMocks();
});

// ── 1. SEC-03: el token no toca el navegador ─────────────────────────────────

describe("SEC-03 — el JWT no existe en el navegador", () => {
  it("el store no expone ninguna propiedad `token`", async () => {
    global.fetch = stubFetch({ user: mockUser });

    await useAuthStore.getState().login({ email: "test@test.com", password: "pass123456789" });

    expect(useAuthStore.getState()).not.toHaveProperty("token");
    expect(useAuthStore.getState().user).toEqual(mockUser);
  });

  it("login() no persiste ningún token en localStorage", async () => {
    global.fetch = stubFetch({ user: mockUser });

    await useAuthStore.getState().login({ email: "test@test.com", password: "pass123456789" });

    const persisted = localStorage.getItem(STORAGE_KEY) ?? "";
    expect(persisted).not.toContain("token");
    expect(JSON.parse(persisted).state).toEqual({ user: mockUser });
  });

  it("ignora un `token` que el backend mandara por error en el JSON", async () => {
    global.fetch = stubFetch({ user: mockUser, token: "jwt.que.no.deberia.venir" });

    await useAuthStore.getState().login({ email: "test@test.com", password: "pass123456789" });

    expect(localStorage.getItem(STORAGE_KEY) ?? "").not.toContain("jwt.que.no.deberia.venir");
    expect(JSON.stringify(useAuthStore.getState())).not.toContain("jwt.que.no.deberia.venir");
  });

  it("api.get() no manda header Authorization", async () => {
    global.fetch = stubFetch({ data: "ok" });

    await api.get("/cliente/perfil");

    expect(capturedFetchHeaders().get("Authorization")).toBeNull();
  });

  it("api.post() no manda header Authorization pero sí el CSRF", async () => {
    global.fetch = stubFetch({ ok: true });

    await api.post("/cliente/algo", { valor: 1 });

    const headers = capturedFetchHeaders();
    expect(headers.get("Authorization")).toBeNull();
    expect(headers.get("X-CSRF-Token")).toBe("nonce.9999999999.firma");
  });

  it("restoreSession() no manda header Authorization", async () => {
    global.fetch = stubFetch({ user: mockUser });

    await useAuthStore.getState().restoreSession();

    const headers = (fetchCall()[1].headers ?? {}) as Record<string, string>;
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("un token viejo en localStorage ya no se usa para autenticar", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { user: mockUser, token: "jwt.viejo" } }));
    global.fetch = stubFetch({ user: mockUser });

    await api.get("/cliente/perfil");

    const headers = capturedFetchHeaders();
    expect(headers.get("Authorization")).toBeNull();
  });
});

// ── 2. Todo va con cookies ───────────────────────────────────────────────────

describe("la sesión viaja en la cookie", () => {
  it("api usa credentials:include", async () => {
    global.fetch = stubFetch({ data: "ok" });
    await api.get("/cliente/perfil");
    expect(fetchCall()[1].credentials).toBe("include");
  });

  it("restoreSession usa credentials:include", async () => {
    global.fetch = stubFetch({ user: mockUser });
    await useAuthStore.getState().restoreSession();
    expect(fetchCall()[1].credentials).toBe("include");
  });

  it("login usa credentials:include", async () => {
    global.fetch = stubFetch({ user: mockUser });
    await useAuthStore.getState().login({ email: "test@test.com", password: "pass123456789" });
    expect(fetchCall()[1].credentials).toBe("include");
  });

  it("logout usa credentials:include y no manda token", () => {
    useAuthStore.setState({ user: mockUser });
    global.fetch = stubFetch({ ok: true });

    useAuthStore.getState().logout();

    expect(useAuthStore.getState().user).toBeNull();
    const headers = (fetchCall()[1].headers ?? {}) as Record<string, string>;
    expect(headers["Authorization"]).toBeUndefined();
    expect(fetchCall()[1].credentials).toBe("include");
  });
});

// ── 3. SEC-07: reintento cuando el token CSRF quedó viejo ────────────────────

describe("SEC-07 — reintento con token CSRF nuevo", () => {
  it("un 403 de CSRF dispara un refresco y un único reintento", async () => {
    const rechazo = {
      ok: false,
      status: 403,
      json: () => Promise.resolve({ error: "CSRF token faltante o invalido" }),
      clone() {
        return { json: () => Promise.resolve({ error: "CSRF token faltante o invalido" }) };
      },
    };
    const aceptado = {
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true }),
      clone() {
        return { json: () => Promise.resolve({ ok: true }) };
      },
    };
    global.fetch = vi.fn().mockResolvedValueOnce(rechazo).mockResolvedValueOnce(aceptado);

    await api.post("/cliente/algo", { valor: 1 });

    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
    expect(capturedFetchHeaders(0).get("X-CSRF-Token")).toBe("nonce.9999999999.firma");
    expect(capturedFetchHeaders(1).get("X-CSRF-Token")).toBe("nonce-nuevo.9999999999.firma");
  });

  it("un 403 que NO es de CSRF no se reintenta", async () => {
    global.fetch = stubFetch({ error: "No autorizado" }, 403);

    await expect(api.post("/admin/algo", { valor: 1 })).rejects.toThrow();

    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});

// ── 4. Resiliencia iOS: no borrar la sesión ante fallos ──────────────────────

describe("restoreSession() — protección ante fallos de red (fix iOS)", () => {
  it("error de red: NO borra la sesión (evita logout permanente con mala señal)", async () => {
    useAuthStore.setState({ user: mockUser });
    global.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().user).toEqual(mockUser);
    expect(useAuthStore.getState().isRestoringSession).toBe(false);
    expect(useAuthStore.getState().hasRestoredSession).toBe(true);
  });

  it("error de red con user null: sigue null (no se inventa sesión)", async () => {
    useAuthStore.setState({ user: null });
    global.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().hasRestoredSession).toBe(true);
  });

  it("error de servidor (500): NO borra la sesión", async () => {
    useAuthStore.setState({ user: mockUser });
    global.fetch = stubFetch({ error: "Internal Server Error" }, 500);

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().user).toEqual(mockUser);
  });

  it("servidor caído (503, readiness): NO borra la sesión", async () => {
    useAuthStore.setState({ user: mockUser });
    global.fetch = stubFetch("Service Unavailable", 503);

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().user).toEqual(mockUser);
  });

  it("servidor dice user:null (200 OK) → SÍ borra la sesión", async () => {
    useAuthStore.setState({ user: mockUser });
    global.fetch = stubFetch({ user: null }, 200);

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().user).toBeNull();
  });

  it("restaura el usuario cuando la cookie es válida", async () => {
    global.fetch = stubFetch({ user: mockUser });

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().user).toEqual(mockUser);
    expect(useAuthStore.getState().isRestoringSession).toBe(false);
    expect(useAuthStore.getState().hasRestoredSession).toBe(true);
  });

  it("register() deja la sesión vacía hasta verificar el correo", async () => {
    global.fetch = stubFetch({
      ok: true,
      email: "test@test.com",
      verification_required: true,
      message: "Si los datos son validos, te enviaremos un correo de verificacion.",
    });

    await useAuthStore.getState().register({
      nombre: "Test",
      email: "test@test.com",
      password: "pass123456789",
      accepted_terms: true,
    });

    expect(useAuthStore.getState().user).toBeNull();
  });
});

// ── 5. Manejo defensivo de 401 ───────────────────────────────────────────────

describe("api — manejo defensivo de 401 (evita auto-logout agresivo)", () => {
  it("401 con sesión en el store → ejecuta logout", async () => {
    useAuthStore.setState({ user: mockUser });
    global.fetch = stubFetch({ error: "Sesion expirada. Inicia sesion nuevamente." }, 401);

    await expect(api.get("/cliente/perfil")).rejects.toThrow();

    expect(useAuthStore.getState().user).toBeNull();
  });

  it("401 sin sesión en el store → no hace nada raro", async () => {
    useAuthStore.setState({ user: null });
    global.fetch = stubFetch({ error: "Token requerido" }, 401);

    await expect(api.get("/cliente/perfil")).rejects.toThrow();

    expect(useAuthStore.getState().user).toBeNull();
  });

  it("401 NO hace window.location.assign (evita hard reload)", async () => {
    useAuthStore.setState({ user: mockUser });
    global.fetch = stubFetch({ error: "expired" }, 401);

    const assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, assign: assignSpy, pathname: "/cliente" },
      writable: true,
    });

    await expect(api.get("/cliente/perfil")).rejects.toThrow();

    expect(assignSpy).not.toHaveBeenCalled();
  });
});

describe("api — mensajes mas claros ante fallos de red", () => {
  it("transforma Failed to fetch en un error mas accionable", async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(api.post("/admin/productos", { nombre: "Test" })).rejects.toThrow(
      "No se pudo conectar con el servidor para /api/admin/productos."
    );
  });
});
