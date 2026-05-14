import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type KeyboardEvent } from "react";
import { api } from "../../api";

type SupportConversation = {
  id: number;
  asunto: string;
  estado: "abierta" | "respondida" | "cerrada" | "archivada";
  prioridad: "normal" | "alta";
  last_public_message?: string | null;
  ultimo_mensaje_at: string;
  unread_cliente: number;
};

type SupportMessage = {
  id: number;
  autor_tipo: "cliente" | "staff" | "sistema";
  autor_label: string;
  cuerpo: string;
  es_interno: boolean;
  created_at: string;
};

type SupportDetail = {
  conversacion: SupportConversation;
  mensajes: SupportMessage[];
};

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("es-AR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SoporteCliente() {
  const queryClient = useQueryClient();
  const [mensajeDraft, setMensajeDraft] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const conversationsQuery = useQuery({
    queryKey: ["soporte", "cliente", "conversaciones"],
    queryFn: () => api.get<SupportConversation[]>("/soporte/conversaciones"),
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  });

  const conversaciones = conversationsQuery.data ?? [];
  const activeConversation =
    conversaciones.find((item) => item.estado !== "archivada") ?? conversaciones[0] ?? null;
  const selectedConversationId = activeConversation?.id ?? null;
  const detailQuery = useQuery({
    queryKey: ["soporte", "cliente", "detalle", selectedConversationId],
    queryFn: () => api.get<SupportDetail>(`/soporte/conversaciones/${selectedConversationId}`),
    enabled: Boolean(selectedConversationId),
    refetchInterval: selectedConversationId ? 5000 : false,
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    document.body.classList.add("catalogo-background");
    return () => {
      document.body.classList.remove("catalogo-background");
    };
  }, []);

  useEffect(() => {
    if (!detailQuery.data || !selectedConversationId) return;
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["soporte", "cliente", "conversaciones"] }),
      queryClient.invalidateQueries({ queryKey: ["navbar", "support-unread"] }),
    ]);
  }, [detailQuery.dataUpdatedAt, queryClient, selectedConversationId]);

  const createMutation = useMutation({
    mutationFn: (cuerpo: string) =>
      api.post<{ conversacion: SupportConversation }>("/soporte/conversaciones", {
        cuerpo,
      }),
    onSuccess: async (result) => {
      setMensajeDraft("");
      setErrorMsg("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["soporte", "cliente", "conversaciones"] }),
        queryClient.invalidateQueries({ queryKey: ["soporte", "cliente", "detalle", result.conversacion.id] }),
        queryClient.invalidateQueries({ queryKey: ["navbar", "support-unread"] }),
      ]);
    },
    onError: (error: Error) => setErrorMsg(error.message),
  });

  const sendMutation = useMutation({
    mutationFn: (conversationId: number) =>
      api.post<{ ok: true }>(`/soporte/conversaciones/${conversationId}/mensajes`, {
        cuerpo: mensajeDraft.trim(),
      }),
    onSuccess: async () => {
      setMensajeDraft("");
      setErrorMsg("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["soporte", "cliente", "conversaciones"] }),
        queryClient.invalidateQueries({ queryKey: ["soporte", "cliente", "detalle", selectedConversationId] }),
        queryClient.invalidateQueries({ queryKey: ["navbar", "support-unread"] }),
      ]);
    },
    onError: (error: Error) => setErrorMsg(error.message),
  });

  const detalle = detailQuery.data;
  const mensajes = detalle?.mensajes ?? [];
  const hasActiveChat = Boolean(activeConversation);
  const pendingSend = createMutation.isPending || sendMutation.isPending;
  const lastMessagePreview = activeConversation?.last_public_message?.trim() || "Escribile al staff y arrancamos el chat.";

  function handleSend() {
    const cuerpo = mensajeDraft.trim();
    if (!cuerpo) return;
    if (selectedConversationId) {
      sendMutation.mutate(selectedConversationId);
      return;
    }
    createMutation.mutate(cuerpo);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    if (pendingSend || !mensajeDraft.trim()) return;
    handleSend();
  }

  return (
    <section className="dashboard-section perfil-dashboard-section support-dashboard-client">
      <div className="support-shell support-shell-client-chat">
        <div className="support-thread support-thread-client-chat">
          <div className="support-card support-thread-card support-thread-card-chat support-thread-card-client-chat">
            <div className="support-chat-mini-head">
              <div className="support-chat-mini-avatar" aria-hidden="true">S</div>
              <div className="support-chat-mini-copy">
                <strong>Staff</strong>
                <span>{hasActiveChat ? lastMessagePreview : "Chat directo con el equipo"}</span>
              </div>
              {activeConversation?.unread_cliente ? <span className="support-badge">{activeConversation.unread_cliente}</span> : null}
            </div>

            {detalle || !hasActiveChat ? (
              <>
                <div className="support-messages support-messages-chat support-messages-client-chat">
                  {mensajes.length ? (
                    mensajes.map((mensaje) => (
                      <article
                        key={mensaje.id}
                        className={`support-message support-message-chat${mensaje.autor_tipo === "cliente" ? " mine" : ""}`}
                      >
                        <p>{mensaje.cuerpo}</p>
                        <div className="support-message-meta">
                          <span>{mensaje.autor_tipo === "cliente" ? "Tú" : "Staff"}</span>
                          <span>{formatDate(mensaje.created_at)}</span>
                        </div>
                      </article>
                    ))
                  ) : (
                    <p className="support-empty">Todavía no hay mensajes. Escribile al staff y arrancamos el chat.</p>
                  )}
                </div>

                <div className="support-thread-footer support-thread-footer-chat support-thread-footer-client-chat">
                  <textarea
                    className="ios-input support-textarea support-composer-textarea support-composer-textarea-chat support-composer-textarea-client-chat"
                    value={mensajeDraft}
                    onChange={(event) => setMensajeDraft(event.target.value)}
                    onKeyDown={handleComposerKeyDown}
                    placeholder="Mensaje"
                  />
                  <button
                    className="ios-btn-primary support-composer-send support-composer-send-chat support-composer-send-client-chat"
                    disabled={pendingSend || !mensajeDraft.trim()}
                    onClick={handleSend}
                  >
                    {pendingSend ? "Enviando..." : "Enviar"}
                  </button>
                </div>
              </>
            ) : (
              <p className="support-empty">Cargando chat con staff...</p>
            )}

            {errorMsg ? <div className="status-err-box"><p>{errorMsg}</p></div> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
