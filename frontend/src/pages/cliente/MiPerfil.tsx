import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { formatBuenosAiresDate } from "../../lib/dateTime";
import { getProfileCompletion } from "../../lib/profileCompletion";
import { useAuthStore } from "../../store/authStore";

type ClienteMe = {
  id: number;
  nombre: string;
  email: string;
  dni: string | null;
  telefono?: string | null;
  fecha_nacimiento?: string | null;
  localidad?: string | null;
  provincia?: string | null;
  puntos_saldo: number;
  codigo_invitacion: string | null;
  referido_por: number | null;
};

type MiCodigo = {
  codigo: string | null;
  total_invitados: number;
};

type Provincia = {
  id: string;
  nombre: string;
};

type Localidad = {
  id: string;
  provincia_id: string;
  nombre: string;
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
    fecha_nacimiento?: string | null;
    localidad?: string | null;
    provincia?: string | null;
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

type ExpiringPointsAlertUnit = "semanas" | "meses";

type ExpiringPointsResponse = {
  ventana_dias: number;
  ventana_valor: number;
  ventana_unidad: ExpiringPointsAlertUnit;
  total_puntos: number;
  proximo_vencimiento: string | null;
  lotes: Array<{
    expires_at: string;
    puntos: number;
  }>;
};

function cleanDni(value: string): string {
  return value.replace(/\D/g, "");
}

function cleanTelefono(value: string): string {
  return value.replace(/[^0-9+\-()\s]/g, "");
}

function dateOnly(value?: string | null): string {
  const match = (value || "").trim().match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

function normalizeDateInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

function getDaysUntilExpiration(value: string | null | undefined): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const diffMs = date.getTime() - Date.now();
  return Math.max(0, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
}

function formatAlertLeadTime(value: number | null | undefined, unit: ExpiringPointsAlertUnit | null | undefined): string {
  const safeValue = typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : 1;
  const safeUnit = unit === "semanas" ? "semanas" : "meses";
  const unitLabel = safeUnit === "semanas"
    ? (safeValue === 1 ? "semana" : "semanas")
    : (safeValue === 1 ? "mes" : "meses");
  return `${safeValue} ${unitLabel}`;
}

export function MiPerfil() {
  const queryClient = useQueryClient();
  const updateUser = useAuthStore((state) => state.updateUser);
  const updateUserPoints = useAuthStore((state) => state.updateUserPoints);

  const [nombre, setNombre] = useState("");
  const [dni, setDni] = useState("");
  const [telefono, setTelefono] = useState("");
  const [fechaNacimiento, setFechaNacimiento] = useState("");
  const [localidad, setLocalidad] = useState("");
  const [provincia, setProvincia] = useState("");
  const [provinciaId, setProvinciaId] = useState("");
  const [localidadId, setLocalidadId] = useState("");
  const [codigoInvitacionInput, setCodigoInvitacionInput] = useState("");
  const [perfilOk, setPerfilOk] = useState("");
  const [perfilErr, setPerfilErr] = useState("");
  const [codigoOk, setCodigoOk] = useState("");
  const [codigoErr, setCodigoErr] = useState("");
  const codigoSectionRef = useRef<HTMLDivElement | null>(null);

  const meQuery = useQuery({
    queryKey: ["cliente", "perfil"],
    queryFn: () => api.get<ClienteMe>("/cliente/me"),
  });

  const miCodigoQuery = useQuery({
    queryKey: ["cliente", "mi-codigo"],
    queryFn: () => api.get<MiCodigo>("/cliente/mi-codigo"),
  });

  const expiringPointsQuery = useQuery({
    queryKey: ["cliente", "puntos-proximos-vencer"],
    queryFn: () => api.get<ExpiringPointsResponse>("/cliente/puntos/proximos-vencer"),
  });

  const provinciasQuery = useQuery({
    queryKey: ["ubicaciones", "provincias"],
    queryFn: () => api.get<Provincia[]>("/ubicaciones/provincias"),
  });

  const localidadesQuery = useQuery({
    queryKey: ["ubicaciones", "localidades", provinciaId],
    queryFn: () => api.get<Localidad[]>(`/ubicaciones/localidades?provincia_id=${encodeURIComponent(provinciaId)}`),
    enabled: Boolean(provinciaId),
  });

  const provincias = provinciasQuery.data ?? [];
  const localidades = localidadesQuery.data ?? [];

  const provinciaSeleccionada = useMemo(
    () => provincias.find((item) => item.id === provinciaId),
    [provinciaId, provincias],
  );
  const useTextBirthdateInput = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return /iP(hone|ad|od)/i.test(navigator.userAgent)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }, []);

  useEffect(() => {
    const me = meQuery.data;
    if (!me) return;
    setNombre(me.nombre || "");
    setDni(me.dni || "");
    setTelefono(me.telefono || "");
    setFechaNacimiento(dateOnly(me.fecha_nacimiento));
    setLocalidad(me.localidad || "");
    setProvincia(me.provincia || "");
  }, [meQuery.data]);

  // Sincronizar authStore cuando React Query recibe datos frescos del perfil
  useEffect(() => {
    if (meQuery.data?.puntos_saldo !== undefined) {
      updateUserPoints(meQuery.data.puntos_saldo);
    }
  }, [meQuery.data, updateUserPoints]);

  useEffect(() => {
    if (!provincia || !provincias.length) {
      if (!provincia) setProvinciaId("");
      return;
    }
    const match = provincias.find((item) => item.nombre.toLowerCase() === provincia.trim().toLowerCase());
    if (match && match.id !== provinciaId) setProvinciaId(match.id);
  }, [provincia, provinciaId, provincias]);

  useEffect(() => {
    if (!localidad || !localidades.length) {
      if (!localidad) setLocalidadId("");
      return;
    }
    const match = localidades.find((item) => item.nombre.toLowerCase() === localidad.trim().toLowerCase());
    if (match && match.id !== localidadId) setLocalidadId(match.id);
  }, [localidad, localidadId, localidades]);

  useEffect(() => {
    const hash = window.location.hash;
    if (hash !== "#codigo-invitacion") return;
    if (!codigoSectionRef.current) return;
    window.setTimeout(() => {
      codigoSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
  }, []);

  const guardarPerfilMutation = useMutation({
    mutationFn: (payload: {
      nombre?: string;
      dni?: string;
      telefono?: string;
      fecha_nacimiento?: string;
      localidad?: string;
      provincia?: string;
    }) =>
      api.patch<PerfilResponse>("/cliente/perfil", payload),
    onSuccess: async (result) => {
      setPerfilErr("");
      setPerfilOk("Datos actualizados correctamente.");
      updateUser({
        nombre: result.user.nombre,
        dni: result.user.dni,
        telefono: result.user.telefono || null,
        fecha_nacimiento: result.user.fecha_nacimiento || null,
        localidad: result.user.localidad || null,
        provincia: result.user.provincia || null,
      });
      await queryClient.invalidateQueries({ queryKey: ["cliente", "perfil"] });
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
        queryClient.invalidateQueries({ queryKey: ["cliente", "perfil"] }),
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
  const yaUsoCodigoInvitacion = Boolean(me?.referido_por);
  const expiringPoints = expiringPointsQuery.data;
  const hasExpiringPoints = Number(expiringPoints?.total_puntos ?? 0) > 0;
  const nextExpirationDays = getDaysUntilExpiration(expiringPoints?.proximo_vencimiento ?? null);
  const expirationAlertLeadTime = formatAlertLeadTime(
    expiringPoints?.ventana_valor,
    expiringPoints?.ventana_unidad,
  );
  const profileCompletion = getProfileCompletion({
    nombre,
    email: me?.email ?? "",
    dni,
    telefono,
    fecha_nacimiento: fechaNacimiento,
    localidad,
    provincia,
  });
  const missingProfileLabels = profileCompletion.missing.map((field) => field.label).join(", ");

  async function guardarPerfil() {
    if (!me) return;

    setPerfilOk("");
    setPerfilErr("");

    const nombreLimpio = nombre.trim();
    const dniLimpio = cleanDni(dni.trim());
    const telefonoLimpio = cleanTelefono(telefono.trim());
    const fechaNacimientoLimpia = fechaNacimiento.trim();
    const localidadLimpia = localidad.trim();
    const provinciaLimpia = provincia.trim();
    const payload: {
      nombre?: string;
      dni?: string;
      telefono?: string;
      fecha_nacimiento?: string;
      localidad?: string;
      provincia?: string;
    } = {};

    if (!nombreLimpio) {
      setPerfilErr("El nombre no puede quedar vacio.");
      return;
    }
    if (dniLimpio && !/^\d{6,15}$/.test(dniLimpio)) {
      setPerfilErr("El DNI debe contener solo numeros (6 a 15 digitos).");
      return;
    }
    if (fechaNacimientoLimpia && !/^\d{4}-\d{2}-\d{2}$/.test(fechaNacimientoLimpia)) {
      setPerfilErr("La fecha de nacimiento debe tener formato YYYY-MM-DD.");
      return;
    }
    if (localidadLimpia && localidadLimpia.length < 2) {
      setPerfilErr("La localidad debe tener al menos 2 caracteres.");
      return;
    }
    if (provinciaLimpia && provinciaLimpia.length < 2) {
      setPerfilErr("La provincia debe tener al menos 2 caracteres.");
      return;
    }
    if (provinciaLimpia && !provinciaId) {
      setPerfilErr("Selecciona una provincia de la lista.");
      return;
    }
    if (provinciaLimpia && !localidadLimpia) {
      setPerfilErr("Selecciona una localidad de la lista.");
      return;
    }
    if (localidadLimpia && !localidadId) {
      setPerfilErr("Selecciona una localidad valida para la provincia elegida.");
      return;
    }
    if (telefonoLimpio && !/^[0-9+\-()\s]{7,25}$/.test(telefonoLimpio)) {
      setPerfilErr("Telefono invalido.");
      return;
    }

    if (nombreLimpio !== (me.nombre || "")) payload.nombre = nombreLimpio;
    if (dniLimpio && dniLimpio !== (me.dni || "")) payload.dni = dniLimpio;
    if (telefonoLimpio !== (me.telefono || "")) payload.telefono = telefonoLimpio;
    if (fechaNacimientoLimpia && fechaNacimientoLimpia !== dateOnly(me.fecha_nacimiento)) {
      payload.fecha_nacimiento = fechaNacimientoLimpia;
    }
    if (localidadLimpia && localidadLimpia !== (me.localidad || "")) payload.localidad = localidadLimpia;
    if (provinciaLimpia && provinciaLimpia !== (me.provincia || "")) payload.provincia = provinciaLimpia;

    if (
      !payload.nombre &&
      !payload.dni &&
      payload.telefono === undefined &&
      payload.fecha_nacimiento === undefined &&
      payload.localidad === undefined &&
      payload.provincia === undefined
    ) {
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

      {hasExpiringPoints ? (
        <div className="perfil-expiry-alert" role="status" aria-live="polite">
          <div className="perfil-expiry-alert-head">
            <div>
              <p className="perfil-expiry-alert-kicker">Puntos por vencer</p>
              <h2 className="perfil-expiry-alert-title">
                Tienes {expiringPoints?.total_puntos ?? 0} puntos por vencer
              </h2>
            </div>
            <span className={`perfil-expiry-alert-badge${nextExpirationDays !== null && nextExpirationDays <= 7 ? " is-urgent" : ""}`}>
              {nextExpirationDays === null
                ? "Revisar"
                : nextExpirationDays <= 1
                  ? "Vence pronto"
                  : `En ${nextExpirationDays} dias`}
            </span>
          </div>

          <p className="perfil-expiry-alert-copy">
            {expiringPoints?.proximo_vencimiento
              ? `Te avisamos ${expirationAlertLeadTime} antes. El proximo vencimiento es el ${formatBuenosAiresDate(expiringPoints.proximo_vencimiento)}.`
              : `Te avisamos ${expirationAlertLeadTime} antes del vencimiento de tus puntos.`}
          </p>

          <div className="perfil-expiry-list">
            {(expiringPoints?.lotes ?? []).map((lote) => (
              <div
                key={`${lote.expires_at}-${lote.puntos}`}
                className={`perfil-expiry-item${(getDaysUntilExpiration(lote.expires_at) ?? 99) <= 7 ? " is-urgent" : ""}`}
              >
                <strong>{lote.puntos} pts</strong>
                <span>Vencen el {formatBuenosAiresDate(lote.expires_at)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="perfil-top-grid">
        <div className="ios-card p-5" style={{ borderLeft: "4px solid #D4621A" }}>
          <p className="ios-label" style={{ paddingLeft: 0 }}>Tus datos</p>
          <p className="text-xs" style={{ color: "#A08060", margin: "0.2rem 0 0.8rem" }}>
            {meQuery.isLoading
              ? "Cargando tus datos..."
              : profileCompletion.isComplete
                ? "Tus datos obligatorios estan completos para comprar."
                : `Debes completar estos datos para la compra: ${missingProfileLabels}.`}
          </p>

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
              DNI
            </label>
            <input
              className="ios-input"
              value={dni}
              onChange={(event) => setDni(cleanDni(event.target.value))}
              inputMode="numeric"
              maxLength={15}
              placeholder="Ej: 35111222"
            />

            <label className="ios-label" style={{ paddingLeft: 0, paddingBottom: 0 }}>Fecha de nacimiento</label>
            <input
              className="ios-input"
              type={useTextBirthdateInput ? "text" : "date"}
              value={fechaNacimiento}
              onChange={(event) => {
                const nextValue = useTextBirthdateInput
                  ? normalizeDateInput(event.target.value)
                  : event.target.value;
                setFechaNacimiento(nextValue);
              }}
              inputMode={useTextBirthdateInput ? "numeric" : undefined}
              maxLength={useTextBirthdateInput ? 10 : undefined}
              placeholder={useTextBirthdateInput ? "AAAA-MM-DD" : undefined}
              autoComplete="bday"
            />

            <label className="ios-label" style={{ paddingLeft: 0, paddingBottom: 0 }}>Provincia</label>
            <select
              className="ios-input"
              value={provinciaId}
              onChange={(event) => {
                const nextId = event.target.value;
                const nextProvincia = provincias.find((item) => item.id === nextId);
                setProvinciaId(nextId);
                setProvincia(nextProvincia?.nombre ?? "");
                setLocalidadId("");
                setLocalidad("");
              }}
              disabled={provinciasQuery.isLoading || provincias.length === 0}
            >
              <option value="">
                {provinciasQuery.isLoading ? "Cargando provincias..." : "Selecciona una provincia"}
              </option>
              {provincias.map((item) => (
                <option key={item.id} value={item.id}>{item.nombre}</option>
              ))}
            </select>

            <label className="ios-label" style={{ paddingLeft: 0, paddingBottom: 0 }}>Localidad</label>
            <select
              className="ios-input"
              value={localidadId}
              onChange={(event) => {
                const nextId = event.target.value;
                const nextLocalidad = localidades.find((item) => item.id === nextId);
                setLocalidadId(nextId);
                setLocalidad(nextLocalidad?.nombre ?? "");
              }}
              disabled={!provinciaId || localidadesQuery.isLoading || localidades.length === 0}
            >
              <option value="">
                {!provinciaSeleccionada
                  ? "Primero selecciona una provincia"
                  : localidadesQuery.isLoading
                    ? "Cargando localidades..."
                    : "Selecciona una localidad"}
              </option>
              {localidades.map((item) => (
                <option key={item.id} value={item.id}>{item.nombre}</option>
              ))}
            </select>

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
    </section>
  );
}
