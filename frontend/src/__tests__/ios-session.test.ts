/**
 * Tests para el fix de sesión en iOS Safari.
 *
 * Problema original: iOS bloquea cookies cross-domain (Vercel → Hostinger) por ITP.
 * Solución: guardar el JWT en localStorage y enviarlo como Authorization: Bearer en
 * cada request, sin depender de cookies.
 *
 * Estos tests verifican que la solución funciona correctamente.
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

// ── Helpers ─────────────────────────────────────────────────────────────────

const mockUser: User = {
  id: 1,
  nombre: "Test User",
  email: "test@test.com",
  rol: "cliente",
  dni: "12345678",
  puntos_saldo: 50,
  codigo_invitacion: "ABC123XYZ",
};

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

function capturedHeaders(): Headers {
  const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
  return calls[0][1].headers as Headers;
}

function capturedPlainHeaders(): Record<string, string> {
  const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
  return calls[0][1].headers as Record<string, string>;
}

// ── Reset entre tests ────────────────────────────────────────────────────────

beforeEach(() => {
  useAuthStore.setState({
    user: null,
    token: null,
    isRestoringSession: false,
    hasRestoredSession: false,
  });
  vi.restoreAllMocks();
  localStorage.clear();
});

// ── authStore: almacenamiento del token ──────────────────────────────────────

describe("authStore — token almacenado después de autenticación", () => {
  it("login() guarda el token retornado por el backend", async () => {
    global.fetch = stubFetch({ user: mockUser, token: "jwt.login.token" });

    await useAuthStore.getState().login({ email: "test@test.com", password: "pass123456789" });

    expect(useAuthStore.getState().token).toBe("jwt.login.token");
    expect(useAuthStore.getState().user).toEqual(mockUser);
  });

  it("register() guarda el token retornado por el backend", async () => {
    global.fetch = stubFetch({ user: mockUser, token: "jwt.register.token" });

    await useAuthStore.getState().register({
      nombre: "Test",
      dni: "12345678",
      email: "test@test.com",
      password: "pass123456789",
    });

    expect(useAuthStore.getState().token).toBe("jwt.register.token");
  });

  it("loginWithGoogle() guarda el token retornado por el backend", async () => {
    global.fetch = stubFetch({ user: mockUser, token: "jwt.google.token" });

    await useAuthStore.getState().loginWithGoogle("google-credential-xyz");

    expect(useAuthStore.getState().token).toBe("jwt.google.token");
  });

  it("logout() borra el token del store", () => {
    useAuthStore.setState({ token: "token.a.borrar", user: mockUser });
    global.fetch = stubFetch({ ok: true });

    useAuthStore.getState().logout();

    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("login() sin token en la respuesta no rompe (token queda null)", async () => {
    global.fetch = stubFetch({ user: mockUser }); // sin campo token

    await useAuthStore.getState().login({ email: "test@test.com", password: "pass123456789" });

    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().user).toEqual(mockUser);
  });
});

// ── authStore: restoreSession envía Authorization header ─────────────────────

describe("authStore.restoreSession() — comportamiento clave para iOS", () => {
  it("envía Authorization: Bearer cuando hay token almacenado", async () => {
    useAuthStore.setState({ token: "stored.jwt.token" });
    global.fetch = stubFetch({ user: mockUser });

    await useAuthStore.getState().restoreSession();

    const headers = capturedPlainHeaders();
    expect(headers["Authorization"]).toBe("Bearer stored.jwt.token");
  });

  it("NO envía Authorization header cuando no hay token (usuario no logueado)", async () => {
    useAuthStore.setState({ token: null });
    global.fetch = stubFetch({ user: null });

    await useAuthStore.getState().restoreSession();

    const headers = capturedPlainHeaders();
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("sigue enviando credentials: include para compatibilidad con browsers no-iOS", async () => {
    useAuthStore.setState({ token: "some.token" });
    global.fetch = stubFetch({ user: mockUser });

    await useAuthStore.getState().restoreSession();

    const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[1].credentials).toBe("include");
  });

  it("restaura el usuario correctamente cuando el token es válido", async () => {
    useAuthStore.setState({ token: "valid.token" });
    global.fetch = stubFetch({ user: mockUser });

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().user).toEqual(mockUser);
    expect(useAuthStore.getState().isRestoringSession).toBe(false);
    expect(useAuthStore.getState().hasRestoredSession).toBe(true);
  });

  it("limpia user y token cuando /me devuelve user null (token expirado)", async () => {
    useAuthStore.setState({ token: "expired.token", user: mockUser });
    global.fetch = stubFetch({ user: null });

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().token).toBeNull();
  });

  it("limpia user y token cuando el fetch falla (sin red en iOS)", async () => {
    useAuthStore.setState({ token: "some.token", user: mockUser });
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().token).toBeNull();
  });
});

// ── api: Authorization header en todos los requests ──────────────────────────

describe("api — Authorization: Bearer en requests (fix cross-domain iOS)", () => {
  it("api.get() incluye Bearer token cuando hay token en el store", async () => {
    useAuthStore.setState({ token: "api.bearer.token" });
    global.fetch = stubFetch({ data: "ok" });

    await api.get("/cliente/perfil");

    const headers = capturedHeaders();
    expect(headers.get("Authorization")).toBe("Bearer api.bearer.token");
  });

  it("api.post() incluye Bearer token en requests con body", async () => {
    useAuthStore.setState({ token: "api.post.token" });
    global.fetch = stubFetch({ ok: true });

    await api.post("/cliente/algo", { valor: 1 });

    const headers = capturedHeaders();
    expect(headers.get("Authorization")).toBe("Bearer api.post.token");
  });

  it("api.get() NO incluye Authorization cuando no hay token", async () => {
    useAuthStore.setState({ token: null });
    global.fetch = stubFetch({ data: "ok" });

    await api.get("/cliente/perfil");

    const headers = capturedHeaders();
    expect(headers.get("Authorization")).toBeNull();
  });

  it("api sigue enviando credentials: include para no romper cookies en otros browsers", async () => {
    useAuthStore.setState({ token: "some.token" });
    global.fetch = stubFetch({ data: "ok" });

    await api.get("/cliente/perfil");

    const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[1].credentials).toBe("include");
  });

  it("api.post() incluye X-CSRF-Token además del Bearer", async () => {
    useAuthStore.setState({ token: "csrf.test.token" });
    global.fetch = stubFetch({ ok: true });

    await api.post("/cliente/algo", { valor: 1 });

    const headers = capturedHeaders();
    expect(headers.get("X-CSRF-Token")).toBe("mock-csrf-token-16chars");
    expect(headers.get("Authorization")).toBe("Bearer csrf.test.token");
  });
});
