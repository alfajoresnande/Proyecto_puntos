import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import type { Producto } from "../../types";

type ClienteBuscado = {
  id: number;
  nombre: string;
  dni: string;
  email: string;
  puntos: number;
};

type SucursalPublica = {
  id: number;
  nombre: string;
  direccion: string;
  piso?: string | null;
  localidad: string;
  provincia: string;
};

type VentaLocalItemDraft = {
  producto_id: number;
  nombre: string;
  cantidad: number;
  precio_dinero: number;
  sabores?: Array<{
    sabor_id: number;
    nombre: string;
    cantidad: number;
  }>;
};

type OrdenVendedor = {
  id: number;
  canal: "web" | "admin" | "vendedor";
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
    sabores?: Array<{
      sabor_id: number;
      nombre: string;
      cantidad: number;
    }>;
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

function canalLabel(canal: string): string {
  const labels: Record<string, string> = {
    web: "Web",
    admin: "Local admin",
    vendedor: "Local vendedor",
  };
  return labels[canal] ?? canal;
}

function metodoPagoLabel(metodo?: string | null): string {
  const labels: Record<string, string> = {
    cash: "Efectivo",
    transferencia: "Transferencia",
    tarjeta: "Tarjeta",
    qr: "QR",
    otro: "Otro",
  };
  return metodo ? labels[metodo] ?? metodo : "";
}

function pagoLabel(pago: OrdenVendedor["pago"]): string {
  if (!pago) return "Sin pago";
  const metodo = pago.proveedor === "local"
    ? metodoPagoLabel(pago.metodo)
    : pago.metodo === "cash" ? "Efectivo" : pago.metodo === "brick" ? "Tarjeta" : pago.metodo === "qr" ? "QR" : pago.metodo || pago.proveedor;
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
  const [ventaClienteQuery, setVentaClienteQuery] = useState("");
  const [ventaCliente, setVentaCliente] = useState<ClienteBuscado | null>(null);
  const [ventaSucursalId, setVentaSucursalId] = useState("");
  const [ventaMetodoPago, setVentaMetodoPago] = useState("cash");
  const [ventaAcreditarPuntos, setVentaAcreditarPuntos] = useState(false);
  const [ventaProductoId, setVentaProductoId] = useState("");
  const [ventaCantidad, setVentaCantidad] = useState("1");
  const [ventaSabores, setVentaSabores] = useState<Record<string, number>>({});
  const [ventaItems, setVentaItems] = useState<VentaLocalItemDraft[]>([]);
  const [ventaNotas, setVentaNotas] = useState("");

  const ordenesQuery = useQuery({
    queryKey: ["vendedor", "ordenes"],
    queryFn: () => api.get<OrdenVendedor[]>("/vendedor/ordenes"),
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
  });

  const productosLocalesQuery = useQuery({
    queryKey: ["vendedor", "productos-locales"],
    queryFn: () => api.get<Producto[]>("/vendedor/productos-locales"),
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
  });

  const sucursalesQuery = useQuery({
    queryKey: ["productos", "sucursales"],
    queryFn: () => api.get<SucursalPublica[]>("/productos/sucursales"),
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
  });

  const clientesQuery = useQuery({
    queryKey: ["vendedor", "clientes-locales", ventaClienteQuery.trim()],
    queryFn: () => api.get<ClienteBuscado[]>(`/vendedor/clientes/buscar?q=${encodeURIComponent(ventaClienteQuery.trim())}`),
    enabled: ventaClienteQuery.trim().length >= 2 && !ventaCliente,
  });

  const ordenes = ordenesQuery.data ?? [];
  const productosLocales = productosLocalesQuery.data ?? [];
  const sucursales = sucursalesQuery.data ?? [];
  const clientesEncontrados = clientesQuery.data ?? [];
  const productoVentaSeleccionado = useMemo(
    () => productosLocales.find((producto) => Number(producto.id) === Number(ventaProductoId)) ?? null,
    [productosLocales, ventaProductoId],
  );
  const saboresProductoVenta = useMemo(
    () => productoVentaSeleccionado?.configuracion_tipo === "caja_sabores" ? productoVentaSeleccionado.sabores ?? [] : [],
    [productoVentaSeleccionado],
  );
  const totalSaboresVenta = useMemo(
    () => Object.values(ventaSabores).reduce((acc, value) => acc + (Number(value) || 0), 0),
    [ventaSabores],
  );
  const totalVentaLocal = useMemo(
    () => ventaItems.reduce((acc, item) => acc + item.precio_dinero * item.cantidad, 0),
    [ventaItems],
  );
  const ordenesFiltradas = useMemo(() => {
    const q = busquedaOrdenes.trim().toLowerCase();
    return ordenes.filter((orden) => {
      if (filtroEstadoOrden && orden.estado !== filtroEstadoOrden) return false;
      if (!q) return true;
      return [
        String(orden.id),
        orden.cliente_nombre,
        orden.cliente_email,
        orden.canal,
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

  const registrarVentaLocalMutation = useMutation({
    mutationFn: () => {
      if (!ventaCliente) throw new Error("Selecciona un cliente para registrar la venta local.");
      if (!ventaSucursalId) throw new Error("Selecciona una sucursal.");
      if (!ventaItems.length) throw new Error("Agrega al menos un producto.");

      return api.post<{ ok: true; ordenId: number }>("/vendedor/ventas-locales", {
        usuario_id: ventaCliente.id,
        sucursal_id: Number(ventaSucursalId),
        metodo_pago: ventaMetodoPago,
        acreditar_puntos: ventaAcreditarPuntos,
        notas: ventaNotas.trim() || undefined,
        items: ventaItems.map((item) => ({
          producto_id: item.producto_id,
          cantidad: item.cantidad,
          sabores: item.sabores?.map((sabor) => ({
            sabor_id: sabor.sabor_id,
            cantidad: sabor.cantidad,
          })),
        })),
      });
    },
    onSuccess: async (data) => {
      setOrdenErr("");
      setOrdenMsg(`Venta local registrada como orden #${data.ordenId}. No se desconto stock web.`);
      setVentaItems([]);
      setVentaNotas("");
      await queryClient.invalidateQueries({ queryKey: ["vendedor", "ordenes"] });
    },
    onError: (err: Error) => {
      setOrdenMsg("");
      setOrdenErr(err.message || "No se pudo registrar la venta local.");
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

  function agregarItemVentaLocal() {
    setOrdenErr("");
    setOrdenMsg("");
    const producto = productoVentaSeleccionado;
    if (!producto) {
      setOrdenErr("Selecciona un producto.");
      return;
    }
    const cantidad = Number(ventaCantidad);
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      setOrdenErr("La cantidad debe ser un entero mayor a 0.");
      return;
    }

    const saboresItem = producto.configuracion_tipo === "caja_sabores"
      ? saboresProductoVenta
          .map((sabor) => ({
            sabor_id: sabor.id,
            nombre: sabor.nombre,
            cantidad: Number(ventaSabores[String(sabor.id)] ?? 0) || 0,
          }))
          .filter((sabor) => sabor.cantidad > 0)
      : [];
    if (producto.configuracion_tipo === "caja_sabores") {
      const capacidad = Number(producto.capacidad_sabores ?? 0);
      if (totalSaboresVenta !== capacidad) {
        setOrdenErr(`Selecciona exactamente ${capacidad} sabores para ${producto.nombre}.`);
        return;
      }
    }

    setVentaItems((prev) => [
      ...prev,
      {
        producto_id: producto.id,
        nombre: producto.nombre,
        cantidad,
        precio_dinero: Number(producto.precio_dinero ?? 0),
        sabores: saboresItem,
      },
    ]);
    setVentaProductoId("");
    setVentaCantidad("1");
    setVentaSabores({});
  }

  return (
    <section className="dashboard-section vendedor-dashboard-section">
      <div className="ios-card p-4" style={{ borderLeft: "4px solid #D4621A" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "flex-start", flexWrap: "wrap" }}>
          <div>
            <h1 className="ios-title" style={{ marginBottom: "0.25rem" }}>Compras y Pedidos</h1>
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

        <div className="ios-card p-4" style={{ marginTop: "1rem", background: "#FFF8F1", border: "1px solid #F5C8A8" }}>
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <div>
              <h2 className="text-base font-bold" style={{ color: "#3D1A02", margin: 0 }}>Registrar venta local</h2>
              <p className="text-xs" style={{ color: "#A08060", margin: "0.2rem 0 0" }}>
                Queda unida a las ventas web para reportes, pero no descuenta stock online.
              </p>
            </div>

            <div className="adm-form-grid">
              <div style={{ position: "relative" }}>
                <input
                  className="ios-input"
                  placeholder="Buscar cliente por nombre o DNI"
                  value={ventaCliente ? `${ventaCliente.nombre} - ${ventaCliente.dni}` : ventaClienteQuery}
                  onChange={(event) => {
                    setVentaCliente(null);
                    setVentaClienteQuery(event.target.value);
                  }}
                />
                {!ventaCliente && clientesEncontrados.length ? (
                  <div className="ios-card p-2" style={{ position: "absolute", zIndex: 5, width: "100%", marginTop: "0.25rem", display: "grid", gap: "0.35rem" }}>
                    {clientesEncontrados.map((cliente) => (
                      <button
                        key={cliente.id}
                        type="button"
                        className="ios-btn-secondary"
                        style={{ width: "100%", textAlign: "left", padding: "0.5rem 0.65rem" }}
                        onClick={() => {
                          setVentaCliente(cliente);
                          setVentaClienteQuery("");
                        }}
                      >
                        {cliente.nombre} - DNI {cliente.dni}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <select className="ios-input" value={ventaSucursalId} onChange={(event) => setVentaSucursalId(event.target.value)}>
                <option value="">Sucursal</option>
                {sucursales.map((sucursal) => (
                  <option key={sucursal.id} value={sucursal.id}>{sucursal.nombre}</option>
                ))}
              </select>
              <select className="ios-input" value={ventaMetodoPago} onChange={(event) => setVentaMetodoPago(event.target.value)}>
                <option value="cash">Efectivo</option>
                <option value="transferencia">Transferencia</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="qr">QR</option>
                <option value="otro">Otro</option>
              </select>
              <input className="ios-input" placeholder="Notas internas" value={ventaNotas} onChange={(event) => setVentaNotas(event.target.value)} />
            </div>
            <label className="text-sm" style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "#3D1A02", fontWeight: 700 }}>
              <input type="checkbox" checked={ventaAcreditarPuntos} onChange={(event) => setVentaAcreditarPuntos(event.target.checked)} />
              Acreditar puntos de compra al cliente
            </label>

            <div className="adm-form-grid">
              <select
                className="ios-input"
                value={ventaProductoId}
                onChange={(event) => {
                  setVentaProductoId(event.target.value);
                  setVentaSabores({});
                }}
              >
                <option value="">Producto</option>
                {productosLocales.map((producto) => (
                  <option key={producto.id} value={producto.id}>{producto.nombre} - {money(producto.precio_dinero)}</option>
                ))}
              </select>
              <input className="ios-input" type="number" min={1} value={ventaCantidad} onChange={(event) => setVentaCantidad(event.target.value)} />
              <button type="button" className="ios-btn-secondary" style={{ width: "auto" }} onClick={agregarItemVentaLocal}>
                Agregar
              </button>
            </div>

            {productoVentaSeleccionado?.configuracion_tipo === "caja_sabores" ? (
              <div className="rounded-xl p-3" style={{ background: "#FEF3E8", border: "1px solid #F5C8A8" }}>
                <p className="text-xs uppercase font-bold tracking-wider mb-2" style={{ color: "#A08060" }}>
                  Sabores {totalSaboresVenta}/{productoVentaSeleccionado.capacidad_sabores ?? 0} por caja
                </p>
                <div className="adm-form-grid">
                  {saboresProductoVenta.map((sabor) => (
                    <label key={sabor.id} className="text-sm" style={{ display: "grid", gap: "0.25rem", color: "#3D1A02", fontWeight: 700 }}>
                      {sabor.nombre}
                      <input
                        className="ios-input"
                        type="number"
                        min={0}
                        value={ventaSabores[String(sabor.id)] ?? 0}
                        onChange={(event) => {
                          const value = Math.max(0, Number(event.target.value) || 0);
                          setVentaSabores((prev) => ({ ...prev, [String(sabor.id)]: value }));
                        }}
                      />
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            <div style={{ display: "grid", gap: "0.5rem" }}>
              {ventaItems.length === 0 ? (
                <div className="ios-row text-ios-secondary text-sm">Sin productos agregados.</div>
              ) : null}
              {ventaItems.map((item, index) => (
                <div key={`${item.producto_id}-${index}`} className="ios-row" style={{ alignItems: "flex-start", gap: "0.75rem" }}>
                  <div style={{ flex: 1 }}>
                    <p className="text-sm font-bold" style={{ margin: 0 }}>{item.nombre} x{item.cantidad} - {money(item.precio_dinero * item.cantidad)}</p>
                    {item.sabores?.length ? (
                      <p className="text-xs" style={{ color: "#A08060", margin: "0.15rem 0 0" }}>
                        {item.sabores.map((sabor) => `${sabor.nombre} x${sabor.cantidad}`).join(" | ")}
                      </p>
                    ) : null}
                  </div>
                  <button type="button" className="ios-btn-secondary" style={{ width: "auto", padding: "0.45rem 0.7rem" }} onClick={() => setVentaItems((prev) => prev.filter((_item, itemIndex) => itemIndex !== index))}>
                    Quitar
                  </button>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
              <strong>Total: {money(totalVentaLocal)}</strong>
              <button
                type="button"
                className="ios-btn-primary"
                style={{ width: "auto", padding: "0.65rem 1rem" }}
                disabled={registrarVentaLocalMutation.isPending || ventaItems.length === 0}
                onClick={() => registrarVentaLocalMutation.mutate()}
              >
                {registrarVentaLocalMutation.isPending ? "Registrando..." : "Registrar venta local"}
              </button>
            </div>
          </div>
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
                    Pedido #{orden.id} - {estadoOrdenLabel(orden.estado)} - {canalLabel(orden.canal)}
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
                      {item.sabores?.length ? (
                        <span style={{ display: "block", color: "#A08060", fontSize: "0.8rem" }}>
                          {item.sabores.map((sabor) => `${sabor.nombre} x${sabor.cantidad}`).join(" | ")}
                        </span>
                      ) : null}
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
