/**
 * El front corre en alfajorescorrentinos.com y la API en nandengineer.shop.
 * La cookie `csrf_token` la setea el backend en SU dominio, asi que
 * `document.cookie` del front nunca la ve: leerla ahi devuelve "" siempre.
 *
 * Por eso el token tiene que quedar en memoria cuando el servidor lo emite.
 * Todo lo que manda `X-CSRF-Token` con un fetch propio (recuperar contrasena,
 * resetear contrasena, heartbeat de presencia) usa el `getCsrfToken()`
 * sincrono y NO reintenta ante un 403: si esto se rompe, esas pantallas dejan
 * de funcionar en produccion sin ningun error visible.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN_DEL_SERVIDOR = "nonce.1787467138.firma-del-servidor";

async function importarCsrfLimpio() {
  vi.resetModules();
  return import("../lib/csrf");
}

describe("token CSRF con backend en otro dominio", () => {
  beforeEach(() => {
    // Sin cookie legible: es lo que pasa de verdad entre dominios distintos.
    Object.defineProperty(document, "cookie", { value: "", writable: true, configurable: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sin haber pedido el token todavía, no hay nada que mandar", async () => {
    const { getCsrfToken } = await importarCsrfLimpio();
    expect(getCsrfToken()).toBe("");
  });

  it("después de pedirlo, getCsrfToken() lo devuelve aunque la cookie no se vea", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ token: TOKEN_DEL_SERVIDOR }), { status: 200 })),
    );

    const { getCsrfToken, refreshCsrfToken } = await importarCsrfLimpio();

    expect(await refreshCsrfToken()).toBe(TOKEN_DEL_SERVIDOR);
    // Este es el punto: el valor sobrevive a la llamada, en memoria.
    expect(getCsrfToken()).toBe(TOKEN_DEL_SERVIDOR);
    expect(document.cookie).toBe("");
  });

  it("si el servidor falla, no deja un token inventado dando vueltas", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));

    const { getCsrfToken, refreshCsrfToken } = await importarCsrfLimpio();

    expect(await refreshCsrfToken()).toBe("");
    expect(getCsrfToken()).toBe("");
  });

  it("sigue prefiriendo la cookie si algún día front y API comparten dominio", async () => {
    Object.defineProperty(document, "cookie", {
      value: "csrf_token=token-de-la-cookie",
      writable: true,
      configurable: true,
    });

    const { getCsrfToken, readCsrfCookie } = await importarCsrfLimpio();

    expect(readCsrfCookie()).toBe("token-de-la-cookie");
    expect(getCsrfToken()).toBe("token-de-la-cookie");
  });
});
