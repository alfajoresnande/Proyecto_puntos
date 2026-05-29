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

export function getGroqModel(): string {
  return process.env.GROQ_MODEL?.trim() || "llama-3.1-8b-instant";
}

export function getAiChatMaxOutputTokens(): number {
  return readIntegerEnv("AI_CHAT_MAX_OUTPUT_TOKENS", 350, 80, 800);
}
