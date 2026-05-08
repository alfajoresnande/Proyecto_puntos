"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const router = (0, express_1.Router)();
router.get("/provincias", async (_req, res) => {
    const rows = await (0, db_1.qAll)(db_1.pool, `SELECT id, nombre
     FROM argentina_provincias
     ORDER BY nombre ASC`);
    res.json(rows);
});
router.get("/localidades", async (req, res) => {
    const provinciaIdRaw = typeof req.query.provincia_id === "string" ? req.query.provincia_id.trim() : "";
    const provinciaNombreRaw = typeof req.query.provincia === "string" ? req.query.provincia.trim() : "";
    let provinciaId = provinciaIdRaw;
    if (!provinciaId && provinciaNombreRaw) {
        const provincia = await (0, db_1.qOne)(db_1.pool, "SELECT id, nombre FROM argentina_provincias WHERE LOWER(nombre) = LOWER(?) LIMIT 1", [provinciaNombreRaw]);
        provinciaId = provincia?.id ?? "";
    }
    if (!/^\d{2}$/.test(provinciaId)) {
        res.status(400).json({ error: "Provincia invalida" });
        return;
    }
    const rows = await (0, db_1.qAll)(db_1.pool, `SELECT id, provincia_id, nombre
     FROM argentina_localidades
     WHERE provincia_id = ?
     ORDER BY nombre ASC`, [provinciaId]);
    res.json(rows);
});
exports.default = router;
