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

export default router;
