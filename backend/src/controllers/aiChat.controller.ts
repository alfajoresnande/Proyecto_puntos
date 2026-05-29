import type { Request, Response } from "express";
import { z } from "zod";
import type { Rol } from "../auth";
import {
  AI_CHAT_FALLBACK_ANSWER,
} from "../services/ai/aiSystemPrompt";
import {
  answerAiChat,
  type AiChatRequestContext,
  type AiChatResponseBody,
  type AiChatUserRole,
} from "../services/ai/aiChatService";
import { hashIpForAiLogs } from "../services/ai/aiUsageLimiter";

const aiChatRequestSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, "Mensaje requerido.")
    .max(500, "El mensaje no puede superar 500 caracteres."),
  conversationId: z.string().trim().max(120).optional(),
  context: z
    .object({
      currentPath: z.string().trim().max(180).optional(),
      userRole: z.enum(["cliente", "vendedor", "admin", "superadmin", "anonimo"]).optional(),
      orderId: z.number().int().positive().optional(),
      productId: z.number().int().positive().optional(),
    })
    .optional(),
});

function roleToAiRole(role: Rol | undefined): AiChatUserRole {
  if (role === "superAdmin") return "superadmin";
  if (role === "cliente" || role === "vendedor" || role === "admin") return role;
  return "anonimo";
}

function sanitizeContext(req: Request, context: AiChatRequestContext | undefined): AiChatRequestContext {
  return {
    currentPath: context?.currentPath,
    userRole: roleToAiRole(req.user?.rol),
    orderId: context?.orderId,
    productId: context?.productId,
  };
}

export async function postAiChat(req: Request, res: Response<AiChatResponseBody>) {
  const parsed = aiChatRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      answer: AI_CHAT_FALLBACK_ANSWER,
      fallback: true,
    });
    return;
  }

  try {
    const response = await answerAiChat({
      message: parsed.data.message,
      conversationId: parsed.data.conversationId,
      context: sanitizeContext(req, parsed.data.context),
      userId: req.user?.id,
      ipHash: hashIpForAiLogs(req.ip),
    });

    res.json(response);
  } catch {
    console.error("[ai-chat] controller_error");
    res.json({
      ok: false,
      answer: AI_CHAT_FALLBACK_ANSWER,
      fallback: true,
    });
  }
}
