import { Router } from "express";
import { pool, qAll } from "../db";

const router = Router();

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
