import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../../api";
import { formatBuenosAiresDate } from "../../lib/dateTime";
import { useAuthStore } from "../../store/authStore";

type SucursalAdmin = {
  id: number;
  nombre: string;
  direccion: string;
  piso: string | null;
  localidad: string;
  provincia: string;
  activo: boolean;
  created_at: string;
  updated_at: string;
};

type SucursalForm = {
  nombre: string;
  direccion: string;
  piso: string;
  localidad: string;
  provincia: string;
};

const LISTA_POR_PAGINA = 5;

function emptySucursalForm(): SucursalForm {
  return {
    nombre: "",
    direccion: "",
    piso: "",
    localidad: "",
    provincia: "",
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

export function SucursalesAdmin() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const isSuperAdmin = user?.rol === "superAdmin";
  const panelBasePath = isSuperAdmin ? "/superadmin" : "/admin";

  const [busy, setBusy] = useState(false);
  const [okMsg, setOkMsg] = useState("");
  const [errMsg, setErrMsg] = useState("");
  const [page, setPage] = useState(1);
  const [nuevaSucursal, setNuevaSucursal] = useState<SucursalForm>(emptySucursalForm());
  const [editSucursalId, setEditSucursalId] = useState<number | null>(null);
  const [editSucursalDraft, setEditSucursalDraft] = useState<SucursalForm>(emptySucursalForm());

  const sucursalesQuery = useQuery({
    queryKey: ["admin", "sucursales"],
    queryFn: () => api.get<SucursalAdmin[]>("/admin/sucursales"),
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

  const sucursales = sucursalesQuery.data ?? [];
  const totalPages = Math.max(1, Math.ceil(sucursales.length / LISTA_POR_PAGINA));
  const sucursalesPagina = useMemo(() => {
    const start = (page - 1) * LISTA_POR_PAGINA;
    return sucursales.slice(start, start + LISTA_POR_PAGINA);
  }, [page, sucursales]);

  async function refreshSucursales() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin", "sucursales"] }),
      queryClient.invalidateQueries({ queryKey: ["admin", "canjes"] }),
      queryClient.invalidateQueries({ queryKey: ["admin", "inventario"] }),
    ]);
  }

  function iniciarEdicionSucursal(sucursal: SucursalAdmin) {
    setEditSucursalId(sucursal.id);
    setEditSucursalDraft({
      nombre: sucursal.nombre,
      direccion: sucursal.direccion,
      piso: sucursal.piso || "",
      localidad: sucursal.localidad,
      provincia: sucursal.provincia,
    });
  }

  async function crearSucursal() {
    setErrMsg("");
    setOkMsg("");
    if (!nuevaSucursal.nombre.trim() || !nuevaSucursal.direccion.trim() || !nuevaSucursal.localidad.trim() || !nuevaSucursal.provincia.trim()) {
      setErrMsg("Completa nombre, direccion, localidad y provincia para crear la sucursal.");
      return;
    }

    setBusy(true);
    try {
      await commandMutation.mutateAsync({
        method: "post",
        path: "/admin/sucursales",
        body: {
          nombre: nuevaSucursal.nombre.trim(),
          direccion: nuevaSucursal.direccion.trim(),
          piso: nuevaSucursal.piso.trim() || null,
          localidad: nuevaSucursal.localidad.trim(),
          provincia: nuevaSucursal.provincia.trim(),
        },
      });
      setNuevaSucursal(emptySucursalForm());
      setOkMsg("Sucursal creada.");
      await refreshSucursales();
    } catch (error) {
      setErrMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function guardarEdicionSucursal(sucursalId: number) {
    setErrMsg("");
    setOkMsg("");
    if (!editSucursalDraft.nombre.trim() || !editSucursalDraft.direccion.trim() || !editSucursalDraft.localidad.trim() || !editSucursalDraft.provincia.trim()) {
      setErrMsg("Completa nombre, direccion, localidad y provincia para guardar la sucursal.");
      return;
    }

    setBusy(true);
    try {
      await commandMutation.mutateAsync({
        method: "put",
        path: `/admin/sucursales/${sucursalId}`,
        body: {
          nombre: editSucursalDraft.nombre.trim(),
          direccion: editSucursalDraft.direccion.trim(),
          piso: editSucursalDraft.piso.trim() || null,
          localidad: editSucursalDraft.localidad.trim(),
          provincia: editSucursalDraft.provincia.trim(),
        },
      });
      setEditSucursalId(null);
      setOkMsg("Sucursal actualizada.");
      await refreshSucursales();
    } catch (error) {
      setErrMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleSucursalActiva(sucursal: SucursalAdmin) {
    setErrMsg("");
    setOkMsg("");
    setBusy(true);
    try {
      await commandMutation.mutateAsync({
        method: "patch",
        path: `/admin/sucursales/${sucursal.id}/activo`,
        body: { activo: !sucursal.activo },
      });
      setOkMsg(sucursal.activo ? "Sucursal desactivada." : "Sucursal activada.");
      await refreshSucursales();
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
          <p className="admin-brand-name">Administrador</p>
          <p className="admin-brand-role">{isSuperAdmin ? "SuperAdmin" : "Panel"}</p>
        </div>

        <nav className="admin-nav admin-nav-open">
          <span className="admin-nav-section">Navegacion</span>
          <button className="admin-nav-btn" onClick={() => navigate(panelBasePath)}>
            Volver al panel
          </button>
          <button className="admin-nav-btn active" onClick={() => navigate(`${panelBasePath}/sucursales`)}>
            Sucursales
          </button>
        </nav>
      </aside>

      <main className="admin-main">
        <div className="admin-topbar">
          <div className="admin-topbar-main">
            <h1 className="admin-topbar-title">Panel de sucursales</h1>
            <p className="admin-topbar-sub">
              {isSuperAdmin ? "Gestion de sucursales dentro del panel SuperAdmin" : "Gestion independiente de puntos de retiro y stock por local"}
            </p>
          </div>
          <div className="admin-topbar-actions">
            <div className="admin-topbar-date">{formatBuenosAiresDate(new Date())}</div>
          </div>
        </div>

        <div className="admin-content">
          {errMsg ? <div className="adm-msg-err" style={{ marginBottom: "1rem" }}>{errMsg}</div> : null}
          {okMsg ? <div className="adm-msg-ok" style={{ marginBottom: "1rem" }}>{okMsg}</div> : null}

          <div className="admin-section-header adm-config-header">
            <h2 className="admin-section-title">Alta de sucursal</h2>
          </div>
          <div className="admin-card admin-card-padded" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <p className="adm-config-subtitle">Estas sucursales se muestran al cliente para elegir donde retirar sus canjes y pedidos.</p>
            <div className="adm-form-grid">
              <input
                className="adm-input"
                placeholder="Nombre (ej: Sucursal Centro)"
                value={nuevaSucursal.nombre}
                onChange={(event) => setNuevaSucursal((prev) => ({ ...prev, nombre: event.target.value }))}
              />
              <input
                className="adm-input"
                placeholder="Direccion (ej: Corrientes 1234)"
                value={nuevaSucursal.direccion}
                onChange={(event) => setNuevaSucursal((prev) => ({ ...prev, direccion: event.target.value }))}
              />
            </div>
            <div className="adm-form-grid">
              <input
                className="adm-input"
                placeholder="Piso (opcional)"
                value={nuevaSucursal.piso}
                onChange={(event) => setNuevaSucursal((prev) => ({ ...prev, piso: event.target.value }))}
              />
              <input
                className="adm-input"
                placeholder="Localidad"
                value={nuevaSucursal.localidad}
                onChange={(event) => setNuevaSucursal((prev) => ({ ...prev, localidad: event.target.value }))}
              />
            </div>
            <input
              className="adm-input"
              placeholder="Provincia"
              value={nuevaSucursal.provincia}
              onChange={(event) => setNuevaSucursal((prev) => ({ ...prev, provincia: event.target.value }))}
            />
            <button className="adm-btn-primary adm-btn-inline" onClick={crearSucursal} disabled={busy}>
              {busy ? "Guardando..." : "Agregar sucursal"}
            </button>
          </div>

          <div className="admin-section-header adm-config-header">
            <h2 className="admin-section-title">Tabla de sucursales de retiro</h2>
          </div>
          <div className="admin-card">
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Direccion</th>
                    <th>Piso</th>
                    <th>Localidad</th>
                    <th>Provincia</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {sucursalesQuery.isLoading ? (
                    <tr>
                      <td colSpan={7}>
                        <div className="adm-empty">Cargando sucursales...</div>
                      </td>
                    </tr>
                  ) : null}
                  {!sucursalesQuery.isLoading && sucursalesPagina.length === 0 ? (
                    <tr>
                      <td colSpan={7}>
                        <div className="adm-empty">No hay sucursales registradas.</div>
                      </td>
                    </tr>
                  ) : null}
                  {sucursalesPagina.map((sucursal) => (
                    <Fragment key={sucursal.id}>
                      <tr>
                        <td>{sucursal.nombre}</td>
                        <td>{sucursal.direccion}</td>
                        <td>{sucursal.piso || "-"}</td>
                        <td>{sucursal.localidad}</td>
                        <td>{sucursal.provincia}</td>
                        <td>{sucursal.activo ? "Activa" : "Inactiva"}</td>
                        <td>
                          <div className="adm-user-actions">
                            <button className="adm-btn-link" onClick={() => iniciarEdicionSucursal(sucursal)}>
                              Editar
                            </button>
                            <button
                              className={sucursal.activo ? "adm-btn-danger" : "adm-btn-success"}
                              onClick={() => toggleSucursalActiva(sucursal)}
                            >
                              {sucursal.activo ? "Desactivar" : "Activar"}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {editSucursalId === sucursal.id ? (
                        <tr>
                          <td colSpan={7}>
                            <div className="adm-inline-points-box">
                              <div className="adm-form-grid">
                                <input
                                  className="adm-input"
                                  placeholder="Nombre"
                                  value={editSucursalDraft.nombre}
                                  onChange={(event) => setEditSucursalDraft((prev) => ({ ...prev, nombre: event.target.value }))}
                                />
                                <input
                                  className="adm-input"
                                  placeholder="Direccion"
                                  value={editSucursalDraft.direccion}
                                  onChange={(event) => setEditSucursalDraft((prev) => ({ ...prev, direccion: event.target.value }))}
                                />
                              </div>
                              <div className="adm-form-grid" style={{ marginTop: "0.55rem" }}>
                                <input
                                  className="adm-input"
                                  placeholder="Piso (opcional)"
                                  value={editSucursalDraft.piso}
                                  onChange={(event) => setEditSucursalDraft((prev) => ({ ...prev, piso: event.target.value }))}
                                />
                                <input
                                  className="adm-input"
                                  placeholder="Localidad"
                                  value={editSucursalDraft.localidad}
                                  onChange={(event) => setEditSucursalDraft((prev) => ({ ...prev, localidad: event.target.value }))}
                                />
                              </div>
                              <input
                                className="adm-input"
                                style={{ marginTop: "0.55rem" }}
                                placeholder="Provincia"
                                value={editSucursalDraft.provincia}
                                onChange={(event) => setEditSucursalDraft((prev) => ({ ...prev, provincia: event.target.value }))}
                              />
                              <div className="adm-inline-points-actions">
                                <button className="adm-btn-primary adm-btn-inline" onClick={() => guardarEdicionSucursal(sucursal.id)} disabled={busy}>
                                  {busy ? "Guardando..." : "Guardar cambios"}
                                </button>
                                <button className="adm-btn-secondary adm-btn-inline" onClick={() => setEditSucursalId(null)}>
                                  Cancelar
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
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
