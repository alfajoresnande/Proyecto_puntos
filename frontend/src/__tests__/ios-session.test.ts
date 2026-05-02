/**
 * Tests para el fix de sesión en iOS Safari.
 *
 * Problema original: iOS bloquea cookies cross-domain (Vercel → Hostinger) por ITP.
 *
 * Bugs identificados y corregidos:
 * 1. Race condition Zustand v5: restoreSession llamado antes de que el store se hidrate
 *    desde localStorage → get().token devuelve null → /me sin Bearer → sesión borrada.
 *    Fix: leer localStorage directamente como fallback.
 *
 * 2. restoreSession borraba el token ante CUALQUIER falla (red, timeout, 5xx).
 *    Fix: solo borrar cuando el servidor confirma explícitamente que no hay sesión (200 + user: null).
 *
 * 3. Token no almacenado si el backend no retornaba { token } en el body del login.
 *    Fix: backend ahora incluye token en todas las respuestas de auth.
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
  getCsrfToken: () => "mock-csrf-token-16chars",
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

function capturedFetchHeaders(): Headers {
  const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
  return calls[0][1].headers as Headers;
}

function capturedFetchPlainHeaders(): Record<string, string> {
  const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
  return calls[0][1].headers as Record<string, string>;
}

function writeTokenToLocalStorage(token: string) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { user: mockUser, token } }));
}

// ── Reset entre tests ─────────────────────────────────────────────────────────

beforeEach(() => {
  useAuthStore.setState({
    user: null,
    token: null,
    isRestoringSession: false,
    hasRestoredSession: false,
  });
  localStorage.clear();
  vi.restoreAllMocks();
});

// ── 1. Token almacenado después de autenticación ──────────────────────────────

describe("authStore — token almacenado después de autenticación", () => {
  it("login() guarda el token del body de respuesta del backend", async () => {
    global.fetch = stubFetch({ user: mockUser, token: "jwt.login.token" });

    await useAuthStore.getState().login({ email: "test@test.com", password: "pass123456789" });

    expect(useAuthStore.getState().token).toBe("jwt.login.token");
    expect(useAuthStore.getState().user).toEqual(mockUser);
  });

  it("register() guarda el token del body de respuesta del backend", async () => {
    global.fetch = stubFetch({ user: mockUser, token: "jwt.register.token" });

    await useAuthStore.getState().register({
      nombre: "Test",
      email: "test@test.com",
      password: "pass123456789",
    });

    expect(useAuthStore.getState().token).toBe("jwt.register.token");
  });

  it("loginWithGoogle() guarda el token del body de respuesta del backend", async () => {
    global.fetch = stubFetch({ user: mockUser, token: "jwt.google.token" });

    await useAuthStore.getState().loginWithGoogle("google-credential-xyz");

    expect(useAuthStore.getState().token).toBe("jwt.google.token");
  });

  it("logout() borra user y token del store", () => {
    useAuthStore.setState({ token: "token.a.borrar", user: mockUser });
    global.fetch = stubFetch({ ok: true });

    useAuthStore.getState().logout();

    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("login() sin token en la respuesta no rompe (token queda null)", async () => {
    global.fetch = stubFetch({ user: mockUser }); // backend viejo sin token

    await useAuthStore.getState().login({ email: "test@test.com", password: "pass123456789" });

    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().user).toEqual(mockUser);
  });
});

// ── 2. restoreSession — fix race condition Zustand v5 ────────────────────────

describe("authStore.restoreSession() — fix race condition Zustand v5", () => {
  it("usa el token de localStorage aunque get().token sea null (store no hidratado)", async () => {
    // beforeEach ya dejó: store.token = null, localStorage = vacío.
    // Escribimos el token directamente en localStorage (simula sesión previa guardada)
    // SIN llamar setState después, porque eso triggerearía persist a sobreescribir localStorage.
    writeTokenToLocalStorage("token.en.localstorage");
    // store.token = null, localStorage = { state: { token: "token.en.localstorage" } }

    global.fetch = stubFetch({ user: mockUser });

    await useAuthStore.getState().restoreSession();

    const headers = capturedFetchPlainHeaders();
    expect(headers["Authorization"]).toBe("Bearer token.en.localstorage");
    expect(useAuthStore.getState().user).toEqual(mockUser);
  });

  it("usa el token del store si ya está disponible (caso normal)", async () => {
    useAuthStore.setState({ token: "token.en.store" });
    global.fetch = stubFetch({ user: mockUser });

    await useAuthStore.getState().restoreSession();

    const headers = capturedFetchPlainHeaders();
    expect(headers["Authorization"]).toBe("Bearer token.en.store");
  });

  it("sin token en store ni localStorage, no envía Authorization header", async () => {
    useAuthStore.setState({ token: null });
    global.fetch = stubFetch({ user: null });

    await useAuthStore.getState().restoreSession();

    const headers = capturedFetchPlainHeaders();
    expect(headers["Authorization"]).toBeUndefined();
  });
});

// ── 3. restoreSession — NO borrar sesión ante errores de red/servidor ─────────

describe("authStore.restoreSession() — protección ante fallos de red (fix iOS)", () => {
  it("error de red: NO borra el token (evita logout permanente en iOS con mala señal)", async () => {
    useAuthStore.setState({ token: "token.persistido", user: mockUser });
    global.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    await useAuthStore.getState().restoreSession();

    // Token y user se preservan — el usuario no queda deslogueado permanentemente
    expect(useAuthStore.getState().token).toBe("token.persistido");
    expect(useAuthStore.getState().user).toEqual(mockUser);
    expect(useAuthStore.getState().isRestoringSession).toBe(false);
    expect(useAuthStore.getState().hasRestoredSession).toBe(true);
  });

  it("error de red: cuando user era null, sigue null (no se inventa sesión)", async () => {
    useAuthStore.setState({ token: null, user: null });
    global.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().hasRestoredSession).toBe(true);
  });

  it("error de servidor (500): NO borra el token", async () => {
    useAuthStore.setState({ token: "token.valido", user: mockUser });
    global.fetch = stubFetch({ error: "Internal Server Error" }, 500);

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().token).toBe("token.valido");
    expect(useAuthStore.getState().user).toEqual(mockUser);
  });

  it("servidor caído (503): NO borra el token", async () => {
    useAuthStore.setState({ token: "token.valido", user: mockUser });
    global.fetch = stubFetch("Service Unavailable", 503);

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().token).toBe("token.valido");
  });

  it("servidor dice user:null (200 OK) → SÍ borra token (token expirado/inválido)", async () => {
    useAuthStore.setState({ token: "token.expirado", user: mockUser });
    global.fetch = stubFetch({ user: null }, 200);

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });
});

// ── 4. restoreSession — comportamiento correcto en flujo normal ───────────────

describe("authStore.restoreSession() — flujo feliz", () => {
  it("restaura el usuario cuando el token es válido", async () => {
    useAuthStore.setState({ token: "valid.token" });
    global.fetch = stubFetch({ user: mockUser });

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().user).toEqual(mockUser);
    expect(useAuthStore.getState().isRestoringSession).toBe(false);
    expect(useAuthStore.getState().hasRestoredSession).toBe(true);
  });

  it("envía credentials:include para mantener compatibilidad con cookies en otros browsers", async () => {
    useAuthStore.setState({ token: "some.token" });
    global.fetch = stubFetch({ user: mockUser });

    await useAuthStore.getState().restoreSession();

    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].credentials).toBe("include");
  });
});

// ── 5. api.ts — Authorization header en todos los requests ───────────────────

describe("api — Authorization: Bearer en requests (fix cross-domain iOS)", () => {
  it("api.get() incluye Bearer token cuando hay token en el store", async () => {
    useAuthStore.setState({ token: "api.bearer.token" });
    global.fetch = stubFetch({ data: "ok" });

    await api.get("/cliente/perfil");

    expect(capturedFetchHeaders().get("Authorization")).toBe("Bearer api.bearer.token");
  });

  it("api.post() incluye Bearer token en requests con body", async () => {
    useAuthStore.setState({ token: "api.post.token" });
    global.fetch = stubFetch({ ok: true });

    await api.post("/cliente/algo", { valor: 1 });

    expect(capturedFetchHeaders().get("Authorization")).toBe("Bearer api.post.token");
  });

  it("api.get() NO incluye Authorization cuando no hay token", async () => {
    useAuthStore.setState({ token: null });
    global.fetch = stubFetch({ data: "ok" });

    await api.get("/cliente/perfil");

    expect(capturedFetchHeaders().get("Authorization")).toBeNull();
  });

  it("api sigue enviando credentials:include para no romper cookies en otros browsers", async () => {
    useAuthStore.setState({ token: "some.token" });
    global.fetch = stubFetch({ data: "ok" });

    await api.get("/cliente/perfil");

    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].credentials).toBe("include");
  });

  it("api.post() lleva X-CSRF-Token además del Bearer", async () => {
    useAuthStore.setState({ token: "csrf.test.token" });
    global.fetch = stubFetch({ ok: true });

    await api.post("/cliente/algo", { valor: 1 });

    const headers = capturedFetchHeaders();
    expect(headers.get("X-CSRF-Token")).toBe("mock-csrf-token-16chars");
    expect(headers.get("Authorization")).toBe("Bearer csrf.test.token");
  });

  it("api lee token de localStorage como fallback si no está en el store (race condition)", async () => {
    useAuthStore.setState({ token: null });
    writeTokenToLocalStorage("token.solo.en.localstorage");
    global.fetch = stubFetch({ data: "ok" });

    await api.get("/cliente/perfil");

    expect(capturedFetchHeaders().get("Authorization")).toBe("Bearer token.solo.en.localstorage");
  });
});

// ── 6. api.ts — manejo defensivo de 401 (fix iOS auto-logout) ─────────────────

describe("api — manejo defensivo de 401 (evita auto-logout agresivo)", () => {
  it("401 con token enviado → ejecuta logout (token rechazado por el server)", async () => {
    useAuthStore.setState({ token: "token.invalido", user: mockUser });
    global.fetch = stubFetch({ error: "Token invalido" }, 401);

    await expect(api.get("/cliente/perfil")).rejects.toThrow();

    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().token).toBeNull();
  });

  it("401 SIN token enviado → NO ejecuta logout (preserva sesión persistida)", async () => {
    // Simula: store no hidratado (token null), localStorage también vacío,
    // pero por algún motivo se hace una llamada que devuelve 401.
    useAuthStore.setState({ token: null, user: mockUser });
    global.fetch = stubFetch({ error: "Token requerido" }, 401);

    await expect(api.get("/cliente/perfil")).rejects.toThrow();

    // Sesión preservada — no se destruye sin razón
    expect(useAuthStore.getState().user).toEqual(mockUser);
  });

  it("401 NO hace window.location.assign (evita hard reload)", async () => {
    useAuthStore.setState({ token: "token.invalido", user: mockUser });
    global.fetch = stubFetch({ error: "expired" }, 401);

    // Spy sobre window.location.assign
    const assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, assign: assignSpy, pathname: "/cliente" },
      writable: true,
    });

    await expect(api.get("/cliente/perfil")).rejects.toThrow();

    expect(assignSpy).not.toHaveBeenCalled();
  });
});
