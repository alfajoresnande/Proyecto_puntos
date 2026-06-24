import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useAuthStore } from "../store/authStore";
import type { Rol, User } from "../types";

import { Link } from "react-router-dom";

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

function getDynamicGreeting(user: User | null): string {
  let timeGreeting = "¡Hola!";
  try {
    const formatter = new Intl.DateTimeFormat("es-AR", {
      timeZone: "America/Argentina/Buenos_Aires",
      hour: "numeric",
      hour12: false,
    });
    const hour = parseInt(formatter.format(new Date()), 10);

    if (hour >= 6 && hour < 12) {
      timeGreeting = "¡Buen día! Soy Alfi.";
    } else if (hour >= 12 && hour < 20) {
      timeGreeting = "¡Buenas tardes! Soy Alfi.";
    } else {
      timeGreeting = "¡Buenas noches! Soy Alfi.";
    }
  } catch {
    timeGreeting = "¡Hola! Soy Alfi.";
  }

  if (!user) {
    return `${timeGreeting} Bienvenido a Ñandé. Te sugiero [iniciar sesión](/login) o [registrarte](/registro) para poder comprar y acumular puntos. ¿En qué te puedo ayudar hoy?`;
  }

  const faltanDatos = !user.dni || !user.telefono || !user.localidad;
  if (faltanDatos && user.rol === "cliente") {
    return `${timeGreeting} **${user.nombre}**. Noté que te faltan algunos datos en tu perfil. Te recomiendo [completarlos aquí](/perfil) para poder realizar tus pedidos sin problemas. ¿En qué te ayudo hoy?`;
  }

  return `${timeGreeting} **${user.nombre}**. ¿En qué te puedo ayudar hoy?`;
}

function getTooltipGreeting(user: User | null): string {
  let timeGreeting = "¡Hola!";
  try {
    const formatter = new Intl.DateTimeFormat("es-AR", {
      timeZone: "America/Argentina/Buenos_Aires",
      hour: "numeric",
      hour12: false,
    });
    const hour = parseInt(formatter.format(new Date()), 10);

    if (hour >= 6 && hour < 12) {
      timeGreeting = "¡Buen día! Soy Alfi.";
    } else if (hour >= 12 && hour < 20) {
      timeGreeting = "¡Buenas tardes! Soy Alfi.";
    } else {
      timeGreeting = "¡Buenas noches! Soy Alfi.";
    }
  } catch {
    timeGreeting = "¡Hola! Soy Alfi.";
  }

  if (!user) {
    return `${timeGreeting} ¿Te ayudo a iniciar sesión para sumar puntos? ✨`;
  }

  const faltanDatos = !user.dni || !user.telefono || !user.localidad;
  if (faltanDatos && user.rol === "cliente") {
    return `${timeGreeting} ${user.nombre}. ¿Completamos tu perfil para tu próximo pedido? 📝`;
  }

  return `${timeGreeting} ${user.nombre}. ¿En qué te ayudo hoy? 😊`;
}

function parseMessageContent(content: string) {
  // Regex to match markdown links: [Link text](/url) or bold text **bold**
  const tokenRegex = /(\[.*?\]\(.*?\))|(\*\*.*?\*\*)/g;
  const parts = content.split(tokenRegex).filter(Boolean);

  return parts.map((part, index) => {
    if (part.startsWith("[") && part.includes("](")) {
      const match = part.match(/\[(.*?)\]\((.*?)\)/);
      if (match) {
        const text = match[1];
        const url = match[2];
        if (url.startsWith("/")) {
          return (
            <Link key={index} to={url} className="ai-chat-link">
              {text}
            </Link>
          );
        }
        return (
          <a key={index} href={url} target="_blank" rel="noopener noreferrer" className="ai-chat-link">
            {text}
          </a>
        );
      }
    } else if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }

    // Split text parts by line breaks
    return part.split("\n").map((line, i) => (
      <span key={`${index}-${i}`}>
        {line}
        {i !== part.split("\n").length - 1 && <br />}
      </span>
    ));
  });
}

export function AiChatWidget() {
  const user = useAuthStore((state) => state.user);
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const [conversationId] = useState(createMessageId);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipDismissed, setTooltipDismissed] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setShowTooltip(false);
      setTooltipDismissed(true);
      return;
    }

    if (tooltipDismissed) return;

    const timer = setTimeout(() => {
      setShowTooltip(true);
    }, 3000);

    return () => clearTimeout(timer);
  }, [isOpen, tooltipDismissed]);

  useEffect(() => {
    setMessages((prev) => {
      const greeting = getDynamicGreeting(user);
      if (prev.length === 0) {
        return [{ id: createMessageId(), role: "assistant", content: greeting }];
      }
      if (prev.length === 1 && prev[0].role === "assistant") {
        return [{ ...prev[0], content: greeting }];
      }
      return prev;
    });
  }, [user]);

  const initialGreeting = messages[0]?.content || getDynamicGreeting(user);
  const isInitialConversation = messages.length <= 1 && messages[0]?.role === "assistant" && !isSending;
  const firstName = user?.nombre?.trim().split(/\s+/)[0] || "";
  const mobileGreetingName = firstName ? `, ${firstName}` : "";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isSending]);

  function resetConversation() {
    setMessages([{ id: createMessageId(), role: "assistant", content: getDynamicGreeting(user) }]);
    setInput("");
  }

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
    <section className={`ai-chat-widget ${isOpen ? "ai-chat-widget--open" : ""}`} aria-label="Chat de ayuda Alfi">
      {isOpen ? (
        <div className={`ai-chat-panel ${isInitialConversation ? "ai-chat-panel--fresh" : ""}`} role="dialog" aria-modal="false" aria-label="Alfi">
          <div className="ai-chat-header">
            <div className="ai-chat-header-copy">
              <p className="ai-chat-eyebrow">Alfi</p>
              <h2>Ñandé te ayuda</h2>
            </div>
            <button
              type="button"
              className="ai-chat-mobile-action ai-chat-mobile-action-reset"
              onClick={resetConversation}
              aria-label="Reiniciar chat"
            >
              ↻
            </button>
            <button
              type="button"
              className="ai-chat-icon-button"
              onClick={() => setIsOpen(false)}
              aria-label="Cerrar chat"
            >
              x
            </button>
          </div>

          {isInitialConversation ? (
            <div className="ai-chat-mobile-hero" aria-hidden="true">
              <h3>¡Hola{mobileGreetingName}!<br />¿Cómo puedo ayudarte?</h3>
            </div>
          ) : null}

          <div className="ai-chat-messages" aria-live="polite">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`ai-chat-message ai-chat-message--${message.role}${
                  message.fallback ? " ai-chat-message--fallback" : ""
                }`}
              >
                {parseMessageContent(message.content)}
              </div>
            ))}
            {isSending ? (
              <div className="ai-chat-message ai-chat-message--assistant ai-chat-message--loading">
                Pensando un toque...
              </div>
            ) : null}
            <div ref={messagesEndRef} />
          </div>

          {isInitialConversation ? (
            <div className="ai-chat-mobile-suggestions">
              {[
                "Quiero consultar mis puntos",
                "Necesito ayuda con un pedido",
                "Como funcionan los canjes",
              ].map((suggestion) => (
                <button key={suggestion} type="button" onClick={() => setInput(suggestion)}>
                  <span className="ai-chat-mobile-suggestion-icon" aria-hidden="true" />
                  <span>{suggestion}</span>
                </button>
              ))}
            </div>
          ) : null}

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

      {showTooltip && !isOpen ? (
        <div className="ai-chat-tooltip" onClick={() => setIsOpen(true)}>
          <div className="ai-chat-tooltip-bubble">
            {getTooltipGreeting(user)}
          </div>
          <button
            type="button"
            className="ai-chat-tooltip-close"
            onClick={(e) => {
              e.stopPropagation();
              setShowTooltip(false);
              setTooltipDismissed(true);
            }}
            aria-label="Cerrar saludo"
          >
            ×
          </button>
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
