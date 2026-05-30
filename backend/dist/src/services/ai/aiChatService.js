"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.answerAiChat = answerAiChat;
const aiSystemPrompt_1 = require("./aiSystemPrompt");
const groqClients_1 = require("./groqClients");
const aiRouter_1 = require("./aiRouter");
const aiUsageLimiter_1 = require("./aiUsageLimiter");
const db_1 = require("../../db");
function readBooleanEnv(name, fallback) {
    const value = process.env[name]?.trim().toLowerCase();
    if (!value)
        return fallback;
    return ["1", "true", "yes", "on"].includes(value);
}
function sanitizePromptValue(value, fallback, maxLength = 180) {
    const normalized = (value || "")
        .replace(/[\u0000-\u001F\u007F]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLength);
    return normalized || fallback;
}
async function getProductsContext() {
    try {
        const productos = await (0, db_1.qAll)(db_1.pool, "SELECT id, nombre, descripcion, precio_dinero, precio_puntos FROM productos WHERE activo = 1");
        if (!productos || productos.length === 0)
            return "No hay productos activos en este momento.";
        let ctx = "CATÁLOGO DE PRODUCTOS ACTUALIZADO:\n";
        for (const p of productos) {
            ctx += `- ${p.nombre}: ${p.descripcion || "Sin descripción"}. Precio: $${p.precio_dinero || 0} / Puntos: ${p.precio_puntos || 0}\n`;
        }
        return ctx;
    }
    catch (error) {
        console.error("[ai-chat] Error fetching products context", error);
        return "El catálogo de productos no se pudo cargar temporalmente.";
    }
}
async function getEnvioGratisContext() {
    try {
        const row = await (0, db_1.qOne)(db_1.pool, "SELECT valor FROM configuracion WHERE clave = 'envio_gratis_monto_minimo'");
        const monto = Number(row?.valor || 0);
        let shippingRules = "";
        if (monto > 0) {
            shippingRules += `- Envíos en Corrientes Capital: Si la compra supera los $${monto}, el envío es GRATIS. Si es menor, tiene un pequeño costo dependiendo de la dirección.\n`;
        }
        else {
            shippingRules += `- Envíos en Corrientes Capital: Tienen un pequeño costo de envío dependiendo de la dirección.\n`;
        }
        shippingRules += `- Si la app no toma la dirección del usuario en Corrientes Capital, indicale que puede coordinar el envío contactándose por [Instagram](https://www.instagram.com/alfajorescorrentinos/), [WhatsApp](https://wa.me/5493794632610?text=Hola,%20buenas%20te%20quiero%20consultar%20sobre%20....) o [Mensajes](/mensajes).
- Envíos a otras ciudades o provincias: Se debe consultar disponibilidad y costos contactándose directamente por mensajería de la app, Instagram o WhatsApp.`;
        return shippingRules;
    }
    catch (error) {
        console.error("[ai-chat] Error fetching config context", error);
        return "";
    }
}
async function buildMessages(input) {
    const currentPath = sanitizePromptValue(input.context?.currentPath, "desconocida");
    const userRole = input.context?.userRole ?? "anonimo";
    const message = input.message.trim().slice(0, 500);
    const productsContext = await getProductsContext();
    const envioGratisContext = await getEnvioGratisContext();
    return [
        {
            role: "system",
            content: `${aiSystemPrompt_1.AI_SYSTEM_PROMPT}\n\n${envioGratisContext}\n\n${productsContext}`
        },
        {
            role: "user",
            content: `
Ruta actual: ${currentPath}
Rol del usuario: ${userRole}

Pregunta del usuario:
${message}
`,
        },
    ];
}
function normalizeTokens(usage) {
    if (!usage || typeof usage !== "object")
        return undefined;
    const raw = usage;
    const tokens = {};
    for (const key of ["prompt_tokens", "completion_tokens", "total_tokens"]) {
        if (typeof raw[key] === "number")
            tokens[key] = raw[key];
    }
    return Object.keys(tokens).length ? tokens : undefined;
}
function safeErrorReason(error) {
    const status = (0, aiRouter_1.getGroqErrorStatus)(error);
    if (status)
        return `groq_status_${status}`;
    if (error instanceof Error && error.name)
        return error.name;
    return "unknown_error";
}
function logAiChatEvent(event) {
    console.info("[ai-chat]", JSON.stringify({
        fecha: new Date().toISOString(),
        userId: event.userId ?? null,
        ipHash: event.ipHash,
        provider: event.provider ?? null,
        model: event.model ?? null,
        tokens: event.tokens ?? null,
        status: event.status,
        reason: event.reason ?? null,
    }));
}
function fallbackResponse() {
    return {
        ok: false,
        answer: aiSystemPrompt_1.AI_CHAT_FALLBACK_ANSWER,
        fallback: true,
    };
}
async function isChatbotActivoInDb() {
    try {
        const row = await (0, db_1.qOne)(db_1.pool, "SELECT valor FROM configuracion WHERE clave = 'chatbot_activo' LIMIT 1");
        if (!row)
            return true; // si no existe la fila, default es activo
        const valor = row.valor.trim().toLowerCase();
        return ["1", "true", "yes", "on"].includes(valor);
    }
    catch {
        return true; // si falla la consulta, no bloquear el chat
    }
}
async function answerAiChat(input) {
    const model = (0, groqClients_1.getGroqModel)();
    if (!readBooleanEnv("AI_CHAT_ENABLED", false)) {
        logAiChatEvent({
            userId: input.userId,
            ipHash: input.ipHash,
            model,
            status: "fallback",
            reason: "disabled",
        });
        return fallbackResponse();
    }
    if (!(await isChatbotActivoInDb())) {
        logAiChatEvent({
            userId: input.userId,
            ipHash: input.ipHash,
            model,
            status: "fallback",
            reason: "disabled_by_admin",
        });
        return fallbackResponse();
    }
    const usage = (0, aiUsageLimiter_1.checkAndConsumeAiUsage)({ userId: input.userId, ipHash: input.ipHash });
    if (!usage.allowed) {
        logAiChatEvent({
            userId: input.userId,
            ipHash: input.ipHash,
            model,
            status: "fallback",
            reason: usage.reason,
        });
        return fallbackResponse();
    }
    const { candidates } = (0, aiRouter_1.getAiProviderCandidates)();
    if (!candidates.length) {
        logAiChatEvent({
            userId: input.userId,
            ipHash: input.ipHash,
            model,
            status: "fallback",
            reason: "no_available_provider",
        });
        return fallbackResponse();
    }
    const messages = await buildMessages(input);
    for (const candidate of candidates) {
        try {
            const completion = await candidate.client.chat.completions.create({
                model,
                messages,
                temperature: 0.3,
                max_tokens: (0, groqClients_1.getAiChatMaxOutputTokens)(),
                stream: false,
            });
            const answer = completion.choices[0]?.message?.content?.trim();
            (0, aiRouter_1.recordAiProviderSuccess)(candidate);
            if (!answer) {
                logAiChatEvent({
                    userId: input.userId,
                    ipHash: input.ipHash,
                    provider: candidate.publicProvider,
                    model: completion.model || model,
                    tokens: normalizeTokens(completion.usage),
                    status: "fallback",
                    reason: "empty_response",
                });
                return fallbackResponse();
            }
            logAiChatEvent({
                userId: input.userId,
                ipHash: input.ipHash,
                provider: candidate.publicProvider,
                model: completion.model || model,
                tokens: normalizeTokens(completion.usage),
                status: "success",
            });
            return {
                ok: true,
                answer,
                provider: candidate.publicProvider,
                model: completion.model || model,
            };
        }
        catch (error) {
            const failure = (0, aiRouter_1.recordAiProviderFailure)(candidate, error);
            logAiChatEvent({
                userId: input.userId,
                ipHash: input.ipHash,
                provider: candidate.publicProvider,
                model,
                status: "error",
                reason: failure.status ? `groq_status_${failure.status}` : safeErrorReason(error),
            });
        }
    }
    logAiChatEvent({
        userId: input.userId,
        ipHash: input.ipHash,
        model,
        status: "fallback",
        reason: "providers_failed",
    });
    return fallbackResponse();
}
