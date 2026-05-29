"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../auth");
const authIdentity_1 = require("../services/authIdentity");
const appPresence_1 = require("../services/appPresence");
const router = (0, express_1.Router)();
const heartbeatSchema = zod_1.z.object({
    session_id: zod_1.z.string().trim().min(8).max(80),
    path: zod_1.z.string().trim().max(255).optional().default("/"),
    page_title: zod_1.z.string().trim().max(255).optional().nullable(),
    referrer: zod_1.z.string().trim().max(255).optional().nullable(),
    reason: zod_1.z.string().trim().max(40).optional().nullable(),
});
function isStaffRole(role) {
    return role === "admin" || role === "superAdmin" || role === "vendedor";
}
function isStaffPath(path) {
    return path.startsWith("/admin") || path.startsWith("/superadmin") || path.startsWith("/vendedor") || path.startsWith("/staff");
}
router.post("/heartbeat", async (req, res, next) => {
    const parsed = heartbeatSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0].message });
        return;
    }
    try {
        const auth = (0, auth_1.getAuthPayload)(req);
        const path = parsed.data.path.trim() || "/";
        if (isStaffRole(auth?.rol) || isStaffPath(path)) {
            res.status(204).end();
            return;
        }
        const visitorId = (0, authIdentity_1.getOrCreateDeviceId)(req, res);
        await (0, appPresence_1.recordAppPresence)({
            visitorId,
            sessionId: parsed.data.session_id,
            userId: auth?.rol === "cliente" ? Number(auth.id) : null,
            visitorType: auth?.rol === "cliente" ? "cliente" : "anonimo",
            path,
            pageTitle: parsed.data.page_title ?? null,
            referrer: parsed.data.referrer ?? null,
            ip: (0, authIdentity_1.getClientIp)(req),
            userAgent: req.get("user-agent") ?? null,
        });
        res.status(204).end();
    }
    catch (error) {
        next(error);
    }
});
exports.default = router;
