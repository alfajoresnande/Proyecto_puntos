"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const router = (0, express_1.Router)();
router.get("/", async (_req, res) => {
    try {
        const rows = await (0, db_1.qAll)(db_1.pool, "SELECT slug, titulo FROM paginas_contenido");
        res.json(rows);
    }
    catch (err) {
        res.status(500).json({ error: "Error al cargar páginas" });
    }
});
router.get("/:slug", async (req, res) => {
    try {
        const { slug } = req.params;
        const page = await (0, db_1.qOne)(db_1.pool, "SELECT slug, titulo, contenido, updated_at FROM paginas_contenido WHERE slug = ?", [slug]);
        if (!page) {
            res.status(404).json({ error: "Página no encontrada" });
            return;
        }
        res.json(page);
    }
    catch (err) {
        res.status(500).json({ error: "Error al cargar la página" });
    }
});
exports.default = router;
