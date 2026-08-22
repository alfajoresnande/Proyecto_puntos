/**
 * Tests del validador de URLs de navegación.
 *
 * Contexto: el texto que devuelve el chatbot se parsea como markdown y sus
 * links terminan en un href/to. El nombre y la descripción de los productos
 * van textuales al prompt del modelo, así que esa URL es contenido no
 * confiable: React 18 renderiza `href="javascript:..."` igual (solo avisa
 * por consola), o sea que sin este filtro es XSS almacenado.
 *
 * Espejo de backend/src/urlSafety.ts. Si cambia uno, cambia el otro.
 */
import { describe, expect, it } from "vitest";
import { isInternalNavigationPath, normalizeSafeNavigationUrl } from "../lib/urlSafety";

describe("normalizeSafeNavigationUrl", () => {
  it("acepta rutas internas y URLs http/https", () => {
    expect(normalizeSafeNavigationUrl("/tienda")).toBe("/tienda");
    expect(normalizeSafeNavigationUrl("/catalogo?page=2")).toBe("/catalogo?page=2");
    expect(normalizeSafeNavigationUrl("https://alfajorescorrentinos.com/")).toBe(
      "https://alfajorescorrentinos.com/",
    );
    expect(normalizeSafeNavigationUrl("#indice")).toBe("#indice");
  });

  it("rechaza los protocolos que ejecutan código", () => {
    expect(normalizeSafeNavigationUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeSafeNavigationUrl("JavaScript:alert(1)")).toBeNull();
    expect(normalizeSafeNavigationUrl("  javascript:alert(1)  ")).toBeNull();
    expect(normalizeSafeNavigationUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(normalizeSafeNavigationUrl("vbscript:msgbox(1)")).toBeNull();
  });

  it("rechaza protocol-relative: '//evil.com' arranca con '/' pero sale del sitio", () => {
    expect(normalizeSafeNavigationUrl("//evil.com")).toBeNull();
    expect(isInternalNavigationPath("//evil.com")).toBe(false);
  });

  it("rechaza vacíos y basura sin protocolo", () => {
    expect(normalizeSafeNavigationUrl("")).toBeNull();
    expect(normalizeSafeNavigationUrl("   ")).toBeNull();
    expect(normalizeSafeNavigationUrl(null)).toBeNull();
    expect(normalizeSafeNavigationUrl(undefined)).toBeNull();
    expect(normalizeSafeNavigationUrl("#")).toBeNull();
    expect(normalizeSafeNavigationUrl("no es una url")).toBeNull();
  });

  it("distingue interno de externo para elegir Link o <a>", () => {
    expect(isInternalNavigationPath("/tienda")).toBe(true);
    expect(isInternalNavigationPath("https://wa.me/549379")).toBe(false);
    expect(isInternalNavigationPath("#indice")).toBe(false);
  });
});
