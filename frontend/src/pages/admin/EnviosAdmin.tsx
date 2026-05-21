import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../../api";
import { formatBuenosAiresDate } from "../../lib/dateTime";
import { useAuthStore } from "../../store/authStore";
import type { ShippingPolygonGeoJson, ShippingZone, ShippingZonePayload } from "../../types";
import { AreaExplanation } from "./components/AreaExplanation";
import { ShippingZoneMapEditor, type ZoneMapPoint } from "./components/ShippingZoneMapEditor";

type ZoneForm = {
  nombre: string;
  descripcion: string;
  precio: string;
  prioridad: string;
  color: string;
  activo: boolean;
  points: ZoneMapPoint[];
};

const LISTA_POR_PAGINA = 5;
const DEFAULT_ZONE_COLOR = "#6B8F71";
const ENVIOS_AREA_EXPLANATION = [
  "Aca se dibujan las zonas de reparto sobre el mapa y se define cuanto cuesta enviar a cada una.",
  "Si una direccion cae dentro de varias zonas, el checkout usa primero la de mayor prioridad.",
  "Desactivar una zona la saca de la cotizacion sin borrar el historial.",
];

function emptyZoneForm(): ZoneForm {
  return {
    nombre: "",
    descripcion: "",
    precio: "",
    prioridad: "0",
    color: DEFAULT_ZONE_COLOR,
    activo: true,
    points: [],
  };
}

function money(value: number | string | null | undefined): string {
  return Number(value || 0).toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  });
}

function samePoint(a: number[], b: number[]): boolean {
  return Math.abs(Number(a[0]) - Number(b[0])) < 0.0000001 && Math.abs(Number(a[1]) - Number(b[1])) < 0.0000001;
}

function pointsFromPolygon(polygon: ShippingPolygonGeoJson | null | undefined): ZoneMapPoint[] {
  const ring = polygon?.coordinates?.[0] ?? [];
  if (!ring.length) return [];
  const editableRing = ring.length > 1 && samePoint(ring[0], ring[ring.length - 1]) ? ring.slice(0, -1) : ring;
  return editableRing.map(([lng, lat]) => ({ lat: Number(lat), lng: Number(lng) }));
}

function polygonFromPoints(points: ZoneMapPoint[]): ShippingPolygonGeoJson {
  const ring = points.map((point) => [Number(point.lng.toFixed(7)), Number(point.lat.toFixed(7))]);
  if (ring.length) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (!samePoint(first, last)) {
      ring.push([first[0], first[1]]);
    }
  }
  return {
    type: "Polygon",
    coordinates: [ring],
  };
}

function formFromZone(zone: ShippingZone): ZoneForm {
  return {
    nombre: zone.nombre,
    descripcion: zone.descripcion ?? "",
    precio: String(zone.precio ?? 0),
    prioridad: String(zone.prioridad ?? 0),
    color: zone.color || DEFAULT_ZONE_COLOR,
    activo: zone.activo,
    points: pointsFromPolygon(zone.polygon_geojson),
  };
}

function PaginationControls({
  page,
  totalPages,
  onPrev,
  onNext,
}: {
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="admin-pagination">
      <button className="admin-page-btn" onClick={onPrev} disabled={page <= 1}>
        Anterior
      </button>
      <span className="admin-page-label">
        Pagina {page} de {totalPages}
      </span>
      <button className="admin-page-btn" onClick={onNext} disabled={page >= totalPages}>
        Siguiente
      </button>
    </div>
  );
}

export function EnviosAdmin() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const isVendedor = user?.rol === "vendedor";
  const isSuperAdmin = user?.rol === "superAdmin";
  const panelBasePath = isVendedor ? "/vendedor" : isSuperAdmin ? "/superadmin" : "/admin";
  const zonasApiBase = isVendedor ? "/vendedor/envio-zonas" : "/admin/envio-zonas";

  const [busy, setBusy] = useState(false);
  const [okMsg, setOkMsg] = useState("");
  const [errMsg, setErrMsg] = useState("");
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ZoneForm>(emptyZoneForm());

  const zonasQuery = useQuery({
    queryKey: ["staff", "envio-zonas", user?.rol],
    queryFn: () => api.get<ShippingZone[]>(zonasApiBase),
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
  });

  const commandMutation = useMutation({
    mutationFn: async ({
      method,
      path,
      body,
    }: {
      method: "post" | "put" | "patch";
      path: string;
      body?: unknown;
    }) => {
      if (method === "post") return api.post(path, body as Record<string, unknown>);
      if (method === "put") return api.put(path, body as Record<string, unknown>);
      return api.patch(path, body as Record<string, unknown>);
    },
  });

  const zonas = zonasQuery.data ?? [];
  const totalPages = Math.max(1, Math.ceil(zonas.length / LISTA_POR_PAGINA));
  const zonasPagina = useMemo(() => {
    const start = (page - 1) * LISTA_POR_PAGINA;
    return zonas.slice(start, start + LISTA_POR_PAGINA);
  }, [page, zonas]);

  async function refreshZonas() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["staff", "envio-zonas"] }),
      queryClient.invalidateQueries({ queryKey: ["cliente", "shipping-quote"] }),
    ]);
  }

  function buildPayload(): ShippingZonePayload | null {
    setErrMsg("");
    setOkMsg("");
    const nombre = form.nombre.trim();
    const precio = Number(form.precio);
    const prioridad = Number(form.prioridad || 0);
    if (!nombre) {
      setErrMsg("Completa el nombre de la zona.");
      return null;
    }
    if (!Number.isFinite(precio) || precio < 0) {
      setErrMsg("Carga un precio de envio valido.");
      return null;
    }
    if (!Number.isInteger(prioridad)) {
      setErrMsg("La prioridad debe ser un numero entero.");
      return null;
    }
    if (form.points.length < 3) {
      setErrMsg("Marca al menos 3 puntos en el mapa.");
      return null;
    }
    return {
      nombre,
      descripcion: form.descripcion.trim() || null,
      precio,
      prioridad,
      color: form.color || DEFAULT_ZONE_COLOR,
      activo: form.activo,
      polygon_geojson: polygonFromPoints(form.points),
    };
  }

  async function guardarZona() {
    const payload = buildPayload();
    if (!payload) return;
    setBusy(true);
    try {
      await commandMutation.mutateAsync({
        method: editingId ? "put" : "post",
        path: editingId ? `${zonasApiBase}/${editingId}` : zonasApiBase,
        body: payload,
      });
      setOkMsg(editingId ? "Zona actualizada." : "Zona creada.");
      setEditingId(null);
      setForm(emptyZoneForm());
      await refreshZonas();
    } catch (error) {
      setErrMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function editarZona(zone: ShippingZone) {
    setEditingId(zone.id);
    setForm(formFromZone(zone));
    setOkMsg("");
    setErrMsg("");
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  }

  async function toggleZonaActiva(zone: ShippingZone) {
    setErrMsg("");
    setOkMsg("");
    setBusy(true);
    try {
      await commandMutation.mutateAsync({
        method: "patch",
        path: `${zonasApiBase}/${zone.id}/activo`,
        body: { activo: !zone.activo },
      });
      setOkMsg(zone.activo ? "Zona desactivada." : "Zona activada.");
      await refreshZonas();
    } catch (error) {
      setErrMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-layout">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <p className="admin-brand-name">{isVendedor ? "Vendedor" : "Administrador"}</p>
          <p className="admin-brand-role">{isVendedor ? "Vendedor" : isSuperAdmin ? "SuperAdmin" : "Panel"}</p>
        </div>

        <nav className="admin-nav admin-nav-open">
          <span className="admin-nav-section">Navegacion</span>
          <button className="admin-nav-btn" onClick={() => navigate(panelBasePath)}>
            Volver al panel
          </button>
          {!isVendedor ? (
            <button className="admin-nav-btn" onClick={() => navigate(`${panelBasePath}/sucursales`)}>
              Sucursales
            </button>
          ) : null}
          <button className="admin-nav-btn active" onClick={() => navigate(`${panelBasePath}/envios`)}>
            Zonas de envio
          </button>
        </nav>
      </aside>

      <main className="admin-main">
        <div className="admin-topbar">
          <div className="admin-topbar-main">
            <h1 className="admin-topbar-title">Zonas de envio</h1>
            <p className="admin-topbar-sub">Precios por ubicacion para pedidos con envio a domicilio</p>
          </div>
          <div className="admin-topbar-actions">
            <div className="admin-topbar-date">{formatBuenosAiresDate(new Date())}</div>
          </div>
        </div>

        <div className="admin-content">
          {errMsg ? <div className="adm-msg-err" style={{ marginBottom: "1rem" }}>{errMsg}</div> : null}
          {okMsg ? <div className="adm-msg-ok" style={{ marginBottom: "1rem" }}>{okMsg}</div> : null}
          <AreaExplanation items={ENVIOS_AREA_EXPLANATION} />

          <div className="admin-section-header adm-config-header">
            <h2 className="admin-section-title">{editingId ? "Editar zona" : "Nueva zona"}</h2>
          </div>
          <div className="admin-card admin-card-padded shipping-zone-form">
            <div className="shipping-zone-form-grid">
              <input
                className="adm-input"
                placeholder="Nombre (ej: Corrientes centro)"
                value={form.nombre}
                onChange={(event) => setForm((prev) => ({ ...prev, nombre: event.target.value }))}
              />
              <input
                className="adm-input"
                type="number"
                min="0"
                step="1"
                placeholder="Precio"
                value={form.precio}
                onChange={(event) => setForm((prev) => ({ ...prev, precio: event.target.value }))}
              />
              <input
                className="adm-input"
                type="number"
                step="1"
                placeholder="Prioridad"
                value={form.prioridad}
                onChange={(event) => setForm((prev) => ({ ...prev, prioridad: event.target.value }))}
              />
              <label className="shipping-zone-color-field">
                <span>Color</span>
                <input
                  type="color"
                  value={form.color}
                  onChange={(event) => setForm((prev) => ({ ...prev, color: event.target.value }))}
                />
              </label>
            </div>
            <textarea
              className="adm-input"
              rows={2}
              placeholder="Descripcion interna (opcional)"
              value={form.descripcion}
              onChange={(event) => setForm((prev) => ({ ...prev, descripcion: event.target.value }))}
            />
            <label className="address-default-check shipping-zone-active-check">
              <input
                type="checkbox"
                checked={form.activo}
                onChange={(event) => setForm((prev) => ({ ...prev, activo: event.target.checked }))}
              />
              Zona activa
            </label>
            <ShippingZoneMapEditor
              points={form.points}
              onChange={(points) => setForm((prev) => ({ ...prev, points }))}
              color={form.color}
              disabled={busy}
            />
            <div className="adm-config-actions">
              <button className="adm-btn-primary adm-btn-inline" onClick={guardarZona} disabled={busy}>
                {busy ? "Guardando..." : editingId ? "Guardar cambios" : "Crear zona"}
              </button>
              {editingId ? (
                <button
                  className="adm-btn-secondary adm-btn-inline"
                  onClick={() => {
                    setEditingId(null);
                    setForm(emptyZoneForm());
                  }}
                  disabled={busy}
                >
                  Cancelar edicion
                </button>
              ) : null}
            </div>
          </div>

          <div className="admin-section-header adm-config-header">
            <h2 className="admin-section-title">Zonas configuradas</h2>
          </div>
          <div className="admin-card">
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Zona</th>
                    <th>Precio</th>
                    <th>Prioridad</th>
                    <th>Poligono</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {zonasQuery.isLoading ? (
                    <tr>
                      <td colSpan={6}>
                        <div className="adm-empty">Cargando zonas...</div>
                      </td>
                    </tr>
                  ) : null}
                  {!zonasQuery.isLoading && zonasPagina.length === 0 ? (
                    <tr>
                      <td colSpan={6}>
                        <div className="adm-empty">No hay zonas de envio registradas.</div>
                      </td>
                    </tr>
                  ) : null}
                  {zonasPagina.map((zone) => (
                    <Fragment key={zone.id}>
                      <tr>
                        <td>
                          <span className="shipping-zone-color-dot" style={{ backgroundColor: zone.color }} />
                          {zone.nombre}
                          {zone.descripcion ? <small className="shipping-zone-table-note">{zone.descripcion}</small> : null}
                        </td>
                        <td>{money(zone.precio)}</td>
                        <td>{zone.prioridad}</td>
                        <td>{Math.max(0, (zone.polygon_geojson.coordinates?.[0]?.length ?? 1) - 1)} puntos</td>
                        <td>{zone.activo ? "Activa" : "Inactiva"}</td>
                        <td>
                          <div className="adm-user-actions">
                            <button className="adm-btn-link" onClick={() => editarZona(zone)}>
                              Editar
                            </button>
                            <button
                              className={zone.activo ? "adm-btn-danger" : "adm-btn-success"}
                              onClick={() => toggleZonaActiva(zone)}
                              disabled={busy}
                            >
                              {zone.activo ? "Desactivar" : "Activar"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <PaginationControls
              page={page}
              totalPages={totalPages}
              onPrev={() => setPage((prev) => Math.max(1, prev - 1))}
              onNext={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            />
          </div>
        </div>
      </main>
    </section>
  );
}
