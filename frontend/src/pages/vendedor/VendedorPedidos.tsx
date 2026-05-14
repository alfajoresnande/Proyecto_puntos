import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";

type OrdenVendedor = {
  id: number;
  cliente_nombre: string;
  cliente_email: string;
  estado: "pendiente_pago" | "pagada" | "preparada" | "enviada" | "entregada" | "cancelada" | "expirada" | string;
  tipo_orden: "venta" | "mixta" | string;
  total_dinero: number;
  total_puntos: number;
  total_unidades: number;
  created_at: string;
  direccion_envio?: {
    nombre?: string;
    telefono?: string;
    direccion?: string;
    codigo_postal?: string;
    localidad?: string;
    provincia?: string;
    referencias?: string | null;
  } | null;
  sucursal?: {
    nombre: string | null;
    direccion: string | null;
    piso?: string | null;
    localidad: string | null;
    provincia: string | null;
  } | null;
  items?: Array<{
    producto_id: number;
    nombre: string;
    cantidad: number;
    modo_compra: "dinero" | "puntos";
    subtotal_dinero: number;
    subtotal_puntos: number;
  }>;
  pago?: {
    proveedor: string;
    metodo: string | null;
    estado: string;
    monto: number;
    moneda: string;
  } | null;
};

function money(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(Number.isFinite(n) ? n : 0);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function estadoOrdenLabel(estado: string): string {
  const labels: Record<string, string> = {
    pendiente_pago: "Pendiente pago",
    pagada: "Pagada",
    preparada: "Preparada",
    enviada: "Enviada",
    entregada: "Entregada",
    cancelada: "Cancelada",
    expirada: "Expirada",
  };
  return labels[estado] ?? estado.replace(/_/g, " ");
}

function pagoLabel(pago: OrdenVendedor["pago"]): string {
  if (!pago) return "Sin pago";
  const metodo = pago.metodo === "cash" ? "Efectivo" : pago.metodo === "brick" ? "Tarjeta" : pago.metodo === "qr" ? "QR" : pago.metodo || pago.proveedor;
  const estado = pago.estado === "iniciado" ? "pendiente" : pago.estado;
  return `${metodo} / ${estado}`;
}

export function VendedorPedidos() {
  const queryClient = useQueryClient();
  const [busquedaOrdenes, setBusquedaOrdenes] = useState("");
  const [filtroEstadoOrden, setFiltroEstadoOrden] = useState("");
  const [ordenExpandidaId, setOrdenExpandidaId] = useState<number | null>(null);
  const [ordenMsg, setOrdenMsg] = useState("");
  const [ordenErr, setOrdenErr] = useState("");

  const ordenesQuery = useQuery({
    queryKey: ["vendedor", "ordenes"],
    queryFn: () => api.get<OrdenVendedor[]>("/vendedor/ordenes"),
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
  });

  const ordenes = ordenesQuery.data ?? [];
  const ordenesFiltradas = useMemo(() => {
    const q = busquedaOrdenes.trim().toLowerCase();
    return ordenes.filter((orden) => {
      if (filtroEstadoOrden && orden.estado !== filtroEstadoOrden) return false;
      if (!q) return true;
      return [
        String(orden.id),
        orden.cliente_nombre,
        orden.cliente_email,
        orden.estado,
        pagoLabel(orden.pago),
        orden.sucursal?.nombre ?? "",
        orden.direccion_envio?.localidad ?? "",
      ].some((value) => value.toLowerCase().includes(q));
    });
  }, [busquedaOrdenes, filtroEstadoOrden, ordenes]);

  const actualizarOrdenMutation = useMutation({
    mutationFn: ({ id, estado }: { id: number; estado: "pagada" | "preparada" | "enviada" | "entregada" }) =>
      api.patch<{ ok: true }>(`/vendedor/ordenes/${id}`, { estado }),
    onSuccess: async (_data, variables) => {
      setOrdenErr("");
      setOrdenMsg(`Pedido #${variables.id} actualizado a ${estadoOrdenLabel(variables.estado)}.`);
      await queryClient.invalidateQueries({ queryKey: ["vendedor", "ordenes"] });
    },
    onError: (err: Error) => {
      setOrdenMsg("");
      setOrdenErr(err.message || "No se pudo actualizar el pedido.");
    },
  });

  function puedeMarcarPagada(orden: OrdenVendedor): boolean {
    return orden.estado === "pendiente_pago" && (orden.pago?.proveedor === "efectivo" || orden.pago?.metodo === "cash");
  }

  function actualizarOrden(id: number, estado: "pagada" | "preparada" | "enviada" | "entregada") {
    setOrdenErr("");
    setOrdenMsg("");
    actualizarOrdenMutation.mutate({ id, estado });
  }

  return (
    <section className="dashboard-section vendedor-dashboard-section">
      <div className="ios-card p-4" style={{ borderLeft: "4px solid #D4621A" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "flex-start", flexWrap: "wrap" }}>
          <div>
            <h1 className="ios-title" style={{ marginBottom: "0.25rem" }}>Pedidos</h1>
            <p className="text-sm" style={{ color: "#6b7280" }}>
              Gestiona pedidos pagados, preparacion, envio y entrega.
            </p>
          </div>
          <button
            type="button"
            className="ios-btn-secondary"
            style={{ width: "auto", padding: "0.65rem 1rem" }}
            onClick={() => void queryClient.invalidateQueries({ queryKey: ["vendedor", "ordenes"] })}
          >
            Actualizar
          </button>
        </div>

        <div className="adm-form-grid" style={{ marginTop: "1rem" }}>
          <input
            className="ios-input"
            placeholder="Buscar por cliente, orden, pago o sucursal..."
            value={busquedaOrdenes}
            onChange={(event) => setBusquedaOrdenes(event.target.value)}
          />
          <select className="ios-input" value={filtroEstadoOrden} onChange={(event) => setFiltroEstadoOrden(event.target.value)}>
            <option value="">Todos los estados</option>
            <option value="pendiente_pago">Pendiente pago</option>
            <option value="pagada">Pagada</option>
            <option value="preparada">Preparada</option>
            <option value="enviada">Enviada</option>
            <option value="entregada">Entregada</option>
          </select>
        </div>

        {ordenErr ? <div className="status-err-box mt-3"><p>{ordenErr}</p></div> : null}
        {ordenMsg ? <div className="status-ok-box mt-3"><p>{ordenMsg}</p></div> : null}

        <div style={{ display: "grid", gap: "0.75rem", marginTop: "1rem" }}>
          {ordenesQuery.isLoading ? <div className="ios-row text-ios-secondary text-sm">Cargando pedidos...</div> : null}
          {!ordenesQuery.isLoading && ordenesFiltradas.length === 0 ? (
            <div className="ios-row text-ios-secondary text-sm">No hay pedidos para mostrar.</div>
          ) : null}
          {ordenesFiltradas.map((orden) => (
            <div key={orden.id} className="ios-card p-4" style={{ background: "#FFF8F1" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                <div>
                  <p className="text-base font-bold" style={{ color: "#3D1A02", margin: 0 }}>
                    Pedido #{orden.id} - {estadoOrdenLabel(orden.estado)}
                  </p>
                  <p className="text-xs" style={{ color: "#A08060", margin: "0.15rem 0 0" }}>
                    {formatDate(orden.created_at)} - {orden.cliente_nombre} - {orden.total_unidades} unidad(es)
                  </p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p className="text-base font-bold" style={{ margin: 0 }}>{money(orden.total_dinero)}</p>
                  <p className="text-xs" style={{ color: "#A08060", margin: "0.15rem 0 0" }}>{pagoLabel(orden.pago)}</p>
                </div>
              </div>

              <div className="mt-3" style={{ display: "grid", gap: "0.25rem" }}>
                <p className="text-sm" style={{ margin: 0 }}>
                  <strong>{orden.direccion_envio ? "Envio:" : "Retiro:"}</strong>{" "}
                  {orden.direccion_envio
                    ? `${orden.direccion_envio.direccion || "-"}, ${orden.direccion_envio.localidad || "-"} (${orden.direccion_envio.codigo_postal || "s/CP"})`
                    : `${orden.sucursal?.nombre || "-"}${orden.sucursal?.direccion ? ` - ${orden.sucursal.direccion}` : ""}`}
                </p>
                {orden.direccion_envio?.telefono ? (
                  <p className="text-sm" style={{ margin: 0 }}><strong>Telefono:</strong> {orden.direccion_envio.telefono}</p>
                ) : null}
              </div>

              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.85rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="ios-btn-secondary"
                  style={{ width: "auto", padding: "0.55rem 0.85rem" }}
                  onClick={() => setOrdenExpandidaId((prev) => prev === orden.id ? null : orden.id)}
                >
                  {ordenExpandidaId === orden.id ? "Ocultar detalle" : "Ver detalle"}
                </button>
                <Link
                  to={`/vendedor/pedidos/${orden.id}`}
                  className="ios-btn-secondary"
                  style={{ width: "auto", padding: "0.55rem 0.85rem", textDecoration: "none" }}
                >
                  Ver comprobante
                </Link>
                {puedeMarcarPagada(orden) ? (
                  <button type="button" className="ios-btn-primary" style={{ width: "auto", padding: "0.55rem 0.85rem" }} disabled={actualizarOrdenMutation.isPending} onClick={() => actualizarOrden(orden.id, "pagada")}>
                    Cobrado
                  </button>
                ) : null}
                {orden.estado === "pagada" ? (
                  <button type="button" className="ios-btn-primary" style={{ width: "auto", padding: "0.55rem 0.85rem" }} disabled={actualizarOrdenMutation.isPending} onClick={() => actualizarOrden(orden.id, "preparada")}>
                    Preparar
                  </button>
                ) : null}
                {(orden.estado === "pagada" || orden.estado === "preparada") && orden.direccion_envio ? (
                  <button type="button" className="ios-btn-primary" style={{ width: "auto", padding: "0.55rem 0.85rem" }} disabled={actualizarOrdenMutation.isPending} onClick={() => actualizarOrden(orden.id, "enviada")}>
                    Enviar
                  </button>
                ) : null}
                {orden.estado === "pagada" || orden.estado === "preparada" || orden.estado === "enviada" ? (
                  <button type="button" className="ios-btn-primary" style={{ width: "auto", padding: "0.55rem 0.85rem", background: "#16a34a", borderColor: "#16a34a" }} disabled={actualizarOrdenMutation.isPending} onClick={() => actualizarOrden(orden.id, "entregada")}>
                    Entregar
                  </button>
                ) : null}
              </div>

              {ordenExpandidaId === orden.id ? (
                <div className="mt-3 rounded-xl p-3" style={{ background: "#FEF3E8", border: "1px solid #F5C8A8" }}>
                  <p className="text-xs uppercase font-bold tracking-wider mb-2" style={{ color: "#A08060" }}>Productos</p>
                  {(orden.items ?? []).map((item) => (
                    <p key={`${orden.id}-${item.producto_id}-${item.modo_compra}`} className="text-sm" style={{ margin: "0.15rem 0" }}>
                      {item.nombre} x{item.cantidad} - {item.modo_compra === "dinero" ? money(item.subtotal_dinero) : `${item.subtotal_puntos} pts`}
                    </p>
                  ))}
                  {orden.direccion_envio?.referencias ? (
                    <p className="text-sm mt-2" style={{ marginBottom: 0 }}><strong>Referencias:</strong> {orden.direccion_envio.referencias}</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
