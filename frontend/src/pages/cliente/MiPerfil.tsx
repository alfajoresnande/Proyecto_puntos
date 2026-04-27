import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
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

function cleanDni(value: string): string {
  return value.replace(/\D/g, "");
}

function cleanTelefono(value: string): string {
  return value.replace(/[^0-9+\-()\s]/g, "");
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
  const codigoSectionRef = useRef<HTMLDivElement | null>(null);

  const meQuery = useQuery({
    queryKey: ["cliente", "me"],
    queryFn: () => api.get<ClienteMe>("/cliente/me"),
  });

  const miCodigoQuery = useQuery({
    queryKey: ["cliente", "mi-codigo"],
    queryFn: () => api.get<MiCodigo>("/cliente/mi-codigo"),
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
    if (hash !== "#codigo-invitacion") return;
    if (!codigoSectionRef.current) return;
    window.setTimeout(() => {
      codigoSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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
  const yaUsoCodigoInvitacion = Boolean(me?.referido_por);

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
    </section>
  );
}
