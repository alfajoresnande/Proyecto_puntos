import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
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
  });

  useEffect(() => {
    document.body.classList.add("catalogo-background");
    return () => {
      document.body.classList.remove("catalogo-background");
    };
  }, []);

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
      ]);
    },
    onError: (error: Error) => setErrorMsg(error.message),
  });

  const detalle = detailQuery.data;
  const mensajes = detalle?.mensajes ?? [];
  const hasActiveChat = Boolean(activeConversation);
  const pendingSend = createMutation.isPending || sendMutation.isPending;
  const resumen = useMemo(() => conversaciones.filter((item) => item.estado !== "cerrada").length, [conversaciones]);

  function handleSend() {
    const cuerpo = mensajeDraft.trim();
    if (!cuerpo) return;
    if (selectedConversationId) {
      sendMutation.mutate(selectedConversationId);
      return;
    }
    createMutation.mutate(cuerpo);
  }

  return (
    <section className="dashboard-section perfil-dashboard-section">
      <div className="support-shell">
        <aside className="support-sidebar">
          <div className="support-card">
            <div className="support-card-head">
              <div>
                <h1 className="support-title">Chat con staff</h1>
                <p className="support-subtitle">
                  {hasActiveChat ? `${resumen} chat activo` : "Escribinos y te responde el staff"}
                </p>
              </div>
            </div>
            <div className="support-list">
              {conversationsQuery.isLoading ? <p className="support-empty">Cargando chat...</p> : null}
              {!conversationsQuery.isLoading ? (
                <button type="button" className={`support-list-item active${hasActiveChat ? "" : " support-user-list-item"}`}>
                  <div className="support-list-row">
                    <strong>Staff</strong>
                    {activeConversation?.unread_cliente ? <span className="support-badge">{activeConversation.unread_cliente}</span> : null}
                  </div>
                  <p>{activeConversation?.last_public_message || "Todavia no hay mensajes. Envia el primero cuando quieras."}</p>
                  <div className="support-list-row support-list-meta">
                    <span className={`support-state support-state-${activeConversation?.estado || "abierta"}`}>
                      {activeConversation?.estado || "nuevo"}
                    </span>
                    <span>{activeConversation?.ultimo_mensaje_at ? formatDate(activeConversation.ultimo_mensaje_at) : "Ahora"}</span>
                  </div>
                </button>
              ) : null}
            </div>
          </div>
        </aside>

        <div className="support-thread">
          <div className="support-card support-thread-card">
            {detalle || !hasActiveChat ? (
              <>
                <div className="support-card-head support-thread-head">
                  <div>
                    <h2 className="support-thread-title">Staff</h2>
                    <p className="support-subtitle">
                      {detalle ? (
                        <>
                          Estado:{" "}
                          <span className={`support-state support-state-${detalle.conversacion.estado}`}>
                            {detalle.conversacion.estado}
                          </span>
                        </>
                      ) : (
                        "Chat directo con el equipo"
                      )}
                    </p>
                  </div>
                </div>

                <div className="support-messages">
                  {mensajes.length ? (
                    mensajes.map((mensaje) => (
                      <article
                        key={mensaje.id}
                        className={`support-message${mensaje.autor_tipo === "cliente" ? " mine" : ""}`}
                      >
                        <div className="support-message-meta">
                          <strong>{mensaje.autor_tipo === "cliente" ? "Tú" : "Staff"}</strong>
                          <span>{formatDate(mensaje.created_at)}</span>
                        </div>
                        <p>{mensaje.cuerpo}</p>
                      </article>
                    ))
                  ) : (
                    <p className="support-empty">Todavia no hay mensajes. Escribile al staff y arrancamos el chat.</p>
                  )}
                </div>

                {activeConversation?.estado === "cerrada" ? (
                  <p className="support-empty">Este chat está cerrado, pero si envías un mensaje se reabre automáticamente.</p>
                ) : null}

                <div className="support-reply-box">
                  <textarea
                    className="ios-input support-textarea"
                    value={mensajeDraft}
                    onChange={(event) => setMensajeDraft(event.target.value)}
                    placeholder="Escribe tu mensaje"
                  />
                  <button
                    className="ios-btn-primary"
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
