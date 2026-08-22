import Groq from "groq-sdk";

export type AiPublicProvider = "primary" | "secondary";
export type GroqClientSlot = "primary" | "secondary" | "key3" | "key4" | "key5" | "key6";

export type GroqClientDescriptor = {
  slot: GroqClientSlot;
  publicProvider: AiPublicProvider;
  envVarName: string;
  client: Groq;
};

type GroqKeyConfig = {
  slot: GroqClientSlot;
  publicProvider: AiPublicProvider;
  envVarName: string;
};

const GROQ_KEY_CONFIGS: GroqKeyConfig[] = [
  { slot: "primary", publicProvider: "primary", envVarName: "GROQ_API_KEY_PRIMARY" },
  { slot: "secondary", publicProvider: "secondary", envVarName: "GROQ_API_KEY_SECONDARY" },
  { slot: "key3", publicProvider: "secondary", envVarName: "GROQ_API_KEY_3" },
  { slot: "key4", publicProvider: "secondary", envVarName: "GROQ_API_KEY_4" },
  { slot: "key5", publicProvider: "secondary", envVarName: "GROQ_API_KEY_5" },
  { slot: "key6", publicProvider: "secondary", envVarName: "GROQ_API_KEY_6" },
];

function readSecret(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

function readIntegerEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

const configuredGroqClients: GroqClientDescriptor[] = GROQ_KEY_CONFIGS.flatMap((config) => {
  const apiKey = readSecret(config.envVarName);
  if (!apiKey) return [];

  return [
    {
      slot: config.slot,
      publicProvider: config.publicProvider,
      envVarName: config.envVarName,
      client: new Groq({
        apiKey,
        maxRetries: 0,
        timeout: 20_000,
      }),
    },
  ];
});

export function getConfiguredGroqClients(): GroqClientDescriptor[] {
  return configuredGroqClients;
}

// Groq apago llama-3.1-8b-instant el 16/08/2026 y recomienda gpt-oss-20b
// como reemplazo. Si vuelve a pasar lo mismo, la lista viva de modelos esta
// en https://console.groq.com/docs/models y se puede pisar con GROQ_MODEL
// sin tocar el codigo ni redeployar.
export function getGroqModel(): string {
  return process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-20b";
}

// gpt-oss razona antes de responder y esos tokens salen del mismo presupuesto
// que la respuesta: con el tope viejo de 350 el modelo gastaba el budget
// pensando y devolvia content vacio (o sea, fallback en cada pregunta).
export function getAiChatMaxOutputTokens(): number {
  return readIntegerEnv("AI_CHAT_MAX_OUTPUT_TOKENS", 700, 80, 1600);
}

// "low" mantiene el razonamiento corto: es un chat de catalogo, no necesita
// cadena de pensamiento larga, y el free tier son 8000 tokens por minuto.
export function getAiChatReasoningEffort(): "none" | "low" | "medium" | "high" {
  const value = process.env.AI_CHAT_REASONING_EFFORT?.trim().toLowerCase();
  if (value === "none" || value === "low" || value === "medium" || value === "high") return value;
  return "low";
}

// reasoning_effort solo lo aceptan los modelos de razonamiento: mandarselo a
// otro modelo es un 400. Se aplica solo cuando el id lo justifica.
export function modelSupportsReasoningEffort(model: string): boolean {
  return /gpt-oss|qwen|deepseek-r1/i.test(model);
}
