import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";

type SupportConversation = {
  id: number;
  asunto: string;
  estado: "abierta" | "respondida" | "cerrada";
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
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [nuevoAsunto, setNuevoAsunto] = useState("");
  const [nuevoMensaje, setNuevoMensaje] = useState("");
  const [respuesta, setRespuesta] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const conversationsQuery = useQuery({
    queryKey: ["soporte", "cliente", "conversaciones"],
    queryFn: () => api.get<SupportConversation[]>("/soporte/conversaciones"),
    refetchInterval: 5000,
  });

  const selectedConversationId = selectedId ?? conversationsQuery.data?.[0]?.id ?? null;
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

  useEffect(() => {
    const conversations = conversationsQuery.data ?? [];
    if (!conversations.length) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!selectedId || !conversations.some((item) => item.id === selectedId)) {
      setSelectedId(conversations[0].id);
    }
  }, [conversationsQuery.data, selectedId]);

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<{ conversacion: SupportConversation }>("/soporte/conversaciones", {
        asunto: nuevoAsunto.trim(),
        cuerpo: nuevoMensaje.trim(),
      }),
    onSuccess: async (result) => {
      setNuevoAsunto("");
      setNuevoMensaje("");
      setErrorMsg("");
      await queryClient.invalidateQueries({ queryKey: ["soporte", "cliente", "conversaciones"] });
      setSelectedId(result.conversacion.id);
    },
    onError: (error: Error) => setErrorMsg(error.message),
  });

  const sendMutation = useMutation({
    mutationFn: () =>
      api.post<{ ok: true }>(`/soporte/conversaciones/${selectedConversationId}/mensajes`, {
        cuerpo: respuesta.trim(),
      }),
    onSuccess: async () => {
      setRespuesta("");
      setErrorMsg("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["soporte", "cliente", "conversaciones"] }),
        queryClient.invalidateQueries({ queryKey: ["soporte", "cliente", "detalle", selectedConversationId] }),
      ]);
    },
    onError: (error: Error) => setErrorMsg(error.message),
  });

  const conversaciones = conversationsQuery.data ?? [];
  const detalle = detailQuery.data;
  const mensajes = detalle?.mensajes ?? [];
  const canReply = detalle?.conversacion.estado !== "cerrada";
  const resumen = useMemo(
    () => conversaciones.filter((item) => item.estado !== "cerrada").length,
    [conversaciones],
  );

  return (
    <section className="dashboard-section perfil-dashboard-section">
      <div className="support-shell">
        <aside className="support-sidebar">
          <div className="support-card">
            <div className="support-card-head">
              <div>
                <h1 className="support-title">Mensajes</h1>
                <p className="support-subtitle">{resumen} conversaciones activas</p>
              </div>
            </div>

            <div className="support-form">
              <input
                className="ios-input"
                value={nuevoAsunto}
                onChange={(event) => setNuevoAsunto(event.target.value)}
                placeholder="Asunto breve"
              />
              <textarea
                className="ios-input support-textarea"
                value={nuevoMensaje}
                onChange={(event) => setNuevoMensaje(event.target.value)}
                placeholder="Cuentanos que necesitas"
              />
              <button
                className="ios-btn-primary"
                disabled={createMutation.isPending || !nuevoMensaje.trim() || nuevoAsunto.trim().length < 3}
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending ? "Enviando..." : "Abrir conversacion"}
              </button>
            </div>
          </div>

          <div className="support-list">
            {conversationsQuery.isLoading ? <p className="support-empty">Cargando conversaciones...</p> : null}
            {!conversationsQuery.isLoading && !conversaciones.length ? (
              <p className="support-empty">Todavia no abriste ninguna conversacion.</p>
            ) : null}
            {conversaciones.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`support-list-item${selectedConversationId === item.id ? " active" : ""}`}
                onClick={() => setSelectedId(item.id)}
              >
                <div className="support-list-row">
                  <strong>{item.asunto || "Consulta general"}</strong>
                  {item.unread_cliente > 0 ? <span className="support-badge">{item.unread_cliente}</span> : null}
                </div>
                <p>{item.last_public_message || "Sin mensajes visibles."}</p>
                <div className="support-list-row support-list-meta">
                  <span className={`support-state support-state-${item.estado}`}>{item.estado}</span>
                  <span>{formatDate(item.ultimo_mensaje_at)}</span>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <div className="support-thread">
          <div className="support-card support-thread-card">
            {detalle ? (
              <>
                <div className="support-card-head support-thread-head">
                  <div>
                    <h2 className="support-thread-title">{detalle.conversacion.asunto || "Consulta general"}</h2>
                    <p className="support-subtitle">
                      Estado: <span className={`support-state support-state-${detalle.conversacion.estado}`}>{detalle.conversacion.estado}</span>
                    </p>
                  </div>
                </div>

                <div className="support-messages">
                  {mensajes.map((mensaje) => (
                    <article
                      key={mensaje.id}
                      className={`support-message${mensaje.autor_tipo === "cliente" ? " mine" : ""}`}
                    >
                      <div className="support-message-meta">
                        <strong>{mensaje.autor_label}</strong>
                        <span>{formatDate(mensaje.created_at)}</span>
                      </div>
                      <p>{mensaje.cuerpo}</p>
                    </article>
                  ))}
                </div>

                {canReply ? (
                  <div className="support-reply-box">
                    <textarea
                      className="ios-input support-textarea"
                      value={respuesta}
                      onChange={(event) => setRespuesta(event.target.value)}
                      placeholder="Escribe tu respuesta"
                    />
                    <button
                      className="ios-btn-primary"
                      disabled={sendMutation.isPending || !respuesta.trim()}
                      onClick={() => sendMutation.mutate()}
                    >
                      {sendMutation.isPending ? "Enviando..." : "Enviar mensaje"}
                    </button>
                  </div>
                ) : (
                  <p className="support-empty">Esta conversacion esta cerrada.</p>
                )}
              </>
            ) : (
              <p className="support-empty">Selecciona una conversacion para ver los mensajes.</p>
            )}

            {errorMsg ? <div className="status-err-box"><p>{errorMsg}</p></div> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
