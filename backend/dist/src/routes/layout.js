"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const router = (0, express_1.Router)();
router.get("/timeline", async (_req, res) => {
    try {
        const rows = await (0, db_1.qAll)(db_1.pool, "SELECT * FROM layout_timeline_eventos WHERE activo = 1 ORDER BY orden ASC");
        res.json(rows);
    }
    catch (err) {
        console.error("Error al cargar timeline:", err);
        res.status(500).json({ error: "Error interno" });
    }
});
router.get("/version", async (_req, res) => {
    try {
        const rows = await (0, db_1.qAll)(db_1.pool, "SELECT MAX(updated_at) as version FROM layout_timeline_eventos");
        res.json({ version: rows[0]?.version || "0" });
    }
    catch (err) {
        res.status(500).json({ error: "Error interno" });
    }
});
exports.default = router;
