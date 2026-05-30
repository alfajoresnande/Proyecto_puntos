import type { Groq } from "groq-sdk";
import { AI_CHAT_FALLBACK_ANSWER, AI_SYSTEM_PROMPT } from "./aiSystemPrompt";
import { getAiChatMaxOutputTokens, getGroqModel, type AiPublicProvider } from "./groqClients";
import {
  getAiProviderCandidates,
  getGroqErrorStatus,
  recordAiProviderFailure,
  recordAiProviderSuccess,
} from "./aiRouter";
import { checkAndConsumeAiUsage } from "./aiUsageLimiter";
import { pool, qOne, qAll } from "../../db";

export type AiChatUserRole = "cliente" | "vendedor" | "admin" | "superadmin" | "anonimo";

export type AiChatRequestContext = {
  currentPath?: string;
  userRole?: AiChatUserRole;
  orderId?: number;
  productId?: number;
};

export type AiChatRequestBody = {
  message: string;
  conversationId?: string;
  context?: AiChatRequestContext;
};

export type AiChatResponseBody = {
  ok: boolean;
  answer: string;
  provider?: AiPublicProvider;
  model?: string;
  fallback?: boolean;
};

type AiChatServiceInput = AiChatRequestBody & {
  userId?: number;
  ipHash: string;
};

type AiUsageTokens = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

type AiChatLogEvent = {
  userId?: number;
  ipHash: string;
  provider?: AiPublicProvider;
  model?: string;
  tokens?: AiUsageTokens;
  status: "success" | "fallback" | "error";
  reason?: string;
};

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value);
}

function sanitizePromptValue(value: string | undefined, fallback: string, maxLength = 180): string {
  const normalized = (value || "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
  return normalized || fallback;
}

async function getProductsContext(): Promise<string> {
  try {
    const productos = await qAll<{
      id: number;
      nombre: string;
      descripcion: string | null;
      precio_dinero: number | null;
      precio_puntos: number | null;
    }>(
      pool,
      "SELECT id, nombre, descripcion, precio_dinero, precio_puntos FROM productos WHERE activo = 1",
    );

    if (!productos || productos.length === 0) return "No hay productos activos en este momento.";

    let ctx = "CATÁLOGO DE PRODUCTOS ACTUALIZADO:\n";
    for (const p of productos) {
      ctx += `- ${p.nombre}: ${p.descripcion || "Sin descripción"}. Precio: $${p.precio_dinero || 0} / Puntos: ${p.precio_puntos || 0}\n`;
    }
    return ctx;
  } catch (error) {
    console.error("[ai-chat] Error fetching products context", error);
    return "El catálogo de productos no se pudo cargar temporalmente.";
  }
}

async function getEnvioGratisContext(): Promise<string> {
  try {
    const row = await qOne<{ valor: string }>(
      pool,
      "SELECT valor FROM configuracion WHERE clave = 'envio_gratis_monto_minimo'"
    );
    const monto = Number(row?.valor || 0);
    
    let shippingRules = "";
    if (monto > 0) {
      shippingRules += `- Envíos en Corrientes Capital: Si la compra supera los $${monto}, el envío es GRATIS. Si es menor, tiene un pequeño costo dependiendo de la dirección.\n`;
    } else {
      shippingRules += `- Envíos en Corrientes Capital: Tienen un pequeño costo de envío dependiendo de la dirección.\n`;
    }
    
    shippingRules += `- Si la app no toma la dirección del usuario en Corrientes Capital, indicale que puede coordinar el envío contactándose por [Instagram](https://www.instagram.com/alfajorescorrentinos/), [WhatsApp](https://wa.me/5493794632610?text=Hola,%20buenas%20te%20quiero%20consultar%20sobre%20....) o [Mensajes](/mensajes).
- Envíos a otras ciudades o provincias: Se debe consultar disponibilidad y costos contactándose directamente por mensajería de la app, Instagram o WhatsApp.`;

    return shippingRules;
  } catch (error) {
    console.error("[ai-chat] Error fetching config context", error);
    return "";
  }
}

async function buildMessages(input: AiChatServiceInput): Promise<Groq.Chat.ChatCompletionMessageParam[]> {
  const currentPath = sanitizePromptValue(input.context?.currentPath, "desconocida");
  const userRole = input.context?.userRole ?? "anonimo";
  const message = input.message.trim().slice(0, 500);
  
  const productsContext = await getProductsContext();
  const envioGratisContext = await getEnvioGratisContext();

  return [
    { 
      role: "system", 
      content: `${AI_SYSTEM_PROMPT}\n\n${envioGratisContext}\n\n${productsContext}` 
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

function normalizeTokens(usage: unknown): AiUsageTokens | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const raw = usage as Record<string, unknown>;
  const tokens: AiUsageTokens = {};

  for (const key of ["prompt_tokens", "completion_tokens", "total_tokens"] as const) {
    if (typeof raw[key] === "number") tokens[key] = raw[key];
  }

  return Object.keys(tokens).length ? tokens : undefined;
}

function safeErrorReason(error: unknown): string {
  const status = getGroqErrorStatus(error);
  if (status) return `groq_status_${status}`;
  if (error instanceof Error && error.name) return error.name;
  return "unknown_error";
}

function logAiChatEvent(event: AiChatLogEvent): void {
  console.info(
    "[ai-chat]",
    JSON.stringify({
      fecha: new Date().toISOString(),
      userId: event.userId ?? null,
      ipHash: event.ipHash,
      provider: event.provider ?? null,
      model: event.model ?? null,
      tokens: event.tokens ?? null,
      status: event.status,
      reason: event.reason ?? null,
    }),
  );
}

function fallbackResponse(): AiChatResponseBody {
  return {
    ok: false,
    answer: AI_CHAT_FALLBACK_ANSWER,
    fallback: true,
  };
}

async function isChatbotActivoInDb(): Promise<boolean> {
  try {
    const row = await qOne<{ valor: string }>(
      pool,
      "SELECT valor FROM configuracion WHERE clave = 'chatbot_activo' LIMIT 1",
    );
    if (!row) return true; // si no existe la fila, default es activo
    const valor = row.valor.trim().toLowerCase();
    return ["1", "true", "yes", "on"].includes(valor);
  } catch {
    return true; // si falla la consulta, no bloquear el chat
  }
}

export async function answerAiChat(input: AiChatServiceInput): Promise<AiChatResponseBody> {
  const model = getGroqModel();

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

  const usage = checkAndConsumeAiUsage({ userId: input.userId, ipHash: input.ipHash });
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

  const { candidates } = getAiProviderCandidates();
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
        max_tokens: getAiChatMaxOutputTokens(),
        stream: false,
      });

      const answer = completion.choices[0]?.message?.content?.trim();
      recordAiProviderSuccess(candidate);

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
    } catch (error) {
      const failure = recordAiProviderFailure(candidate, error);
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
