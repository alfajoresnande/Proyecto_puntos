import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";

type SupportConversation = {
  id: number;
  asunto: string;
  estado: "abierta" | "respondida" | "cerrada";
  prioridad: "normal" | "alta";
  ultimo_mensaje_at: string;
  unread_staff: number;
  asignado_a: number | null;
  asignado_nombre: string | null;
  usuario: {
    id: number;
    nombre: string;
    email: string;
  };
};

type SupportMessage = {
  id: number;
  autor_tipo: "cliente" | "staff" | "sistema";
  autor_label: string;
  autor_rol: string;
  cuerpo: string;
  es_interno: boolean;
  created_at: string;
};

type SupportDetail = {
  conversacion: SupportConversation;
  mensajes: SupportMessage[];
};

type SupportUser = {
  id: number;
  nombre: string;
  email: string;
  rol: "admin" | "vendedor" | "cliente";
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

export function SoporteStaff() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [estadoFiltro, setEstadoFiltro] = useState("abierta");
  const [respuesta, setRespuesta] = useState("");
  const [notaInterna, setNotaInterna] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [nuevoUsuarioId, setNuevoUsuarioId] = useState("");
  const [nuevoAsunto, setNuevoAsunto] = useState("");
  const [nuevoMensaje, setNuevoMensaje] = useState("");

  const conversationsQuery = useQuery({
    queryKey: ["soporte", "staff", "conversaciones", estadoFiltro],
    queryFn: () =>
      api.get<SupportConversation[]>(
        `/soporte/conversaciones${estadoFiltro ? `?estado=${encodeURIComponent(estadoFiltro)}` : ""}`,
      ),
    refetchInterval: 5000,
  });

  const usersQuery = useQuery({
    queryKey: ["soporte", "staff", "usuarios"],
    queryFn: () => api.get<SupportUser[]>("/soporte/usuarios"),
    staleTime: 30_000,
  });

  const selectedConversationId = selectedId ?? conversationsQuery.data?.[0]?.id ?? null;
  const detailQuery = useQuery({
    queryKey: ["soporte", "staff", "detalle", selectedConversationId],
    queryFn: () => api.get<SupportDetail>(`/soporte/conversaciones/${selectedConversationId}`),
    enabled: Boolean(selectedConversationId),
    refetchInterval: selectedConversationId ? 5000 : false,
  });

  const sendMutation = useMutation({
    mutationFn: ({ cuerpo, esInterno }: { cuerpo: string; esInterno: boolean }) =>
      api.post<{ ok: true }>(`/soporte/conversaciones/${selectedConversationId}/mensajes`, {
        cuerpo,
        es_interno: esInterno,
      }),
    onSuccess: async (_data, variables) => {
      if (variables.esInterno) {
        setNotaInterna("");
      } else {
        setRespuesta("");
      }
      setErrorMsg("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["soporte", "staff", "conversaciones"] }),
        queryClient.invalidateQueries({ queryKey: ["soporte", "staff", "detalle", selectedConversationId] }),
      ]);
    },
    onError: (error: Error) => setErrorMsg(error.message),
  });

  const stateMutation = useMutation({
    mutationFn: (estado: "abierta" | "respondida" | "cerrada") =>
      api.patch<{ ok: true }>(`/soporte/conversaciones/${selectedConversationId}`, { estado }),
    onSuccess: async () => {
      setErrorMsg("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["soporte", "staff", "conversaciones"] }),
        queryClient.invalidateQueries({ queryKey: ["soporte", "staff", "detalle", selectedConversationId] }),
      ]);
    },
    onError: (error: Error) => setErrorMsg(error.message),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<{ conversacion: SupportConversation }>("/soporte/conversaciones", {
        usuario_id: Number(nuevoUsuarioId),
        asunto: nuevoAsunto.trim(),
        cuerpo: nuevoMensaje.trim(),
      }),
    onSuccess: async (result) => {
      setNuevoUsuarioId("");
      setNuevoAsunto("");
      setNuevoMensaje("");
      setErrorMsg("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["soporte", "staff", "conversaciones"] }),
        queryClient.invalidateQueries({ queryKey: ["soporte", "cliente", "conversaciones"] }),
      ]);
      setEstadoFiltro("respondida");
      setSelectedId(result.conversacion.id);
    },
    onError: (error: Error) => setErrorMsg(error.message),
  });

  const conversaciones = conversationsQuery.data ?? [];
  const usuarios = usersQuery.data ?? [];
  const detalle = detailQuery.data;
  useEffect(() => {
    if (!conversaciones.length) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!selectedId || !conversaciones.some((item) => item.id === selectedId)) {
      setSelectedId(conversaciones[0].id);
    }
  }, [conversaciones, selectedId]);

  const counters = useMemo(
    () => ({
      abiertas: conversaciones.filter((item) => item.estado === "abierta").length,
      respondidas: conversaciones.filter((item) => item.estado === "respondida").length,
      cerradas: conversaciones.filter((item) => item.estado === "cerrada").length,
    }),
    [conversaciones],
  );

  return (
    <section className="dashboard-section perfil-dashboard-section">
      <div className="support-shell support-shell-staff">
        <aside className="support-sidebar">
          <div className="support-card">
            <div className="support-card-head">
              <div>
                <h1 className="support-title">Inbox staff</h1>
                <p className="support-subtitle">
                  {counters.abiertas} abiertas, {counters.respondidas} respondidas, {counters.cerradas} cerradas
                </p>
              </div>
            </div>

            <div className="support-form">
              <select
                className="ios-input"
                value={nuevoUsuarioId}
                onChange={(event) => setNuevoUsuarioId(event.target.value)}
              >
                <option value="">Elegir usuario</option>
                {usuarios.map((usuario) => (
                  <option key={usuario.id} value={usuario.id}>
                    {usuario.nombre} - {usuario.email}
                  </option>
                ))}
              </select>
              <input
                className="ios-input"
                value={nuevoAsunto}
                onChange={(event) => setNuevoAsunto(event.target.value)}
                placeholder="Asunto para el usuario"
              />
              <textarea
                className="ios-input support-textarea"
                value={nuevoMensaje}
                onChange={(event) => setNuevoMensaje(event.target.value)}
                placeholder="Mensaje inicial visible para el usuario"
              />
              <button
                className="ios-btn-primary"
                disabled={createMutation.isPending || !nuevoUsuarioId || nuevoAsunto.trim().length < 3 || !nuevoMensaje.trim()}
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending ? "Enviando..." : "Iniciar chat"}
              </button>
            </div>

            <div className="support-filter-row">
              {[
                { id: "abierta", label: "Abiertas" },
                { id: "respondida", label: "Respondidas" },
                { id: "cerrada", label: "Cerradas" },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`support-chip${estadoFiltro === item.id ? " active" : ""}`}
                  onClick={() => setEstadoFiltro(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="support-list">
            {conversationsQuery.isLoading ? <p className="support-empty">Cargando conversaciones...</p> : null}
            {!conversationsQuery.isLoading && !conversaciones.length ? (
              <p className="support-empty">No hay conversaciones para este estado.</p>
            ) : null}
            {conversaciones.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`support-list-item${selectedConversationId === item.id ? " active" : ""}`}
                onClick={() => setSelectedId(item.id)}
              >
                <div className="support-list-row">
                  <strong>{item.usuario.nombre}</strong>
                  {item.unread_staff > 0 ? <span className="support-badge">{item.unread_staff}</span> : null}
                </div>
                <p>{item.asunto || "Consulta general"}</p>
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
                      Cliente: {detalle.conversacion.usuario.nombre} · {detalle.conversacion.usuario.email}
                    </p>
                  </div>
                  <div className="support-actions">
                    <button className="adm-btn-secondary adm-btn-inline" onClick={() => stateMutation.mutate("abierta")}>Reabrir</button>
                    <button className="adm-btn-secondary adm-btn-inline" onClick={() => stateMutation.mutate("respondida")}>Marcar respondida</button>
                    <button className="adm-btn-secondary adm-btn-inline" onClick={() => stateMutation.mutate("cerrada")}>Cerrar</button>
                  </div>
                </div>

                <div className="support-messages">
                  {detalle.mensajes.map((mensaje) => (
                    <article
                      key={mensaje.id}
                      className={`support-message${mensaje.autor_tipo === "staff" && !mensaje.es_interno ? " mine" : ""}${mensaje.es_interno ? " internal" : ""}`}
                    >
                      <div className="support-message-meta">
                        <strong>{mensaje.autor_label}</strong>
                        <span>{mensaje.es_interno ? "Nota interna" : mensaje.autor_rol}</span>
                        <span>{formatDate(mensaje.created_at)}</span>
                      </div>
                      <p>{mensaje.cuerpo}</p>
                    </article>
                  ))}
                </div>

                <div className="support-reply-grid">
                  <div className="support-reply-box">
                    <p className="support-box-title">Respuesta visible al cliente</p>
                    <textarea
                      className="ios-input support-textarea"
                      value={respuesta}
                      onChange={(event) => setRespuesta(event.target.value)}
                      placeholder="Escribe una respuesta como Staff"
                    />
                    <button
                      className="ios-btn-primary"
                      disabled={sendMutation.isPending || !respuesta.trim()}
                      onClick={() => sendMutation.mutate({ cuerpo: respuesta.trim(), esInterno: false })}
                    >
                      {sendMutation.isPending ? "Enviando..." : "Responder como Staff"}
                    </button>
                  </div>

                  <div className="support-reply-box">
                    <p className="support-box-title">Nota interna</p>
                    <textarea
                      className="ios-input support-textarea"
                      value={notaInterna}
                      onChange={(event) => setNotaInterna(event.target.value)}
                      placeholder="Nota privada para admins/vendedores"
                    />
                    <button
                      className="adm-btn-secondary"
                      disabled={sendMutation.isPending || !notaInterna.trim()}
                      onClick={() => sendMutation.mutate({ cuerpo: notaInterna.trim(), esInterno: true })}
                    >
                      Guardar nota interna
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <p className="support-empty">Selecciona una conversación para verla.</p>
            )}

            {errorMsg ? <div className="adm-msg-err"><p>{errorMsg}</p></div> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
