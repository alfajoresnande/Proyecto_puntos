import { Router } from "express";
import { pool, qOne, qAll } from "../db";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const rows = await qAll(pool, "SELECT slug, titulo FROM paginas_contenido");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Error al cargar páginas" });
  }
});

router.get("/:slug", async (req, res) => {
  try {
    const { slug } = req.params;
    const page = await qOne(pool,
      "SELECT slug, titulo, contenido, updated_at FROM paginas_contenido WHERE slug = ?",
      [slug]
    );
    if (!page) { res.status(404).json({ error: "Página no encontrada" }); return; }
    res.json(page);
  } catch (err) {
    res.status(500).json({ error: "Error al cargar la página" });
  }
});

export default router;
