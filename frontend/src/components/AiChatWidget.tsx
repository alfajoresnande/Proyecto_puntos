import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useAuthStore } from "../store/authStore";
import type { Rol } from "../types";

type AiChatUserRole = "cliente" | "vendedor" | "admin" | "superadmin" | "anonimo";

type AiChatResponse = {
  ok: boolean;
  answer: string;
  provider?: "primary" | "secondary";
  model?: string;
  fallback?: boolean;
};

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
  fallback?: boolean;
};

const MAX_MESSAGE_LENGTH = 500;
const FALLBACK_ANSWER =
  "En este momento el asistente está descansando. Podés seguir navegando por la tienda, revisar productos, consultar tus pedidos o contactarnos desde la sección de ayuda.";

function createMessageId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function roleToAiRole(role: Rol | undefined): AiChatUserRole {
  if (role === "superAdmin") return "superadmin";
  if (role === "cliente" || role === "vendedor" || role === "admin") return role;
  return "anonimo";
}

function getCurrentPath(): string {
  return typeof window === "undefined" ? "/" : window.location.pathname;
}

export function AiChatWidget() {
  const user = useAuthStore((state) => state.user);
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: createMessageId(),
      role: "assistant",
      content: "Hola, soy el asistente de Ñandé. Puedo ayudarte con compras, pedidos, pagos, envíos, puntos y navegación de la app.",
    },
  ]);
  const [conversationId] = useState(createMessageId);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isSending]);

  async function sendMessage() {
    const message = input.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!message || isSending) return;

    setInput("");
    setMessages((current) => [
      ...current,
      {
        id: createMessageId(),
        role: "user",
        content: message,
      },
    ]);
    setIsSending(true);

    try {
      const response = await api.post<AiChatResponse>("/ai/chat", {
        message,
        conversationId,
        context: {
          currentPath: getCurrentPath(),
          userRole: roleToAiRole(user?.rol),
        },
      });

      setMessages((current) => [
        ...current,
        {
          id: createMessageId(),
          role: "assistant",
          content: response.answer || FALLBACK_ANSWER,
          fallback: Boolean(response.fallback || !response.ok),
        },
      ]);
    } catch {
      setMessages((current) => [
        ...current,
        {
          id: createMessageId(),
          role: "assistant",
          content: FALLBACK_ANSWER,
          fallback: true,
        },
      ]);
    } finally {
      setIsSending(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage();
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  return (
    <section className={`ai-chat-widget ${isOpen ? "ai-chat-widget--open" : ""}`} aria-label="Chat de ayuda IA">
      {isOpen ? (
        <div className="ai-chat-panel" role="dialog" aria-modal="false" aria-label="Asistente virtual">
          <div className="ai-chat-header">
            <div>
              <p className="ai-chat-eyebrow">Asistente virtual</p>
              <h2>Ñandé te ayuda</h2>
            </div>
            <button
              type="button"
              className="ai-chat-icon-button"
              onClick={() => setIsOpen(false)}
              aria-label="Cerrar chat"
            >
              x
            </button>
          </div>

          <div className="ai-chat-messages" aria-live="polite">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`ai-chat-message ai-chat-message--${message.role}${
                  message.fallback ? " ai-chat-message--fallback" : ""
                }`}
              >
                {message.content}
              </div>
            ))}
            {isSending ? (
              <div className="ai-chat-message ai-chat-message--assistant ai-chat-message--loading">
                Pensando un toque...
              </div>
            ) : null}
            <div ref={messagesEndRef} />
          </div>

          <form className="ai-chat-form" onSubmit={onSubmit}>
            <label className="sr-only" htmlFor="ai-chat-message">
              Escribí tu consulta
            </label>
            <textarea
              id="ai-chat-message"
              value={input}
              maxLength={MAX_MESSAGE_LENGTH}
              rows={2}
              placeholder="Preguntá sobre pedidos, puntos, pagos o envíos..."
              onChange={(event) => setInput(event.target.value.slice(0, MAX_MESSAGE_LENGTH))}
              onKeyDown={onInputKeyDown}
              disabled={isSending}
            />
            <div className="ai-chat-form-footer">
              <span>{input.length}/{MAX_MESSAGE_LENGTH}</span>
              <button type="submit" disabled={!input.trim() || isSending}>
                Enviar
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <button
        type="button"
        className="ai-chat-fab"
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
        aria-label={isOpen ? "Cerrar asistente virtual" : "Abrir asistente virtual"}
      >
        <img
          src="/nande_alfajorcito_chat.png"
          alt=""
          aria-hidden="true"
          className="ai-chat-fab-img"
        />
      </button>
    </section>
  );
}
