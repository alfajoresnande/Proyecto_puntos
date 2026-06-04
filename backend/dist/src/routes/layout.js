"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const router = (0, express_1.Router)();
const EVENTBAR_KEYS = [
    "eventbar_activo",
    "eventbar_titulo",
    "eventbar_subtitulo",
    "eventbar_fecha_fin",
    "eventbar_color_fondo",
    "eventbar_color_texto",
    "eventbar_descuento_especial_activo",
    "eventbar_descuento_especial_tipo",
];
function parseConfigBoolean(value) {
    const normalized = String(value ?? "").trim().toLowerCase();
    return ["1", "true", "si", "yes", "on"].includes(normalized);
}
function normalizeHexColor(value, fallback) {
    const normalized = String(value ?? "").trim();
    return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized : fallback;
}
function parseEventDate(value) {
    const date = new Date(String(value ?? ""));
    if (!Number.isFinite(date.getTime()))
        return null;
    return date;
}
function normalizeSpecialDiscountType(value) {
    const normalized = String(value ?? "").trim().toLowerCase().replace(/\s+/g, "").replace(/×/g, "x");
    if (normalized === "2x1" || normalized === "3x2" || normalized === "4x3")
        return normalized;
    return null;
}
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
router.get("/eventbar", async (_req, res) => {
    try {
        const placeholders = EVENTBAR_KEYS.map(() => "?").join(", ");
        const rows = await (0, db_1.qAll)(db_1.pool, `SELECT clave, valor FROM configuracion WHERE clave IN (${placeholders})`, [...EVENTBAR_KEYS]);
        const config = new Map(rows.map((row) => [row.clave, row.valor]));
        const active = parseConfigBoolean(config.get("eventbar_activo"));
        const title = String(config.get("eventbar_titulo") ?? "").trim();
        const subtitle = String(config.get("eventbar_subtitulo") ?? "").trim();
        const endDate = parseEventDate(config.get("eventbar_fecha_fin"));
        const specialDiscountType = normalizeSpecialDiscountType(config.get("eventbar_descuento_especial_tipo"));
        const specialDiscountActive = parseConfigBoolean(config.get("eventbar_descuento_especial_activo")) && Boolean(specialDiscountType);
        if (!active || !title || !endDate || endDate.getTime() <= Date.now()) {
            res.json({ active: false });
            return;
        }
        res.json({
            active: true,
            titulo: title.slice(0, 120),
            subtitulo: subtitle.slice(0, 160),
            fecha_fin: endDate.toISOString(),
            color_fondo: normalizeHexColor(config.get("eventbar_color_fondo"), "#2D1A0D"),
            color_texto: normalizeHexColor(config.get("eventbar_color_texto"), "#F3C47B"),
            descuento_especial_activo: specialDiscountActive,
            descuento_especial_tipo: specialDiscountType,
        });
    }
    catch (err) {
        console.error("Error al cargar eventbar:", err);
        res.status(500).json({ error: "Error interno" });
    }
});
router.get("/categorias", async (_req, res) => {
    try {
        const rows = await (0, db_1.qAll)(db_1.pool, "SELECT id, nombre, descripcion, imagen_url FROM categorias WHERE activo = 1 AND mostrar_en_home = 1 ORDER BY orden ASC, nombre ASC");
        res.json(rows);
    }
    catch (err) {
        console.error("Error al cargar categorias home:", err);
        res.status(500).json({ error: "Error interno" });
    }
});
exports.default = router;
