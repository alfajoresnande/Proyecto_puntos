import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";

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
  productos_detalle?: string;
  total_items?: number;
  total_unidades?: number;
  items?: Array<{
    producto_id: number;
    producto_nombre: string;
    producto_imagen: string | null;
    cantidad: number;
    puntos_unitarios: number;
    puntos_total: number;
  }>;
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

export function MisCanjes() {
  const [canjeFilter, setCanjeFilter] = useState<CanjeFilter>("todos");
  const [canjePage, setCanjePage] = useState(1);

  const canjesQuery = useQuery({
    queryKey: ["cliente", "canjes"],
    queryFn: () => api.get<Canje[]>("/cliente/canjes"),
  });

  const canjes = canjesQuery.data ?? [];

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

  return (
    <section className="dashboard-section perfil-dashboard-section">
      <h1 className="ios-title mb-4">Mis canjes</h1>

      <div id="mis-canjes" className="ios-card p-5" style={{ borderLeft: "4px solid #D4621A", scrollMarginTop: "84px" }}>
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
                  {canje.items && canje.items.length > 1 ? (
                    <p className="text-[11px] mt-1" style={{ color: "#A08060" }}>
                      {canje.items.map((item) => `${item.producto_nombre} x${item.cantidad}`).join(" | ")}
                    </p>
                  ) : null}
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
