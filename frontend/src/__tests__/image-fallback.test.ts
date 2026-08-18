/**
 * Tests del fallback de imágenes (dropSrcSetOnError).
 *
 * Contexto: el backend genera las variantes WebP al vuelo, en el primer
 * pedido. Mientras se genera, la respuesta puede ser un error, y sin
 * reintentos la imagen queda rota hasta que el usuario recarga la página
 * a mano — que es justo lo que se quería evitar.
 *
 * Orden esperado ante fallos sucesivos:
 *   1. Se descarta el srcset y se prueba el canónico.
 *   2. Si el canónico también falla, se reintenta con espera creciente.
 *   3. Después de MAX_IMAGE_RETRIES se deja de insistir (una imagen que
 *      realmente no existe no debe generar pedidos infinitos).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { dropSrcSetOnError } from "../lib/apiBase";

function makeImg(src: string, srcset?: string): HTMLImageElement {
  const img = document.createElement("img");
  img.src = src;
  if (srcset) {
    img.setAttribute("srcset", srcset);
    img.setAttribute("sizes", "100vw");
  }
  return img;
}

const fire = (img: HTMLImageElement) =>
  dropSrcSetOnError({ currentTarget: img } as unknown as { currentTarget: HTMLImageElement });

describe("dropSrcSetOnError", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("primero descarta el srcset y conserva el src canónico", () => {
    const img = makeImg("https://api.test/uploads/foto.webp", "https://api.test/uploads/foto-card.webp 600w");

    fire(img);

    expect(img.hasAttribute("srcset")).toBe(false);
    expect(img.hasAttribute("sizes")).toBe(false);
    expect(img.src).toBe("https://api.test/uploads/foto.webp");
    // Todavía no debe haber reintento: al canónico no se le dio su chance.
    expect(img.dataset.imgRetry).toBeUndefined();
  });

  it("reintenta el canónico con espera creciente cuando también falla", () => {
    const img = makeImg("https://api.test/uploads/foto.webp");

    fire(img);
    expect(img.dataset.imgRetry).toBe("1");
    expect(img.src).toBe("https://api.test/uploads/foto.webp"); // aún no

    vi.advanceTimersByTime(700);
    expect(img.src).toBe("https://api.test/uploads/foto.webp?reintento=1");

    fire(img);
    expect(img.dataset.imgRetry).toBe("2");
    vi.advanceTimersByTime(1400); // la espera crece
    expect(img.src).toBe("https://api.test/uploads/foto.webp?reintento=2");
  });

  it("deja de reintentar tras el máximo, sin acumular query strings", () => {
    const img = makeImg("https://api.test/uploads/fantasma.webp");

    fire(img);
    vi.advanceTimersByTime(700);
    fire(img);
    vi.advanceTimersByTime(1400);

    const srcTrasElMaximo = img.src;
    fire(img); // tercer fallo: ya no debe programar nada
    vi.advanceTimersByTime(10_000);

    expect(img.src).toBe(srcTrasElMaximo);
    expect(img.dataset.imgRetry).toBe("2");
    // El sufijo se reemplaza, no se encadena.
    expect(img.src.match(/\?/g)?.length).toBe(1);
  });

  it("no rompe si el src no tiene query string previo ni srcset", () => {
    const img = makeImg("https://api.test/uploads/simple.png");
    expect(() => fire(img)).not.toThrow();
    vi.advanceTimersByTime(700);
    expect(img.src).toContain("simple.png?reintento=1");
  });
});
