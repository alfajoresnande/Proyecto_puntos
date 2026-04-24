import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { useAuthStore } from "../../store/authStore";

type ClienteMe = {
  id: number;
  nombre: string;
  email: string;
  dni: string | null;
  telefono?: string | null;
  puntos_saldo: number;
  codigo_invitacion: string | null;
  referido_por: number | null;
};

type MiCodigo = {
  codigo: string | null;
  total_invitados: number;
};

type PerfilResponse = {
  ok: boolean;
  user: {
    id: number;
    nombre: string;
    email: string;
    rol: "cliente" | "vendedor" | "admin";
    dni: string | null;
    telefono?: string | null;
    puntos_saldo: number;
    codigo_invitacion: string | null;
    referido_por: number | null;
  };
};

type UsarCodigoInvitacionResponse = {
  ok: boolean;
  invitador: string;
  puntos_ganados: number;
  nuevo_saldo: number;
};

type Canje = {
  id: number;
  codigo_retiro?: string | null;
  puntos_usados: number;
  estado: "pendiente" | "entregado" | "no_disponible" | "expirado" | "cancelado";
  fecha_limite_retiro: string | null;
  notas: string | null;
  created_at: string;
  producto_nombre: string;
  producto_imagen: string | null;
  sucursal_id?: number | null;
  sucursal_nombre?: string | null;
  sucursal_direccion?: string | null;
  sucursal_piso?: string | null;
  sucursal_localidad?: string | null;
  sucursal_provincia?: string | null;
};

type CanjeFilter = "todos" | Canje["estado"];

const CANJE_FILTERS: Array<{ key: CanjeFilter; label: string }> = [
  { key: "todos", label: "Todos" },
  { key: "pendiente", label: "Pendiente" },
  { key: "entregado", label: "Entregado" },
  { key: "no_disponible", label: "No disponible" },
  { key: "expirado", label: "Expirado" },
  { key: "cancelado", label: "Cancelado" },
];

function cleanDni(value: string): string {
  return value.replace(/\D/g, "");
}

function cleanTelefono(value: string): string {
  return value.replace(/[^0-9+\-()\s]/g, "");
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("es-AR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function estadoLabel(estado: Canje["estado"]): string {
  if (estado === "no_disponible") return "NO DISPONIBLE";
  return estado.toUpperCase();
}

function getCanjeCode(canje: Canje): string {
  if (!canje.codigo_retiro || /^C0{2,}[A-Z0-9]*$/.test(canje.codigo_retiro)) return "Generando...";
  return canje.codigo_retiro;
}

export function MiPerfil() {
  const queryClient = useQueryClient();
  const updateUser = useAuthStore((state) => state.updateUser);
  const updateUserPoints = useAuthStore((state) => state.updateUserPoints);

  const [nombre, setNombre] = useState("");
  const [dni, setDni] = useState("");
  const [telefono, setTelefono] = useState("");
  const [codigoInvitacionInput, setCodigoInvitacionInput] = useState("");
  const [perfilOk, setPerfilOk] = useState("");
  const [perfilErr, setPerfilErr] = useState("");
  const [codigoOk, setCodigoOk] = useState("");
  const [codigoErr, setCodigoErr] = useState("");
  const [canjeFilter, setCanjeFilter] = useState<CanjeFilter>("todos");
  const [canjePage, setCanjePage] = useState(1);
  const codigoSectionRef = useRef<HTMLDivElement | null>(null);
  const misCanjesSectionRef = useRef<HTMLDivElement | null>(null);

  const meQuery = useQuery({
    queryKey: ["cliente", "me"],
    queryFn: () => api.get<ClienteMe>("/cliente/me"),
  });

  const miCodigoQuery = useQuery({
    queryKey: ["cliente", "mi-codigo"],
    queryFn: () => api.get<MiCodigo>("/cliente/mi-codigo"),
  });

  const canjesQuery = useQuery({
    queryKey: ["cliente", "canjes"],
    queryFn: () => api.get<Canje[]>("/cliente/canjes"),
  });

  useEffect(() => {
    const me = meQuery.data;
    if (!me) return;
    setNombre(me.nombre || "");
    setDni(me.dni || "");
    setTelefono(me.telefono || "");
  }, [meQuery.data]);

  useEffect(() => {
    const hash = window.location.hash;
    const scrollTo = hash === "#mis-canjes" ? misCanjesSectionRef.current : hash === "#codigo-invitacion" ? codigoSectionRef.current : null;
    if (!scrollTo) return;
    window.setTimeout(() => {
      scrollTo.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
  }, []);

  const guardarPerfilMutation = useMutation({
    mutationFn: (payload: { nombre?: string; dni?: string; telefono?: string }) =>
      api.patch<PerfilResponse>("/cliente/perfil", payload),
    onSuccess: async (result) => {
      setPerfilErr("");
      setPerfilOk("Datos actualizados correctamente.");
      updateUser({
        nombre: result.user.nombre,
        dni: result.user.dni,
        telefono: result.user.telefono || null,
      });
      await queryClient.invalidateQueries({ queryKey: ["cliente", "me"] });
    },
    onError: (error: Error) => {
      setPerfilOk("");
      setPerfilErr(error.message);
    },
  });

  const usarCodigoInvitacionMutation = useMutation({
    mutationFn: (codigo: string) =>
      api.post<UsarCodigoInvitacionResponse>("/cliente/usar-codigo-invitacion", { codigo }),
    onSuccess: async (result) => {
      setCodigoErr("");
      setCodigoOk(
        `Codigo aplicado. Ganaste +${result.puntos_ganados} puntos por invitacion de ${result.invitador}.`,
      );
      setCodigoInvitacionInput("");
      updateUserPoints(result.nuevo_saldo);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["cliente", "me"] }),
        queryClient.invalidateQueries({ queryKey: ["cliente", "mi-codigo"] }),
        queryClient.invalidateQueries({ queryKey: ["cliente", "movimientos"] }),
      ]);
    },
    onError: (error: Error) => {
      setCodigoOk("");
      setCodigoErr(error.message);
    },
  });

  const me = meQuery.data;
  const miCodigo = miCodigoQuery.data;
  const canjes = canjesQuery.data ?? [];
  const yaUsoCodigoInvitacion = Boolean(me?.referido_por);

  const canjeStats = useMemo(() => {
    const counts = {
      todos: canjes.length,
      pendiente: 0,
      entregado: 0,
      no_disponible: 0,
      expirado: 0,
      cancelado: 0,
    };

    let puntosUsados = 0;
    for (const canje of canjes) {
      counts[canje.estado] += 1;
      puntosUsados += Number(canje.puntos_usados || 0);
    }

    return { counts, puntosUsados };
  }, [canjes]);

  const canjesFiltrados = useMemo(() => {
    if (canjeFilter === "todos") return canjes;
    return canjes.filter((canje) => canje.estado === canjeFilter);
  }, [canjes, canjeFilter]);

  const CANJES_PER_PAGE = 3;
  const canjesTotalPages = Math.max(1, Math.ceil(canjesFiltrados.length / CANJES_PER_PAGE));
  const canjesPaginaActual = useMemo(() => {
    const currentPage = Math.min(canjePage, canjesTotalPages);
    const start = (currentPage - 1) * CANJES_PER_PAGE;
    return canjesFiltrados.slice(start, start + CANJES_PER_PAGE);
  }, [canjesFiltrados, canjePage, canjesTotalPages]);

  useEffect(() => {
    setCanjePage(1);
  }, [canjeFilter, canjes.length]);

  async function guardarPerfil() {
    if (!me) return;

    setPerfilOk("");
    setPerfilErr("");

    const nombreLimpio = nombre.trim();
    const dniLimpio = cleanDni(dni.trim());
    const telefonoLimpio = cleanTelefono(telefono.trim());
    const payload: { nombre?: string; dni?: string; telefono?: string } = {};

    if (!nombreLimpio) {
      setPerfilErr("El nombre no puede quedar vacio.");
      return;
    }
    if (!/^\d{6,15}$/.test(dniLimpio)) {
      setPerfilErr("El DNI debe contener solo numeros (6 a 15 digitos).");
      return;
    }
    if (telefonoLimpio && !/^[0-9+\-()\s]{7,25}$/.test(telefonoLimpio)) {
      setPerfilErr("Telefono invalido.");
      return;
    }

    if (nombreLimpio !== (me.nombre || "")) payload.nombre = nombreLimpio;
    if (dniLimpio !== (me.dni || "")) payload.dni = dniLimpio;
    if (telefonoLimpio !== (me.telefono || "")) payload.telefono = telefonoLimpio;

    if (!payload.nombre && !payload.dni && payload.telefono === undefined) {
      setPerfilOk("No hay cambios para guardar.");
      return;
    }

    await guardarPerfilMutation.mutateAsync(payload);
  }

  async function aplicarCodigoInvitacion() {
    const codigo = codigoInvitacionInput.trim().toUpperCase();
    if (!codigo) return;
    setCodigoOk("");
    setCodigoErr("");
    await usarCodigoInvitacionMutation.mutateAsync(codigo);
  }

  return (
    <section className="dashboard-section perfil-dashboard-section">
      <h1 className="ios-title mb-4">Mi perfil</h1>

      <div className="perfil-top-grid">
        <div className="ios-card p-5" style={{ borderLeft: "4px solid #D4621A" }}>
          <p className="ios-label" style={{ paddingLeft: 0 }}>Datos obligatorios</p>

          <div style={{ display: "grid", gap: "0.75rem" }}>
            <label className="ios-label" style={{ paddingLeft: 0, paddingBottom: 0 }}>Nombre</label>
            <input
              className="ios-input"
              value={nombre}
              onChange={(event) => setNombre(event.target.value)}
              placeholder="Tu nombre completo"
              maxLength={100}
            />

            <label className="ios-label" style={{ paddingLeft: 0, paddingBottom: 0 }}>Email</label>
            <input className="ios-input" value={me?.email || ""} disabled />

            <label className="ios-label" style={{ paddingLeft: 0, paddingBottom: 0 }}>
              DNI (requerido para canjear)
            </label>
            <input
              className="ios-input"
              value={dni}
              onChange={(event) => setDni(cleanDni(event.target.value))}
              inputMode="numeric"
              maxLength={15}
              placeholder="Ej: 35111222"
            />

            <label className="ios-label" style={{ paddingLeft: 0, paddingBottom: 0 }}>Telefono</label>
            <input
              className="ios-input"
              value={telefono}
              onChange={(event) => setTelefono(cleanTelefono(event.target.value))}
              inputMode="tel"
              maxLength={25}
              placeholder="Ej: +54 379 123-4567"
            />
          </div>

          <button
            className="ios-btn-primary mt-4"
            onClick={() => {
              void guardarPerfil();
            }}
            disabled={guardarPerfilMutation.isPending || meQuery.isLoading}
          >
            {guardarPerfilMutation.isPending ? "Guardando..." : "Guardar datos"}
          </button>

          {perfilOk ? (
            <div className="status-ok-box">
              <p>{perfilOk}</p>
            </div>
          ) : null}
          {perfilErr ? (
            <div className="status-err-box">
              <p>{perfilErr}</p>
            </div>
          ) : null}
        </div>

        <div
          ref={codigoSectionRef}
          id="codigo-invitacion"
          className="ios-card p-5"
          style={{ borderLeft: "4px solid #B85415", scrollMarginTop: "84px" }}
        >
          <p className="ios-label" style={{ paddingLeft: 0 }}>Codigo de invitacion</p>

          <div className="status-ok-box" style={{ marginTop: "0.35rem" }}>
            <p style={{ margin: 0 }}>
              Tu codigo: <strong>{miCodigo?.codigo || me?.codigo_invitacion || "-"}</strong>
            </p>
            <p style={{ margin: "0.35rem 0 0" }}>
              Invitados registrados: <strong>{miCodigo?.total_invitados ?? 0}</strong>
            </p>
          </div>

          <p className="text-xs mt-3" style={{ color: "#A08060" }}>
            Puedes usar un codigo de invitacion solo una vez por usuario.
          </p>

          {yaUsoCodigoInvitacion ? (
            <div className="status-ok-box">
              <p>Ya aplicaste un codigo de invitacion en tu cuenta.</p>
            </div>
          ) : (
            <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.75rem" }}>
              <input
                type="text"
                className="ios-input"
                value={codigoInvitacionInput}
                onChange={(event) => setCodigoInvitacionInput(event.target.value.toUpperCase())}
                placeholder="Ingresa codigo de invitacion"
                style={{ textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, flex: 1 }}
                disabled={usarCodigoInvitacionMutation.isPending}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  void aplicarCodigoInvitacion();
                }}
              />
              <button
                className="ios-btn-primary"
                style={{
                  width: "auto",
                  padding: "0 1.25rem",
                  borderRadius: "12px",
                  fontSize: "0.9rem",
                  whiteSpace: "nowrap",
                }}
                disabled={usarCodigoInvitacionMutation.isPending || !codigoInvitacionInput.trim()}
                onClick={() => {
                  void aplicarCodigoInvitacion();
                }}
              >
                {usarCodigoInvitacionMutation.isPending ? "..." : "Aplicar"}
              </button>
            </div>
          )}

          {codigoOk ? (
            <div className="status-ok-box">
              <p>{codigoOk}</p>
            </div>
          ) : null}
          {codigoErr ? (
            <div className="status-err-box">
              <p>{codigoErr}</p>
            </div>
          ) : null}

          <div className="perfil-promo-box mt-6">
            <p className="ios-label" style={{ paddingLeft: 0 }}>Codigo promocional</p>
            <p className="text-sm" style={{ color: "#6b7280", marginTop: "0.25rem" }}>
              Si tienes un codigo promocional, puedes canjearlo desde tu pantalla de puntos.
            </p>
            <Link
              to="/cliente#canjear-codigo"
              className="ios-btn-secondary"
              style={{ display: "block", marginTop: "0.9rem", textAlign: "center", textDecoration: "none" }}
            >
              Ir a puntos
            </Link>
          </div>
        </div>
      </div>

      <div
        ref={misCanjesSectionRef}
        id="mis-canjes"
        className="ios-card p-5 mt-6"
        style={{ borderLeft: "4px solid #D4621A", scrollMarginTop: "84px" }}
      >
        <p className="ios-label" style={{ paddingLeft: 0 }}>Mis canjes</p>

        <div className="status-ok-box" style={{ marginTop: "0.35rem" }}>
          <p style={{ margin: 0 }}>
            Total de canjes: <strong>{canjeStats.counts.todos}</strong>
          </p>
          <p style={{ margin: "0.35rem 0 0" }}>
            Puntos usados acumulados: <strong>{canjeStats.puntosUsados}</strong>
          </p>
        </div>

        <div className="perfil-canje-filter-row">
          <label className="ios-label" style={{ paddingLeft: 0, paddingBottom: 0 }}>Estado</label>
          <select
            className="ios-input perfil-canje-select"
            value={canjeFilter}
            onChange={(event) => setCanjeFilter(event.target.value as CanjeFilter)}
          >
            {CANJE_FILTERS.map((filter) => (
              <option key={filter.key} value={filter.key}>
                {filter.label} ({canjeStats.counts[filter.key]})
              </option>
            ))}
          </select>
        </div>

        <div className="ios-list" style={{ marginTop: "0.6rem", border: "1px solid #F0DBC5", borderRadius: "12px", overflow: "hidden" }}>
          {canjesQuery.isLoading ? <div className="ios-row text-sm status-muted">Cargando canjes...</div> : null}
          {!canjesQuery.isLoading && canjesFiltrados.length === 0 ? (
            <div className="ios-row text-sm status-muted">No tienes canjes en este estado.</div>
          ) : null}

          {canjesPaginaActual.map((canje) => (
            <div key={canje.id} className="px-4 py-3 border-b border-ios-gray6 last:border-0">
              <div className="flex items-start gap-3">
                <img
                  src={canje.producto_imagen || "https://via.placeholder.com/48"}
                  className="w-12 h-12 rounded-lg object-cover bg-ios-gray6 flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: "#5D3A1A" }}>
                    {canje.producto_nombre}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="cliente-estado-chip">{estadoLabel(canje.estado)}</span>
                    <span className="text-[10px]" style={{ color: "#A08060" }}>
                      {formatDate(canje.created_at)}
                    </span>
                  </div>
                  <p className="text-[10px] mt-1 uppercase font-bold tracking-wider" style={{ color: "#A08060" }}>
                    Codigo: <span className="text-sm" style={{ color: "#D4621A" }}>{getCanjeCode(canje)}</span>
                  </p>
                  <p className="text-xs mt-1" style={{ color: "#A08060" }}>
                    Puntos usados: <strong style={{ color: "#5D3A1A" }}>{canje.puntos_usados}</strong>
                  </p>
                  {canje.sucursal_nombre ? (
                    <p className="text-xs mt-1" style={{ color: "#A08060" }}>
                      Retiro en:{" "}
                      <strong style={{ color: "#5D3A1A" }}>
                        {canje.sucursal_nombre}
                        {" - "}
                        {canje.sucursal_direccion}
                        {canje.sucursal_piso ? `, Piso ${canje.sucursal_piso}` : ""}
                        {canje.sucursal_localidad ? `, ${canje.sucursal_localidad}` : ""}
                        {canje.sucursal_provincia ? `, ${canje.sucursal_provincia}` : ""}
                      </strong>
                    </p>
                  ) : null}
                </div>
              </div>

              {canje.estado === "pendiente" && canje.fecha_limite_retiro ? (
                <div className="cliente-limite-box">
                  Retirar antes del: <strong style={{ color: "#D4621A" }}>{formatDate(canje.fecha_limite_retiro)}</strong>
                </div>
              ) : null}

              {canje.notas ? (
                <p className="text-xs mt-2" style={{ color: "#A08060" }}>
                  Nota: {canje.notas}
                </p>
              ) : null}
            </div>
          ))}
        </div>

        {!canjesQuery.isLoading && canjesFiltrados.length > 0 ? (
          <div className="perfil-canje-pagination">
            <button
              className="perfil-canje-page-btn"
              disabled={canjePage <= 1}
              onClick={() => setCanjePage((prev) => Math.max(prev - 1, 1))}
            >
              Anterior
            </button>
            <span className="perfil-canje-page-label">
              Pagina {Math.min(canjePage, canjesTotalPages)} de {canjesTotalPages}
            </span>
            <button
              className="perfil-canje-page-btn"
              disabled={canjePage >= canjesTotalPages}
              onClick={() => setCanjePage((prev) => Math.min(prev + 1, canjesTotalPages))}
            >
              Siguiente
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
