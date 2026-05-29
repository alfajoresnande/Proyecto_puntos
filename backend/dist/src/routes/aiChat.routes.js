"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../auth");
const aiChat_controller_1 = require("../controllers/aiChat.controller");
const router = (0, express_1.Router)();
router.use((req, _res, next) => {
    const payload = (0, auth_1.getAuthPayload)(req);
    if (payload)
        req.user = payload;
    next();
});
router.post("/chat", aiChat_controller_1.postAiChat);
exports.default = router;
