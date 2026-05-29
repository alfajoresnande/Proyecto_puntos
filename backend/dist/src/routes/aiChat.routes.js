"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../auth");
const aiChat_controller_1 = require("../controllers/aiChat.controller");
const db_1 = require("../db");
const router = (0, express_1.Router)();
router.use((req, _res, next) => {
    const payload = (0, auth_1.getAuthPayload)(req);
    if (payload)
        req.user = payload;
    next();
});
router.get("/status", async (_req, res) => {
    try {
        const row = await (0, db_1.qOne)(db_1.pool, "SELECT valor FROM configuracion WHERE clave = 'chatbot_activo' LIMIT 1");
        const valor = (row?.valor ?? "1").trim().toLowerCase();
        const enabled = ["1", "true", "yes", "on"].includes(valor);
        res.json({ enabled });
    }
    catch {
        // Si falla la consulta, asumimos que el chatbot está habilitado (default seguro)
        res.json({ enabled: true });
    }
});
router.post("/chat", aiChat_controller_1.postAiChat);
exports.default = router;
