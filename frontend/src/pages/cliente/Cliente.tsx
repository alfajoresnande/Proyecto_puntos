import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import { useAuthStore } from "../../store/authStore";

type ClienteMe = {
  id: number;
  nombre: string;
  email: string;
  dni: string | null;
  puntos_saldo: number;
  codigo_invitacion: string | null;
};

type Movimiento = {
  id: number;
  tipo: string;
  puntos: number;
  descripcion: string | null;
  created_at: string;
};

type CanjearCodigoResponse = {
  ok: boolean;
  puntos_ganados: number;
  nuevo_saldo: number;
};

function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("es-AR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function Cliente() {
  const [codigoInput, setCodigoInput] = useState("");
  const [codigoOk, setCodigoOk] = useState("");
  const [codigoError, setCodigoError] = useState("");
  const [movimientosPage, setMovimientosPage] = useState(1);
  const canjearCodigoRef = useRef<HTMLParagraphElement | null>(null);

  const queryClient = useQueryClient();
  const updateUserPoints = useAuthStore((state) => state.updateUserPoints);

  const meQuery = useQuery({
    queryKey: ["cliente", "me"],
    queryFn: () => api.get<ClienteMe>("/cliente/me"),
  });

  const movimientosQuery = useQuery({
    queryKey: ["cliente", "movimientos"],
    queryFn: () => api.get<Movimiento[]>("/cliente/movimientos"),
  });

  const canjearCodigoMutation = useMutation({
    mutationFn: (codigo: string) =>
      api.post<CanjearCodigoResponse>("/cliente/canjear-codigo", {
        codigo,
      }),
    onSuccess: async (result) => {
      setCodigoError("");
      setCodigoOk(`Canjeado: +${result.puntos_ganados} puntos. Nuevo saldo: ${result.nuevo_saldo}.`);
      setCodigoInput("");
      updateUserPoints(result.nuevo_saldo);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["cliente", "me"] }),
        queryClient.invalidateQueries({ queryKey: ["cliente", "movimientos"] }),
      ]);
    },
    onError: (error: Error) => {
      setCodigoOk("");
      setCodigoError(error.message);
      if (error.message.toLowerCase().includes("completa tus datos obligatorios")) {
        alert(error.message);
      }
    },
  });

  const loading = meQuery.isLoading || movimientosQuery.isLoading;
  const me = meQuery.data;
  const movimientos = movimientosQuery.data ?? [];
  const MOVIMIENTOS_PER_PAGE = 3;

  const movimientosTotalPages = Math.max(1, Math.ceil(movimientos.length / MOVIMIENTOS_PER_PAGE));
  const movimientosPaginaActual = useMemo(() => {
    const currentPage = Math.min(movimientosPage, movimientosTotalPages);
    const start = (currentPage - 1) * MOVIMIENTOS_PER_PAGE;
    return movimientos.slice(start, start + MOVIMIENTOS_PER_PAGE);
  }, [movimientos, movimientosPage, movimientosTotalPages]);

  useEffect(() => {
    document.body.classList.add("catalogo-background");
    return () => {
      document.body.classList.remove("catalogo-background");
    };
  }, []);

  useEffect(() => {
    if (window.location.hash !== "#canjear-codigo") return;
    window.setTimeout(() => {
      canjearCodigoRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }, []);

  useEffect(() => {
    setMovimientosPage(1);
  }, [movimientos.length]);

  return (
    <section className="dashboard-section puntos-dashboard-section">
      <h1 className="ios-title mb-4">Puntos</h1>

      <div className="puntos-top-grid">
        <div className="ios-card p-6 text-center" style={{ borderTop: "4px solid #D4621A" }}>
          <p className="text-sm font-medium" style={{ color: "#A08060" }}>
            Saldo actual
          </p>
          <p className="text-5xl font-bold tracking-tight mt-2" style={{ color: "#D4621A" }}>
            {loading ? "-" : me?.puntos_saldo ?? 0}
          </p>
          <p className="text-xs mt-1" style={{ color: "#A08060" }}>
            puntos
          </p>
          {me ? (
            <p className="text-xs mt-3" style={{ color: "#A08060" }}>
              DNI {me.dni || "pendiente"}
            </p>
          ) : null}
        </div>

        <div className="ios-card p-5" style={{ borderLeft: "4px solid #D4621A" }}>
          <p ref={canjearCodigoRef} id="canjear-codigo" className="ios-label" style={{ paddingLeft: 0, scrollMarginTop: "84px" }}>
            Codigo promocional
          </p>
          <p className="text-sm mb-3" style={{ color: "#6b7280" }}>
            Ingresa un codigo para acreditar puntos en tu cuenta.
          </p>

          <div style={{ display: "flex", gap: "0.6rem" }}>
            <input
              type="text"
              className="ios-input"
              style={{ textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, flex: 1 }}
              placeholder="Ej: VERANO24"
              value={codigoInput}
              onChange={(event) => setCodigoInput(event.target.value.toUpperCase())}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  const codigo = codigoInput.trim();
                  if (!codigo) return;
                  canjearCodigoMutation.mutate(codigo);
                }
              }}
              disabled={canjearCodigoMutation.isPending}
            />

            <button
              className="ios-btn-primary"
              style={{ width: "auto", padding: "0 1.25rem", borderRadius: "12px", fontSize: "0.9rem", whiteSpace: "nowrap" }}
              disabled={canjearCodigoMutation.isPending || !codigoInput.trim()}
              onClick={() => canjearCodigoMutation.mutate(codigoInput.trim())}
            >
              {canjearCodigoMutation.isPending ? "..." : "Canjear"}
            </button>
          </div>

          {codigoOk ? (
            <div className="status-ok-box">
              <p>{codigoOk}</p>
            </div>
          ) : null}

          {codigoError ? (
            <div className="status-err-box">
              <p>{codigoError}</p>
            </div>
          ) : null}
        </div>
      </div>

      <p className="ios-label mt-8">Movimientos</p>
      <div className="ios-card ios-list">
        {loading ? <div className="ios-row text-sm status-muted">Cargando...</div> : null}
        {!loading && movimientos.length === 0 ? <div className="ios-row text-sm status-muted">Aun no tienes movimientos.</div> : null}

        {movimientosPaginaActual.map((movimiento) => (
          <div key={movimiento.id} className="px-4 py-3">
            <div className="flex items-center justify-between">
              <p className="text-base font-medium" style={{ color: movimiento.puntos >= 0 ? "#D4621A" : "#ef4444" }}>
                {movimiento.puntos >= 0 ? "+" : ""}
                {movimiento.puntos} pts
              </p>
              <time className="text-xs" style={{ color: "#A08060" }}>
                {formatDate(movimiento.created_at)}
              </time>
            </div>
            <p className="text-xs mt-0.5" style={{ color: "#A08060" }}>
              {movimiento.descripcion || movimiento.tipo}
            </p>
          </div>
        ))}
      </div>

      {!loading && movimientos.length > 0 ? (
        <div className="puntos-pagination">
          <button
            className="puntos-page-btn"
            disabled={movimientosPage <= 1}
            onClick={() => setMovimientosPage((prev) => Math.max(prev - 1, 1))}
          >
            Anterior
          </button>
          <span className="puntos-page-label">
            Pagina {Math.min(movimientosPage, movimientosTotalPages)} de {movimientosTotalPages}
          </span>
          <button
            className="puntos-page-btn"
            disabled={movimientosPage >= movimientosTotalPages}
            onClick={() => setMovimientosPage((prev) => Math.min(prev + 1, movimientosTotalPages))}
          >
            Siguiente
          </button>
        </div>
      ) : null}
    </section>
  );
}
