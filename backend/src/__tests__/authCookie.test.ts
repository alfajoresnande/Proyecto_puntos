import { describe, expect, it } from "vitest";
import {
  HOST_PREFIXED_COOKIE_NAME,
  LEGACY_COOKIE_NAME,
  parseCookieHeader,
  readTokenFromCookies,
  resolveCookiePolicy,
  validarPoliticaCookie,
} from "../authCookie";

describe("SEC-03 / SEC-09 · politica de la cookie de sesion", () => {
  it("en produccion usa __Host-auth_token, Secure, HttpOnly, Path=/ y sin Domain", () => {
    const policy = resolveCookiePolicy({ NODE_ENV: "production" });
    expect(policy.name).toBe(HOST_PREFIXED_COOKIE_NAME);
    expect(policy.secure).toBe(true);
    expect(policy.httpOnly).toBe(true);
    expect(policy.path).toBe("/");
    expect(policy.sameSite).toBe("lax");
    // No hay campo `domain` en la politica: la cookie queda host-only,
    // requisito del prefijo __Host-.
    expect(Object.prototype.hasOwnProperty.call(policy, "domain")).toBe(false);
  });

  it("en desarrollo sobre http cae al nombre sin prefijo (el navegador descartaria __Host- sin Secure)", () => {
    const policy = resolveCookiePolicy({ NODE_ENV: "development" });
    expect(policy.name).toBe(LEGACY_COOKIE_NAME);
    expect(policy.secure).toBe(false);
  });

  it("aborta el arranque si en produccion las cookies no son Secure", () => {
    const env = { NODE_ENV: "production", AUTH_COOKIE_SECURE: "false" };
    const problemas = validarPoliticaCookie(resolveCookiePolicy(env), env);
    expect(problemas.map((p) => p.code)).toContain("cookie_insegura_en_produccion");
  });

  it("no permite SameSite=None sin Secure", () => {
    const env = { NODE_ENV: "development", AUTH_COOKIE_SAMESITE: "none", AUTH_COOKIE_SECURE: "false" };
    const problemas = validarPoliticaCookie(resolveCookiePolicy(env), env);
    expect(problemas.map((p) => p.code)).toContain("samesite_none_sin_secure");
  });

  it("acepta SameSite=None con Secure (despliegue cross-site)", () => {
    const env = { NODE_ENV: "production", AUTH_COOKIE_SAMESITE: "none", AUTH_COOKIE_SECURE: "true" };
    const policy = resolveCookiePolicy(env);
    expect(policy.sameSite).toBe("none");
    expect(policy.secure).toBe(true);
    expect(validarPoliticaCookie(policy, env)).toEqual([]);
  });

  it("no permite un nombre __Host- sin Secure", () => {
    const env = { NODE_ENV: "development", AUTH_COOKIE_NAME: "__Host-auth_token", AUTH_COOKIE_SECURE: "false" };
    const problemas = validarPoliticaCookie(resolveCookiePolicy(env), env);
    expect(problemas.map((p) => p.code)).toContain("host_prefix_sin_secure");
  });

  it("una configuracion de produccion valida no reporta problemas", () => {
    const env = { NODE_ENV: "production" };
    expect(validarPoliticaCookie(resolveCookiePolicy(env), env)).toEqual([]);
  });
});

describe("SEC-03 · lectura del token", () => {
  const policy = resolveCookiePolicy({ NODE_ENV: "production" });

  it("lee la cookie con prefijo __Host-", () => {
    expect(readTokenFromCookies("__Host-auth_token=jwt-nuevo", policy)).toBe("jwt-nuevo");
  });

  it("sigue leyendo la cookie vieja durante la migracion", () => {
    expect(readTokenFromCookies("auth_token=jwt-viejo", policy)).toBe("jwt-viejo");
  });

  it("prefiere la cookie nueva si estan las dos", () => {
    expect(readTokenFromCookies("auth_token=viejo; __Host-auth_token=nuevo", policy)).toBe("nuevo");
  });

  it("limpia ambos nombres al cerrar sesion", () => {
    expect(policy.readCandidates).toContain(HOST_PREFIXED_COOKIE_NAME);
    expect(policy.readCandidates).toContain(LEGACY_COOKIE_NAME);
  });

  it("devuelve null si no hay cookie", () => {
    expect(readTokenFromCookies(undefined, policy)).toBeNull();
    expect(readTokenFromCookies("otra=cosa", policy)).toBeNull();
  });

  it("parsea cabeceras raras sin romperse", () => {
    expect(parseCookieHeader("a=1; =2; b; c=3")).toEqual({ a: "1", c: "3" });
    expect(parseCookieHeader("mal=%E0%A4%A")).toEqual({ mal: "%E0%A4%A" });
  });
});
