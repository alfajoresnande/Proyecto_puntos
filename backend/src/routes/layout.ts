import { Router } from "express";
import { pool, qAll } from "../db";

const router = Router();
const EVENTBAR_KEYS = [
  "eventbar_activo",
  "eventbar_titulo",
  "eventbar_fecha_fin",
  "eventbar_color_fondo",
  "eventbar_color_texto",
] as const;

function parseConfigBoolean(value: string | undefined): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["1", "true", "si", "yes", "on"].includes(normalized);
}

function normalizeHexColor(value: string | undefined, fallback: string): string {
  const normalized = String(value ?? "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized : fallback;
}

function parseEventDate(value: string | undefined): Date | null {
  const date = new Date(String(value ?? ""));
  if (!Number.isFinite(date.getTime())) return null;
  return date;
}

router.get("/timeline", async (_req, res) => {
  try {
    const rows = await qAll(
      pool,
      "SELECT * FROM layout_timeline_eventos WHERE activo = 1 ORDER BY orden ASC"
    );
    res.json(rows);
  } catch (err) {
    console.error("Error al cargar timeline:", err);
    res.status(500).json({ error: "Error interno" });
  }
});

router.get("/version", async (_req, res) => {
  try {
    const rows = await qAll<{ version: string }>(
      pool,
      "SELECT MAX(updated_at) as version FROM layout_timeline_eventos"
    );
    res.json({ version: rows[0]?.version || "0" });
  } catch (err) {
    res.status(500).json({ error: "Error interno" });
  }
});

router.get("/eventbar", async (_req, res) => {
  try {
    const placeholders = EVENTBAR_KEYS.map(() => "?").join(", ");
    const rows = await qAll<{ clave: string; valor: string }>(
      pool,
      `SELECT clave, valor FROM configuracion WHERE clave IN (${placeholders})`,
      [...EVENTBAR_KEYS],
    );
    const config = new Map(rows.map((row) => [row.clave, row.valor]));
    const active = parseConfigBoolean(config.get("eventbar_activo"));
    const title = String(config.get("eventbar_titulo") ?? "").trim();
    const endDate = parseEventDate(config.get("eventbar_fecha_fin"));

    if (!active || !title || !endDate || endDate.getTime() <= Date.now()) {
      res.json({ active: false });
      return;
    }

    res.json({
      active: true,
      titulo: title.slice(0, 120),
      fecha_fin: endDate.toISOString(),
      color_fondo: normalizeHexColor(config.get("eventbar_color_fondo"), "#6B3E26"),
      color_texto: normalizeHexColor(config.get("eventbar_color_texto"), "#FFFFFF"),
    });
  } catch (err) {
    console.error("Error al cargar eventbar:", err);
    res.status(500).json({ error: "Error interno" });
  }
});
router.get("/categorias", async (_req, res) => {
  try {
    const rows = await qAll(
      pool,
      "SELECT id, nombre, descripcion, imagen_url FROM categorias WHERE activo = 1 AND mostrar_en_home = 1 ORDER BY orden ASC, nombre ASC"
    );
    res.json(rows);
  } catch (err) {
    console.error("Error al cargar categorias home:", err);
    res.status(500).json({ error: "Error interno" });
  }
});

export default router;
