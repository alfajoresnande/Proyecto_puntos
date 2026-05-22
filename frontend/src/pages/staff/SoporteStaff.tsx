import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { api } from "../../api";
import { useToast } from "../../components/ToastProvider";
import { formatBuenosAiresDateTime } from "../../lib/dateTime";

type ConversationState = "abierta" | "respondida" | "cerrada" | "archivada";
type ViewFilter = "todos" | "prioritarios";

type SupportConversation = {
  id: number;
  asunto: string;
  estado: ConversationState;
  prioridad: "normal" | "alta";
  ultimo_mensaje_at: string;
  last_public_message?: string | null;
  unread_staff: number;
  asignado_a: number | null;
  asignado_nombre: string | null;
  usuario: {
    id: number;
    nombre: string;
    email: string;
    dni: string | null;
    telefono: string | null;
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
  dni: string | null;
  telefono: string | null;
  rol: "admin" | "superAdmin" | "vendedor" | "cliente";
};

function formatDate(value: string | null | undefined): string {
  return formatBuenosAiresDateTime(value);
}

function onlyDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D+/g, "");
}

function makeInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (!parts.length) return "C";
  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

function matchesSearch(search: string, values: Array<string | null | undefined>): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return values.some((value) => (value ?? "").toLowerCase().includes(q));
}

function previewText(conversation: SupportConversation): string {
  return conversation.last_public_message || conversation.asunto || "Sin mensajes todavia.";
}

export function SoporteStaff() {
  const queryClient = useQueryClient();
  const { confirmToast, showToast } = useToast();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [viewFilter, setViewFilter] = useState<ViewFilter>("todos");
  const [busqueda, setBusqueda] = useState("");
  const [respuesta, setRespuesta] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const conversationsQuery = useQuery({
    queryKey: ["soporte", "staff", "conversaciones"],
    queryFn: () => api.get<SupportConversation[]>("/soporte/conversaciones"),
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  });

  const usersQuery = useQuery({
    queryKey: ["soporte", "staff", "usuarios", busqueda],
    queryFn: () =>
      api.get<SupportUser[]>(
        `/soporte/usuarios${busqueda.trim() ? `?q=${encodeURIComponent(busqueda.trim())}` : ""}`,
      ),
    staleTime: 30_000,
  });

  const conversaciones = conversationsQuery.data ?? [];
  const usuarios = usersQuery.data ?? [];

  const conversacionesVisibles = useMemo(
    () => conversaciones.filter((item) => item.estado !== "archivada"),
    [conversaciones],
  );

  const counters = useMemo(
    () => ({
      total: conversacionesVisibles.length,
      prioritarias: conversacionesVisibles.filter((item) => item.prioridad === "alta").length,
    }),
    [conversacionesVisibles],
  );

  const conversacionesFiltradas = useMemo(() => {
    return conversacionesVisibles.filter((item) => {
      const matchesView = viewFilter === "prioritarios" ? item.prioridad === "alta" : true;

      return matchesView && matchesSearch(busqueda, [
        item.usuario.nombre,
        item.usuario.email,
        item.usuario.dni,
        item.usuario.telefono,
        item.asunto,
        item.last_public_message,
      ]);
    });
  }, [busqueda, conversacionesVisibles, viewFilter]);

  const usuariosFiltrados = useMemo(() => {
    return usuarios.filter((usuario) =>
      matchesSearch(busqueda, [usuario.nombre, usuario.email, usuario.dni, usuario.telefono]),
    );
  }, [busqueda, usuarios]);

  const selectedConversationId = selectedId ?? conversacionesFiltradas[0]?.id ?? null;
  const detailQuery = useQuery({
    queryKey: ["soporte", "staff", "detalle", selectedConversationId],
    queryFn: () => api.get<SupportDetail>(`/soporte/conversaciones/${selectedConversationId}`),
    enabled: Boolean(selectedConversationId),
    refetchInterval: selectedConversationId ? 5000 : false,
    refetchIntervalInBackground: true,
  });

  const createMutation = useMutation({
    mutationFn: (usuarioId: number) =>
      api.post<{ conversacion: SupportConversation }>("/soporte/conversaciones", {
        usuario_id: usuarioId,
        prioridad: "normal",
      }),
    onSuccess: async (result) => {
      setErrorMsg("");
      setViewFilter("todos");
      setSelectedId(result.conversacion.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["soporte", "staff", "conversaciones"] }),
        queryClient.invalidateQueries({ queryKey: ["soporte", "cliente", "conversaciones"] }),
        queryClient.invalidateQueries({ queryKey: ["navbar", "support-unread"] }),
      ]);
    },
    onError: (error: Error) => setErrorMsg(error.message),
  });

  const sendMutation = useMutation({
    mutationFn: () =>
      api.post<{ ok: true }>(`/soporte/conversaciones/${selectedConversationId}/mensajes`, {
        cuerpo: respuesta.trim(),
        es_interno: false,
      }),
    onSuccess: async () => {
      setRespuesta("");
      setErrorMsg("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["soporte", "staff", "conversaciones"] }),
        queryClient.invalidateQueries({ queryKey: ["soporte", "staff", "detalle", selectedConversationId] }),
        queryClient.invalidateQueries({ queryKey: ["navbar", "support-unread"] }),
      ]);
    },
    onError: (error: Error) => setErrorMsg(error.message),
  });

  const priorityMutation = useMutation({
    mutationFn: (prioridad: "normal" | "alta") =>
      api.patch<{ ok: true }>(`/soporte/conversaciones/${selectedConversationId}`, { prioridad }),
    onSuccess: async () => {
      setErrorMsg("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["soporte", "staff", "conversaciones"] }),
        queryClient.invalidateQueries({ queryKey: ["soporte", "staff", "detalle", selectedConversationId] }),
        queryClient.invalidateQueries({ queryKey: ["navbar", "support-unread"] }),
      ]);
    },
    onError: (error: Error) => setErrorMsg(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (conversationId: number) => api.delete<{ ok: true }>(`/soporte/conversaciones/${conversationId}`),
    onSuccess: async (_result, conversationId) => {
      setErrorMsg("");
      setSelectedId((current) => (current === conversationId ? null : current));
      queryClient.removeQueries({ queryKey: ["soporte", "staff", "detalle", conversationId] });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["soporte", "staff", "conversaciones"] }),
        queryClient.invalidateQueries({ queryKey: ["soporte", "cliente", "conversaciones"] }),
        queryClient.invalidateQueries({ queryKey: ["navbar", "support-unread"] }),
      ]);
      showToast({
        tone: "success",
        title: "Chat eliminado",
        message: "La conversacion se borro correctamente.",
      });
    },
    onError: (error: Error) => {
      const message = error.message || "No se pudo eliminar el chat.";
      setErrorMsg(message);
      showToast({ tone: "danger", title: "No se pudo eliminar", message });
    },
  });

  useEffect(() => {
    if (!conversacionesFiltradas.length) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!selectedId || !conversacionesFiltradas.some((item) => item.id === selectedId)) {
      setSelectedId(conversacionesFiltradas[0].id);
    }
  }, [conversacionesFiltradas, selectedId]);

  useEffect(() => {
    if (!detailQuery.data || !selectedConversationId) return;
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["soporte", "staff", "conversaciones"] }),
      queryClient.invalidateQueries({ queryKey: ["navbar", "support-unread"] }),
    ]);
  }, [detailQuery.dataUpdatedAt, queryClient, selectedConversationId]);

  function openUserConversation(usuario: SupportUser) {
    const existing =
      conversacionesVisibles.find((item) => item.usuario.id === usuario.id) ??
      conversaciones.find((item) => item.usuario.id === usuario.id);

    if (existing) {
      setSelectedId(existing.id);
      setViewFilter(existing.prioridad === "alta" ? "prioritarios" : "todos");
      return;
    }

    createMutation.mutate(usuario.id);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    if (sendMutation.isPending || !respuesta.trim()) return;
    sendMutation.mutate();
  }

  const activeConversation = detailQuery.data?.conversacion ?? null;
  const whatsappDigits = onlyDigits(activeConversation?.usuario.telefono);
  const whatsappUrl = whatsappDigits ? `https://wa.me/${whatsappDigits}` : null;

  return (
    <section className="dashboard-section perfil-dashboard-section support-dashboard-full">
      <div className="support-shell support-shell-staff support-shell-messenger">
        <aside className="support-sidebar support-sidebar-messenger">
          <div className="support-card support-card-messenger">
            <div className="support-card-head">
              <div>
                <h1 className="support-title">Mensajes del staff</h1>
                <p className="support-subtitle">{counters.total} chats activos</p>
              </div>
            </div>

            <div className="support-search-wrap">
              <input
                className="ios-input support-search-input"
                value={busqueda}
                onChange={(event) => setBusqueda(event.target.value)}
                placeholder="Buscar un chat o iniciar uno nuevo"
              />
            </div>

            <div className="support-filter-row support-filter-row-messenger">
              {[
                { id: "todos", label: "Todos", count: counters.total },
                { id: "prioritarios", label: "Prioritarios", count: counters.prioritarias },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`support-chip${viewFilter === item.id ? " active" : ""}`}
                  onClick={() => setViewFilter(item.id as ViewFilter)}
                >
                  {item.label} {item.count ? item.count : ""}
                </button>
              ))}
            </div>
          </div>

          <div className="support-list support-list-messenger">
            {conversationsQuery.isLoading ? <p className="support-empty">Cargando conversaciones...</p> : null}
            {conversacionesFiltradas.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`support-list-item support-chat-list-item${selectedConversationId === item.id ? " active" : ""}${item.prioridad === "alta" ? " priority" : ""}`}
                onClick={() => setSelectedId(item.id)}
              >
                <div className="support-chat-row">
                  <div className="support-chat-avatar" aria-hidden="true">
                    {makeInitials(item.usuario.nombre)}
                  </div>
                  <div className="support-chat-main">
                    <div className="support-list-row">
                      <strong>{item.usuario.nombre}</strong>
                      <span>{formatDate(item.ultimo_mensaje_at)}</span>
                    </div>
                    <p>{previewText(item)}</p>
                    <div className="support-list-row support-list-meta">
                      <span>{item.usuario.email}</span>
                      {item.unread_staff > 0 ? <span className="support-badge">{item.unread_staff}</span> : null}
                    </div>
                  </div>
                </div>
              </button>
            ))}

            <div className="support-user-section-title">Todos los usuarios</div>
            {usersQuery.isLoading ? <p className="support-empty">Cargando usuarios...</p> : null}
            {!usersQuery.isLoading && !usuariosFiltrados.length ? (
              <p className="support-empty">No encontramos clientes relacionados.</p>
            ) : null}
            {usuariosFiltrados.map((usuario) => (
              <button
                key={usuario.id}
                type="button"
                className="support-list-item support-user-list-item"
                onClick={() => openUserConversation(usuario)}
                disabled={createMutation.isPending}
              >
                <div className="support-chat-row">
                  <div className="support-chat-avatar support-chat-avatar-client" aria-hidden="true">
                    {makeInitials(usuario.nombre)}
                  </div>
                  <div className="support-chat-main">
                    <strong>{usuario.nombre}</strong>
                    <p>{usuario.email}</p>
                    <p className="support-list-meta">
                      {usuario.dni ? `DNI ${usuario.dni}` : "Cliente"}
                      {usuario.telefono ? ` - ${usuario.telefono}` : ""}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <div className="support-thread">
          <div className="support-card support-thread-card support-thread-card-chat support-thread-card-messenger">
            {activeConversation ? (
              <>
                <div className="support-card-head support-thread-head support-thread-head-chat support-thread-head-messenger">
                  <div className="support-chat-row">
                    <div className="support-chat-avatar" aria-hidden="true">
                      {makeInitials(activeConversation.usuario.nombre)}
                    </div>
                    <div className="support-chat-main">
                      <h2 className="support-thread-title">{activeConversation.usuario.nombre}</h2>
                      <p className="support-subtitle">
                        {activeConversation.usuario.email}
                        {activeConversation.usuario.dni ? ` - DNI ${activeConversation.usuario.dni}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="support-thread-actions">
                    {whatsappUrl ? (
                      <a href={whatsappUrl} target="_blank" rel="noreferrer" className="support-wa-button">
                        Hablar por WhatsApp
                      </a>
                    ) : null}
                    <button
                      className="adm-btn-secondary adm-btn-inline"
                      onClick={() => priorityMutation.mutate(activeConversation.prioridad === "alta" ? "normal" : "alta")}
                    >
                      {activeConversation.prioridad === "alta" ? "Quitar prioridad" : "Prioritario"}
                    </button>
                    <button
                      className="adm-btn-danger adm-btn-inline"
                      disabled={deleteMutation.isPending}
                      onClick={() => {
                        const conversation = activeConversation;
                        confirmToast({
                          tone: "danger",
                          title: `Eliminar chat de ${conversation.usuario.nombre}`,
                          message: "Esta accion borra toda la conversacion. Los mensajes eliminados no se pueden recuperar.",
                          confirmLabel: "Eliminar chat",
                          cancelLabel: "Conservar",
                          onConfirm: () => deleteMutation.mutate(conversation.id),
                        });
                      }}
                    >
                      {deleteMutation.isPending ? "Eliminando..." : "Eliminar chat"}
                    </button>
                  </div>
                </div>

                <div className="support-messages support-messages-chat support-messages-messenger">
                  {detailQuery.data?.mensajes.length ? (
                    detailQuery.data.mensajes.map((mensaje) => (
                      <article
                        key={mensaje.id}
                        className={`support-message support-message-chat${mensaje.autor_tipo === "staff" && !mensaje.es_interno ? " mine" : ""}${mensaje.es_interno ? " internal" : ""}`}
                      >
                        <div className="support-message-meta">
                          <strong>{mensaje.autor_label}</strong>
                          <span>{formatDate(mensaje.created_at)}</span>
                        </div>
                        <p>{mensaje.cuerpo}</p>
                      </article>
                    ))
                  ) : (
                    <p className="support-empty">Todavia no hay mensajes. Escribe abajo para iniciar el chat.</p>
                  )}
                </div>

                <div className="support-thread-footer support-thread-footer-chat">
                  <textarea
                    className="ios-input support-composer-textarea support-composer-textarea-chat"
                    value={respuesta}
                    onChange={(event) => setRespuesta(event.target.value)}
                    onKeyDown={handleComposerKeyDown}
                    placeholder="Escribe un mensaje..."
                  />
                  <button
                    className="ios-btn-primary support-composer-send support-composer-send-chat"
                    disabled={sendMutation.isPending || !respuesta.trim()}
                    onClick={() => sendMutation.mutate()}
                  >
                    {sendMutation.isPending ? "Enviando..." : "Enviar"}
                  </button>
                </div>
              </>
            ) : (
              <p className="support-empty">Selecciona un cliente o una conversacion para ver los mensajes.</p>
            )}

            {errorMsg ? <div className="adm-msg-err"><p>{errorMsg}</p></div> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
