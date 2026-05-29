"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getConfiguredGroqClients = getConfiguredGroqClients;
exports.getGroqModel = getGroqModel;
exports.getAiChatMaxOutputTokens = getAiChatMaxOutputTokens;
const groq_sdk_1 = __importDefault(require("groq-sdk"));
const GROQ_KEY_CONFIGS = [
    { slot: "primary", publicProvider: "primary", envVarName: "GROQ_API_KEY_PRIMARY" },
    { slot: "secondary", publicProvider: "secondary", envVarName: "GROQ_API_KEY_SECONDARY" },
    { slot: "key3", publicProvider: "secondary", envVarName: "GROQ_API_KEY_3" },
    { slot: "key4", publicProvider: "secondary", envVarName: "GROQ_API_KEY_4" },
    { slot: "key5", publicProvider: "secondary", envVarName: "GROQ_API_KEY_5" },
    { slot: "key6", publicProvider: "secondary", envVarName: "GROQ_API_KEY_6" },
];
function readSecret(name) {
    const value = process.env[name]?.trim();
    return value || null;
}
function readIntegerEnv(name, fallback, min, max) {
    const parsed = Number.parseInt(process.env[name] ?? "", 10);
    if (!Number.isInteger(parsed))
        return fallback;
    return Math.max(min, Math.min(max, parsed));
}
const configuredGroqClients = GROQ_KEY_CONFIGS.flatMap((config) => {
    const apiKey = readSecret(config.envVarName);
    if (!apiKey)
        return [];
    return [
        {
            slot: config.slot,
            publicProvider: config.publicProvider,
            envVarName: config.envVarName,
            client: new groq_sdk_1.default({
                apiKey,
                maxRetries: 0,
                timeout: 20_000,
            }),
        },
    ];
});
function getConfiguredGroqClients() {
    return configuredGroqClients;
}
function getGroqModel() {
    return process.env.GROQ_MODEL?.trim() || "llama-3.1-8b-instant";
}
function getAiChatMaxOutputTokens() {
    return readIntegerEnv("AI_CHAT_MAX_OUTPUT_TOKENS", 350, 80, 800);
}
