import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";

type SupportConversation = {
  id: number;
  asunto: string;
  estado: "abierta" | "respondida" | "cerrada";
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

function onlyDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D+/g, "");
}

function makeInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (!parts.length) return "C";
  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

export function SoporteStaff() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [estadoFiltro, setEstadoFiltro] = useState("abierta");
  const [busqueda, setBusqueda] = useState("");
  const [nuevoUsuarioId, setNuevoUsuarioId] = useState("");
  const [nuevoAsunto, setNuevoAsunto] = useState("");
  const [nuevoMensaje, setNuevoMensaje] = useState("");
  const [respuesta, setRespuesta] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const conversationsQuery = useQuery({
    queryKey: ["soporte", "staff", "conversaciones", estadoFiltro],
    queryFn: () =>
      api.get<SupportConversation[]>(
        `/soporte/conversaciones${estadoFiltro ? `?estado=${encodeURIComponent(estadoFiltro)}` : ""}`,
      ),
    refetchInterval: 5000,
  });

  const usersQuery = useQuery({
    queryKey: ["soporte", "staff", "usuarios", busqueda],
    queryFn: () =>
      api.get<SupportUser[]>(
        `/soporte/usuarios${busqueda.trim() ? `?q=${encodeURIComponent(busqueda.trim())}` : ""}`,
      ),
    staleTime: 30_000,
  });

  const selectedConversationId = selectedId ?? conversationsQuery.data?.[0]?.id ?? null;
  const detailQuery = useQuery({
    queryKey: ["soporte", "staff", "detalle", selectedConversationId],
    queryFn: () => api.get<SupportDetail>(`/soporte/conversaciones/${selectedConversationId}`),
    enabled: Boolean(selectedConversationId),
    refetchInterval: selectedConversationId ? 5000 : false,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<{ conversacion: SupportConversation }>("/soporte/conversaciones", {
        usuario_id: Number(nuevoUsuarioId),
        asunto: nuevoAsunto.trim(),
        cuerpo: nuevoMensaje.trim(),
      }),
    onSuccess: async (result) => {
      setBusqueda("");
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

  const conversaciones = conversationsQuery.data ?? [];
  const usuarios = usersQuery.data ?? [];
  const detalle = detailQuery.data;
  const usuarioSeleccionado =
    usuarios.find((usuario) => String(usuario.id) === nuevoUsuarioId) ?? null;

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

  const conversacionesFiltradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return conversaciones;
    return conversaciones.filter((item) => {
      const values = [
        item.usuario.nombre,
        item.usuario.email,
        item.usuario.dni ?? "",
        item.usuario.telefono ?? "",
        item.asunto ?? "",
      ];
      return values.some((value) => value.toLowerCase().includes(q));
    });
  }, [busqueda, conversaciones]);

  const suggestedUsers = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return [];
    return usuarios
      .filter((usuario) => {
        const values = [usuario.nombre, usuario.email, usuario.dni ?? "", usuario.telefono ?? ""];
        return values.some((value) => value.toLowerCase().includes(q));
      })
      .slice(0, 8);
  }, [busqueda, usuarios]);

  const activeConversation = detalle?.conversacion ?? null;
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
                <p className="support-subtitle">
                  {counters.abiertas} abiertas, {counters.respondidas} respondidas, {counters.cerradas} cerradas
                </p>
              </div>
            </div>

            <div className="support-search-wrap">
              <span className="support-search-icon" aria-hidden="true">⌕</span>
              <input
                className="ios-input support-search-input"
                value={busqueda}
                onChange={(event) => setBusqueda(event.target.value)}
                placeholder="Buscar un chat o iniciar uno nuevo"
              />
            </div>

            {busqueda.trim() ? (
              <div className="support-suggestions">
                {suggestedUsers.length ? (
                  suggestedUsers.map((usuario) => (
                    <button
                      key={usuario.id}
                      type="button"
                      className={`support-suggestion-item${String(usuario.id) === nuevoUsuarioId ? " active" : ""}`}
                      onClick={() => {
                        setNuevoUsuarioId(String(usuario.id));
                        setBusqueda(usuario.nombre);
                      }}
                    >
                      <span className="support-suggestion-name">{usuario.nombre}</span>
                      <span className="support-suggestion-meta">
                        {usuario.dni ? `DNI ${usuario.dni} · ` : ""}
                        {usuario.email}
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="support-suggestion-empty">No encontramos usuarios relacionados.</div>
                )}
              </div>
            ) : null}

            {usuarioSeleccionado ? (
              <div className="support-selected-user">
                <div className="support-chat-row">
                  <div className="support-chat-avatar" aria-hidden="true">
                    {makeInitials(usuarioSeleccionado.nombre)}
                  </div>
                  <div className="support-chat-main">
                    <strong>{usuarioSeleccionado.nombre}</strong>
                    <p>
                      {usuarioSeleccionado.dni ? `DNI ${usuarioSeleccionado.dni} · ` : ""}
                      {usuarioSeleccionado.email}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="support-selected-user-clear"
                  onClick={() => {
                    setNuevoUsuarioId("");
                    setBusqueda("");
                  }}
                >
                  Quitar
                </button>
              </div>
            ) : null}

            <div className="support-form support-form-compact">
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
                disabled={
                  createMutation.isPending ||
                  !nuevoUsuarioId ||
                  nuevoAsunto.trim().length < 3 ||
                  !nuevoMensaje.trim()
                }
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

          <div className="support-list support-list-messenger">
            {conversationsQuery.isLoading ? <p className="support-empty">Cargando conversaciones...</p> : null}
            {!conversationsQuery.isLoading && !conversacionesFiltradas.length ? (
              <p className="support-empty">No hay conversaciones para este estado.</p>
            ) : null}
            {conversacionesFiltradas.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`support-list-item${selectedConversationId === item.id ? " active" : ""}`}
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
                    <p>{item.last_public_message || item.asunto || "Sin mensajes visibles."}</p>
                    <div className="support-list-row support-list-meta">
                      <span>{item.usuario.email}</span>
                      {item.unread_staff > 0 ? <span className="support-badge">{item.unread_staff}</span> : null}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <div className="support-thread">
          <div className="support-card support-thread-card support-thread-card-messenger">
            {activeConversation ? (
              <>
                <div className="support-card-head support-thread-head support-thread-head-messenger">
                  <div className="support-chat-row">
                    <div className="support-chat-avatar" aria-hidden="true">
                      {makeInitials(activeConversation.usuario.nombre)}
                    </div>
                    <div className="support-chat-main">
                      <h2 className="support-thread-title">{activeConversation.usuario.nombre}</h2>
                      <p className="support-subtitle">
                        {activeConversation.usuario.email}
                        {activeConversation.usuario.dni ? ` · DNI ${activeConversation.usuario.dni}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="support-thread-actions">
                    {whatsappUrl ? (
                      <a
                        href={whatsappUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="support-wa-button"
                      >
                        Hablar por WhatsApp
                      </a>
                    ) : null}
                    <div className="support-actions">
                      <button className="adm-btn-secondary adm-btn-inline" onClick={() => stateMutation.mutate("abierta")}>Reabrir</button>
                      <button className="adm-btn-secondary adm-btn-inline" onClick={() => stateMutation.mutate("respondida")}>Respondida</button>
                      <button className="adm-btn-secondary adm-btn-inline" onClick={() => stateMutation.mutate("cerrada")}>Cerrar</button>
                    </div>
                  </div>
                </div>

                <div className="support-messages support-messages-messenger">
                  {detalle?.mensajes.map((mensaje) => (
                    <article
                      key={mensaje.id}
                      className={`support-message${mensaje.autor_tipo === "staff" && !mensaje.es_interno ? " mine" : ""}${mensaje.es_interno ? " internal" : ""}`}
                    >
                      <div className="support-message-meta">
                        <strong>{mensaje.autor_label}</strong>
                        <span>{formatDate(mensaje.created_at)}</span>
                      </div>
                      <p>{mensaje.cuerpo}</p>
                    </article>
                  ))}
                </div>

                <div className="support-thread-footer">
                  <textarea
                    className="ios-input support-composer-textarea"
                    value={respuesta}
                    onChange={(event) => setRespuesta(event.target.value)}
                    placeholder="Escribe un mensaje..."
                  />
                  <button
                    className="ios-btn-primary support-composer-send"
                    disabled={sendMutation.isPending || !respuesta.trim()}
                    onClick={() => sendMutation.mutate()}
                  >
                    {sendMutation.isPending ? "Enviando..." : "Enviar"}
                  </button>
                </div>
              </>
            ) : (
              <p className="support-empty">Selecciona una conversacion para verla.</p>
            )}

            {errorMsg ? <div className="adm-msg-err"><p>{errorMsg}</p></div> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
