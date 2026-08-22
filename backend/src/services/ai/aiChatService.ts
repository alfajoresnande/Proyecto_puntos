import type { Groq } from "groq-sdk";
import { AI_CHAT_FALLBACK_ANSWER, buildSystemPrompt } from "./aiSystemPrompt";
import {
  getAiChatMaxOutputTokens,
  getAiChatReasoningEffort,
  getGroqModel,
  modelSupportsReasoningEffort,
  type AiPublicProvider,
} from "./groqClients";
import {
  getAiProviderCandidates,
  getGroqErrorStatus,
  recordAiProviderFailure,
  recordAiProviderSuccess,
} from "./aiRouter";
import { checkAndConsumeAiUsage } from "./aiUsageLimiter";
import { pool, qOne, qAll } from "../../db";
import { getPointsProgramConfig, isPointsProgramEnabled } from "../points";
import { isWhatsappCatalogMode } from "../salesMode";

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

function formatMoneyForPrompt(value: number): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "$0";
  const hasDecimals = Math.abs(amount % 1) > 0;
  return `$${amount.toLocaleString("es-AR", {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: hasDecimals ? 2 : 0,
  })}`;
}

function normalizePromptInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.trunc(parsed);
}

async function getPointsProgramContext(): Promise<string> {
  try {
    if (!(await isPointsProgramEnabled(pool))) {
      return `PROGRAMA DE PUNTOS ACTUAL:
- El programa de puntos esta DESACTIVADO temporalmente.
- Las compras no acumulan puntos y no se pueden hacer canjes por ahora.
- Si el usuario pregunta por puntos, canjes o referidos, explicale que el programa esta pausado y que puede seguir comprando normalmente.
- No expliques como funciona la acumulacion ni menciones valores de puntos.`;
    }

    const [pointsConfig, referralConfig] = await Promise.all([
      getPointsProgramConfig(pool),
      qOne<{
        referido_invitador: string | number | null;
        referido_invitado: string | number | null;
      }>(
        pool,
        `SELECT
           MAX(CASE WHEN clave = 'puntos_referido_invitador' THEN valor END) AS referido_invitador,
           MAX(CASE WHEN clave = 'puntos_referido_invitado' THEN valor END) AS referido_invitado
         FROM configuracion
         WHERE clave IN ('puntos_referido_invitador', 'puntos_referido_invitado')`,
      ),
    ]);

    const puntosInvitador = normalizePromptInteger(referralConfig?.referido_invitador, 50);
    const puntosInvitado = normalizePromptInteger(referralConfig?.referido_invitado, 30);
    const ejemploMonto = pointsConfig.montoBase * 2;
    const ejemploPuntos = pointsConfig.puntosPorMonto * 2;

    return `PROGRAMA DE PUNTOS ACTUAL:
- Acumulacion por compra: por cada tramo completo de ${formatMoneyForPrompt(pointsConfig.montoBase)} de compra se acreditan ${pointsConfig.puntosPorMonto} puntos.
- Si una compra no llega a ${formatMoneyForPrompt(pointsConfig.montoBase)}, suma 0 puntos por compra.
- Ejemplo exacto: una compra de ${formatMoneyForPrompt(ejemploMonto)} acredita ${ejemploPuntos} puntos.
- Los puntos de compra se acreditan cuando el pedido queda pagado o avanza a un estado de pedido pagado.
- Los puntos acreditados vencen a los ${pointsConfig.vencimientoMeses} meses.
- La app avisa puntos por vencer con ${pointsConfig.alertaPreVencimientoValor} ${pointsConfig.alertaPreVencimientoUnidad} de anticipacion.
- Referidos: quien comparte su codigo gana ${puntosInvitador} puntos cuando otra persona lo usa; quien se registra con ese codigo gana ${puntosInvitado} puntos.
- Canjes: el costo en puntos depende de cada producto del catalogo. Para canjes, usa los puntos para canje listados en el catalogo actualizado.
- No uses otros valores de puntos, porcentajes ni equivalencias si no aparecen en este bloque o en el catalogo actualizado.`;
  } catch (error) {
    console.error("[ai-chat] Error fetching points context", error);
    return "PROGRAMA DE PUNTOS ACTUAL: No se pudo cargar temporalmente la configuracion exacta de puntos. No inventes valores.";
  }
}

async function getProductsContext(): Promise<string> {
  try {
    const productos = await qAll<{
      id: number;
      nombre: string;
      descripcion: string | null;
      precio_dinero: number | null;
      puntos_canje: number | null;
      tipo_producto: string | null;
    }>(
      pool,
      `SELECT id, nombre, descripcion, precio_dinero,
              COALESCE(puntos_para_canjear, precio_puntos, puntos_requeridos) AS puntos_canje,
              tipo_producto
       FROM productos
       WHERE activo = 1`,
    );

    if (!productos || productos.length === 0) return "No hay productos activos en este momento.";

    let ctx = "CATÁLOGO DE PRODUCTOS ACTUALIZADO:\n";
    for (const p of productos) {
      const precio = Number(p.precio_dinero ?? 0);
      const puntosCanje = Number(p.puntos_canje ?? 0);
      const permiteCanje = p.tipo_producto === "canje" || p.tipo_producto === "mixto" || !p.tipo_producto;
      const precioTexto = precio > 0 ? formatMoneyForPrompt(precio) : "sin precio en dinero";
      const puntosTexto = permiteCanje && puntosCanje > 0
        ? `${puntosCanje} puntos para canje`
        : "no disponible para canje por puntos";

      ctx += `- ${p.nombre}: ${p.descripcion || "Sin descripcion"}. Tipo: ${p.tipo_producto || "sin tipo"}. Precio en dinero: ${precioTexto}. Canje: ${puntosTexto}.\n`;
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
  
  // Los dos interruptores que cambian de que puede hablar el bot. Se leen en
  // cada pedido a proposito: el superAdmin los cambia sin reiniciar el server.
  const [pointsEnabled, whatsappCatalogMode] = await Promise.all([
    isPointsProgramEnabled(pool).catch(() => true),
    isWhatsappCatalogMode(pool).catch(() => false),
  ]);

  const [productsContext, envioGratisContext, pointsProgramContext] = await Promise.all([
    getProductsContext(),
    getEnvioGratisContext(),
    pointsEnabled ? getPointsProgramContext() : Promise.resolve(""),
  ]);

  return [
    {
      role: "system",
      content: [
        buildSystemPrompt({ pointsEnabled, whatsappCatalogMode }),
        pointsProgramContext,
        envioGratisContext,
        productsContext,
      ]
        .filter(Boolean)
        .join("\n\n"),
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
        ...(modelSupportsReasoningEffort(model)
          ? { reasoning_effort: getAiChatReasoningEffort() }
          : {}),
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
