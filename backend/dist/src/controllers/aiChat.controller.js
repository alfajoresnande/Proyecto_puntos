"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.postAiChat = postAiChat;
const zod_1 = require("zod");
const aiSystemPrompt_1 = require("../services/ai/aiSystemPrompt");
const aiChatService_1 = require("../services/ai/aiChatService");
const aiUsageLimiter_1 = require("../services/ai/aiUsageLimiter");
const aiChatRequestSchema = zod_1.z.object({
    message: zod_1.z
        .string()
        .trim()
        .min(1, "Mensaje requerido.")
        .max(500, "El mensaje no puede superar 500 caracteres."),
    conversationId: zod_1.z.string().trim().max(120).optional(),
    context: zod_1.z
        .object({
        currentPath: zod_1.z.string().trim().max(180).optional(),
        userRole: zod_1.z.enum(["cliente", "vendedor", "admin", "superadmin", "anonimo"]).optional(),
        orderId: zod_1.z.number().int().positive().optional(),
        productId: zod_1.z.number().int().positive().optional(),
    })
        .optional(),
});
function roleToAiRole(role) {
    if (role === "superAdmin")
        return "superadmin";
    if (role === "cliente" || role === "vendedor" || role === "admin")
        return role;
    return "anonimo";
}
function sanitizeContext(req, context) {
    return {
        currentPath: context?.currentPath,
        userRole: roleToAiRole(req.user?.rol),
        orderId: context?.orderId,
        productId: context?.productId,
    };
}
async function postAiChat(req, res) {
    const parsed = aiChatRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
        res.status(400).json({
            ok: false,
            answer: aiSystemPrompt_1.AI_CHAT_FALLBACK_ANSWER,
            fallback: true,
        });
        return;
    }
    try {
        const response = await (0, aiChatService_1.answerAiChat)({
            message: parsed.data.message,
            conversationId: parsed.data.conversationId,
            context: sanitizeContext(req, parsed.data.context),
            userId: req.user?.id,
            ipHash: (0, aiUsageLimiter_1.hashIpForAiLogs)(req.ip),
        });
        res.json(response);
    }
    catch {
        console.error("[ai-chat] controller_error");
        res.json({
            ok: false,
            answer: aiSystemPrompt_1.AI_CHAT_FALLBACK_ANSWER,
            fallback: true,
        });
    }
}
