"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../auth");
const aiChat_controller_1 = require("../controllers/aiChat.controller");
const db_1 = require("../db");
const router = (0, express_1.Router)();
router.use(async (req, _res, next) => {
    // Estado verificado contra la base: un token de una cuenta desactivada o
    // degradada no arrastra su rol viejo al chat.
    const payload = await (0, auth_1.getVerifiedUser)(req);
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
