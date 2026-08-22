/**
 * El prompt del chatbot depende de dos interruptores de la app. Si alguien
 * vuelve a convertirlo en una constante fija, el bot ofrece canjes con el
 * programa de puntos apagado y linkea rutas que en ese momento no existen.
 */
import { describe, expect, it } from "vitest";
import { AI_CHAT_FALLBACK_ANSWER, buildSystemPrompt } from "../services/ai/aiSystemPrompt";

const RUTAS_DE_PUNTOS = ["/catalogo", "/mis-canjes", "/carrito-canjes"];

describe("buildSystemPrompt", () => {
  describe("con el programa de puntos APAGADO", () => {
    const prompt = buildSystemPrompt({ pointsEnabled: false, whatsappCatalogMode: false });

    it("no linkea ninguna ruta de puntos, porque no están disponibles", () => {
      for (const ruta of RUTAS_DE_PUNTOS) {
        expect(prompt).not.toContain(`(${ruta})`);
      }
    });

    it("saca puntos y canjes de la descripción de tareas", () => {
      const tareas = prompt.split("\n")[2] ?? "";
      expect(tareas).not.toMatch(/puntos|canjes/i);
    });

    it("le prohíbe mencionarlos por su cuenta", () => {
      expect(prompt).toContain("APAGADO");
      expect(prompt).toMatch(/NO menciones puntos, canjes ni referidos por tu cuenta/);
    });
  });

  describe("con el programa de puntos ACTIVO", () => {
    const prompt = buildSystemPrompt({ pointsEnabled: true, whatsappCatalogMode: false });

    it("ofrece el catálogo de canjes", () => {
      expect(prompt).toContain("(/catalogo)");
      expect(prompt).toContain("(/mis-canjes)");
    });

    it("deja que hable de puntos", () => {
      expect(prompt).toContain("ACTIVO");
      expect(prompt).toMatch(/puntos/i);
    });
  });

  describe("modo de venta", () => {
    it("en modo WhatsApp no explica el checkout online", () => {
      const prompt = buildSystemPrompt({ pointsEnabled: true, whatsappCatalogMode: true });
      expect(prompt).toContain("pedido por WhatsApp");
      expect(prompt).toMatch(/NO hay pago online/);
      expect(prompt).not.toContain("agrega productos al carrito");
    });

    it("en modo tienda sí lo explica", () => {
      const prompt = buildSystemPrompt({ pointsEnabled: true, whatsappCatalogMode: false });
      expect(prompt).toContain("tienda online");
      expect(prompt).toContain("agrega productos al carrito");
    });
  });

  describe("rutas", () => {
    // /mensajes nunca existió en App.tsx; el prompt viejo la linkeaba igual y
    // el bot repartía un link roto. La mensajería vive en /soporte.
    it("la mensajería apunta a /soporte, no a /mensajes", () => {
      for (const flags of [{ pointsEnabled: true }, { pointsEnabled: false }]) {
        const prompt = buildSystemPrompt({ ...flags, whatsappCatalogMode: false });
        expect(prompt).toContain("(/soporte)");
        expect(prompt).not.toContain("(/mensajes)");
      }
      expect(AI_CHAT_FALLBACK_ANSWER).toContain("(/soporte)");
      expect(AI_CHAT_FALLBACK_ANSWER).not.toContain("(/mensajes)");
    });

    it("incluye el contexto del negocio en los dos modos", () => {
      for (const pointsEnabled of [true, false]) {
        const prompt = buildSystemPrompt({ pointsEnabled, whatsappCatalogMode: false });
        expect(prompt).toContain("SOBRE EL NEGOCIO");
        expect(prompt).toContain("Corrientes");
        expect(prompt).toContain("SECCIONES DE LA APP");
      }
    });
  });
});
