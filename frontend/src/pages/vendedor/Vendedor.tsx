import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import type { Producto } from "../../types";

type ClienteBuscado = {
  id: number;
  nombre: string;
  dni: string;
  email: string;
  puntos: number;
};

type CargarResponse = {
  ok: boolean;
  cliente_id: number;
  puntos_acreditados: number;
  nuevo_saldo: number;
};

type CanjeInfo = {
  id: number;
  codigo_retiro: string;
  puntos_usados: number;
  estado: "pendiente" | "entregado" | "no_disponible" | "expirado" | "cancelado";
  fecha_limite_retiro: string | null;
  notas: string | null;
  cliente_nombre: string;
  cliente_dni: string;
  producto_nombre: string;
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

export function Vendedor() {
  const queryClient = useQueryClient();
  const [codigoCanje, setCodigoCanje] = useState("");
  const [canjeInfo, setCanjeInfo] = useState<CanjeInfo | null>(null);
  const [canjeErr, setCanjeErr] = useState("");
  const [canjeOk, setCanjeOk] = useState("");
  const [buscandoCanje, setBuscandoCanje] = useState(false);
  const [procesandoCanje, setProcesandoCanje] = useState(false);

  const [queryCliente, setQueryCliente] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [cliente, setCliente] = useState<ClienteBuscado | null>(null);
  const [mostrarSugerenciasCliente, setMostrarSugerenciasCliente] = useState(false);
  const [filtro, setFiltro] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [cart, setCart] = useState<Record<number, number>>({});
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const buscadorClienteRef = useRef<HTMLDivElement | null>(null);
  const [busquedaOrdenes, setBusquedaOrdenes] = useState("");
  const [filtroEstadoOrden, setFiltroEstadoOrden] = useState("");
  const [ordenExpandidaId, setOrdenExpandidaId] = useState<number | null>(null);
  const [ordenMsg, setOrdenMsg] = useState("");
  const [ordenErr, setOrdenErr] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(queryCliente.trim());
    }, 300);

    return () => window.clearTimeout(timer);
  }, [queryCliente]);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (!buscadorClienteRef.current) return;
      const target = event.target as Node | null;
      if (target && !buscadorClienteRef.current.contains(target)) {
        setMostrarSugerenciasCliente(false);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const productosQuery = useQuery({
    queryKey: ["vendedor", "productos"],
    queryFn: () => api.get<Producto[]>("/productos"),
  });

  const clientesQuery = useQuery({
    queryKey: ["vendedor", "clientes", debouncedQuery],
    queryFn: () => api.get<ClienteBuscado[]>(`/vendedor/clientes/buscar?q=${encodeURIComponent(debouncedQuery)}`),
    enabled: debouncedQuery.length >= 2,
  });

  const ordenesQuery = useQuery({
    queryKey: ["vendedor", "ordenes"],
    queryFn: () => api.get<OrdenVendedor[]>("/vendedor/ordenes"),
    refetchInterval: 10000,
  });

  const productos = productosQuery.data ?? [];
  const resultadosClientes = clientesQuery.data ?? [];
  const ordenes = ordenesQuery.data ?? [];

  const productosFiltrados = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    if (!q) return productos;
    return productos.filter((producto) => producto.nombre.toLowerCase().includes(q));
  }, [productos, filtro]);

  const cartItems = useMemo(() => {
    return productos
      .filter((producto) => cart[producto.id])
      .map((producto) => ({
        ...producto,
        cantidad: cart[producto.id],
        subtotal_puntos: (producto.puntos_acumulables || 0) * cart[producto.id],
      }));
  }, [productos, cart]);

  const totalPuntos = useMemo(
    () => cartItems.reduce((acumulado, item) => acumulado + item.subtotal_puntos, 0),
    [cartItems],
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
        orden.estado,
        pagoLabel(orden.pago),
        orden.sucursal?.nombre ?? "",
        orden.direccion_envio?.localidad ?? "",
      ].some((value) => value.toLowerCase().includes(q));
    });
  }, [busquedaOrdenes, filtroEstadoOrden, ordenes]);

  const cargarMutation = useMutation({
    mutationFn: () => {
      if (!cliente) {
        throw new Error("Selecciona un cliente antes de confirmar.");
      }
      if (!cartItems.length) {
        throw new Error("Agrega al menos un producto.");
      }

      const items = Object.entries(cart).map(([producto_id, cantidad]) => ({
        producto_id: Number(producto_id),
        cantidad,
      }));

      return api.post<CargarResponse>("/vendedor/cargar", {
        dni: cliente.dni,
        items,
        descripcion: descripcion.trim() || undefined,
      });
    },
    onSuccess: (data) => {
      setError("");
      setOk(`Se acreditaron ${data.puntos_acreditados} puntos. Nuevo saldo: ${data.nuevo_saldo}.`);
      setCart({});
      setDescripcion("");
      setCliente((prev) => (prev ? { ...prev, puntos: data.nuevo_saldo } : prev));
    },
    onError: (err: Error) => {
      setOk("");
      setError(err.message);
    },
  });

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

  function add(productoId: number) {
    setCart((prev) => ({
      ...prev,
      [productoId]: (prev[productoId] || 0) + 1,
    }));
  }

  function inc(productoId: number) {
    add(productoId);
  }

  function dec(productoId: number) {
    setCart((prev) => {
      const cantidad = (prev[productoId] || 0) - 1;
      const next = { ...prev };
      if (cantidad <= 0) {
        delete next[productoId];
      } else {
        next[productoId] = cantidad;
      }
      return next;
    });
  }

  async function buscarCanje() {
    const codigo = codigoCanje.trim().toUpperCase();
    if (!codigo) return;
    setCanjeErr("");
    setCanjeOk("");
    setCanjeInfo(null);
    setBuscandoCanje(true);
    try {
      const data = await api.get<CanjeInfo>(`/vendedor/canje/${codigo}`);
      setCanjeInfo(data);
    } catch (err: any) {
      setCanjeErr(err.message ?? "Código no encontrado");
    } finally {
      setBuscandoCanje(false);
    }
  }

  async function procesarCanje(estado: "entregado" | "no_disponible" | "cancelado") {
    if (!canjeInfo) return;
    setCanjeErr("");
    setCanjeOk("");
    setProcesandoCanje(true);
    try {
      await api.patch(`/vendedor/canje/${canjeInfo.codigo_retiro}`, { estado });
      setCanjeOk(
        estado === "entregado"
          ? "Canje marcado como entregado."
          : estado === "no_disponible"
          ? "Canje marcado como no disponible. Puntos devueltos al cliente."
          : "Canje cancelado. Puntos devueltos al cliente."
      );
      setCanjeInfo((prev) => prev ? { ...prev, estado } : prev);
    } catch (err: any) {
      setCanjeErr(err.message ?? "Error al procesar el canje");
    } finally {
      setProcesandoCanje(false);
    }
  }

  function clear() {
    setCart({});
    setDescripcion("");
    setError("");
    setOk("");
  }

  const canjeYaFinalizado = canjeInfo
    ? ["entregado", "cancelado", "expirado"].includes(canjeInfo.estado)
    : false;

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
      <div className="vendedor-top-grid">
        <div className="vendedor-col">
          {/* ── PROCESAR CANJE ── */}
          <h1 className="ios-title mb-4">Procesar canje</h1>
          <div className="ios-card p-4" style={{ borderLeft: "4px solid #D4621A" }}>
        <p className="text-sm mb-3" style={{ color: "#6b7280" }}>
          Ingresá el código que te muestra el cliente para validar su canje.
        </p>
        <div style={{ display: "flex", gap: "0.6rem" }}>
          <input
            className="ios-input"
            placeholder="Ej: AB3K7MN2P"
            value={codigoCanje}
            onChange={(e) => { setCodigoCanje(e.target.value.toUpperCase()); setCanjeInfo(null); setCanjeErr(""); setCanjeOk(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void buscarCanje(); } }}
            style={{ textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, flex: 1 }}
            maxLength={9}
          />
          <button
            className="ios-btn-primary"
            style={{ width: "auto", padding: "0 1.25rem", borderRadius: "12px", whiteSpace: "nowrap" }}
            disabled={buscandoCanje || codigoCanje.trim().length < 3}
            onClick={() => void buscarCanje()}
          >
            {buscandoCanje ? "..." : "Buscar"}
          </button>
        </div>

        {canjeErr ? <div className="status-err-box mt-3"><p>{canjeErr}</p></div> : null}
        {canjeOk  ? <div className="status-ok-box mt-3"><p>{canjeOk}</p></div>  : null}

            {canjeInfo ? (
              <div className="mt-4 rounded-xl p-4" style={{ background: "#FEF3E8", border: "1px solid #F5C8A8" }}>
            <p className="text-xs uppercase font-bold tracking-wider mb-2" style={{ color: "#A08060" }}>Detalle del canje</p>
            <div style={{ display: "grid", gap: "0.3rem" }}>
              <p className="text-sm"><strong>Producto principal:</strong> {canjeInfo.producto_nombre}</p>
              {canjeInfo.items?.length ? (
                <div className="text-xs" style={{ color: "#A08060" }}>
                  <p style={{ margin: "0 0 0.2rem", fontWeight: 700 }}>
                    Productos ({canjeInfo.total_unidades ?? canjeInfo.items.reduce((acc, item) => acc + item.cantidad, 0)} unidades):
                  </p>
                  {canjeInfo.items.map((item) => (
                    <p key={`${item.producto_id}-${item.cantidad}`} style={{ margin: "0.1rem 0" }}>
                      • {item.producto_nombre} x{item.cantidad}
                    </p>
                  ))}
                </div>
              ) : null}
              <p className="text-sm"><strong>Cliente:</strong> {canjeInfo.cliente_nombre} — DNI {canjeInfo.cliente_dni}</p>
              <p className="text-sm"><strong>Puntos:</strong> {canjeInfo.puntos_usados} pts</p>
              {canjeInfo.sucursal_nombre ? (
                <p className="text-sm">
                  <strong>Sucursal:</strong> {canjeInfo.sucursal_nombre} - {canjeInfo.sucursal_direccion}
                  {canjeInfo.sucursal_piso ? `, Piso ${canjeInfo.sucursal_piso}` : ""}
                  {canjeInfo.sucursal_localidad ? `, ${canjeInfo.sucursal_localidad}` : ""}
                  {canjeInfo.sucursal_provincia ? `, ${canjeInfo.sucursal_provincia}` : ""}
                </p>
              ) : null}
              <p className="text-sm">
                <strong>Estado:</strong>{" "}
                <span style={{ color: canjeInfo.estado === "pendiente" ? "#D4621A" : canjeInfo.estado === "entregado" ? "#16a34a" : "#dc2626", fontWeight: 700 }}>
                  {canjeInfo.estado.toUpperCase()}
                </span>
              </p>
              {canjeInfo.fecha_limite_retiro ? (
                <p className="text-xs" style={{ color: "#A08060" }}>
                  Vence: {new Date(canjeInfo.fecha_limite_retiro).toLocaleString("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </p>
              ) : null}
            </div>

            {!canjeYaFinalizado ? (
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", flexWrap: "wrap" }}>
                <button
                  className="ios-btn-primary"
                  style={{ flex: 1, minWidth: "120px", background: "#16a34a", borderColor: "#16a34a" }}
                  disabled={procesandoCanje}
                  onClick={() => void procesarCanje("entregado")}
                >
                  Entregado
                </button>
                <button
                  className="ios-btn-secondary"
                  style={{ flex: 1, minWidth: "120px" }}
                  disabled={procesandoCanje}
                  onClick={() => void procesarCanje("no_disponible")}
                >
                  No disponible
                </button>
                <button
                  className="ios-btn-secondary"
                  style={{ flex: 1, minWidth: "120px", color: "#dc2626", borderColor: "#dc2626" }}
                  disabled={procesandoCanje}
                  onClick={() => void procesarCanje("cancelado")}
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <p className="text-sm mt-3 font-medium" style={{ color: "#6b7280" }}>
                Este canje ya no puede modificarse.
              </p>
            )}
              </div>
            ) : null}
          </div>
        </div>

        <div className="vendedor-col">
          {/* ── CARGAR PUNTOS ── */}
          <h1 className="ios-title mb-4">Cargar puntos</h1>

          <p className="ios-label">Cliente</p>

          <div ref={buscadorClienteRef} style={{ position: "relative", marginBottom: "0.5rem" }}>
        <input
          className="ios-input"
          placeholder="Nombre o DNI del cliente..."
          value={queryCliente}
          onFocus={() => setMostrarSugerenciasCliente(true)}
          onChange={(event) => {
            setError("");
            setOk("");
            setQueryCliente(event.target.value);
            setMostrarSugerenciasCliente(true);
          }}
        />

        {mostrarSugerenciasCliente && queryCliente.trim().length >= 2 && resultadosClientes.length > 0 ? (
          <div className="vendedor-sugerencias-box">
            {resultadosClientes.map((usuario) => (
              <button
                key={usuario.id}
                type="button"
                onClick={() => {
                  setCliente(usuario);
                  setQueryCliente(usuario.nombre);
                  setMostrarSugerenciasCliente(false);
                }}
                className="vendedor-sugerencia-item"
              >
                <span className="font-semibold text-sm" style={{ color: "#3D1A02" }}>
                  {usuario.nombre}
                </span>
                <span className="text-xs" style={{ color: "#A08060" }}>
                  DNI: {usuario.dni} - {usuario.puntos} pts
                </span>
              </button>
            ))}
          </div>
        ) : null}
          </div>

          {cliente ? (
            <div className="ios-card p-4" style={{ marginBottom: "0.5rem" }}>
          <div className="flex justify-between items-center">
            <div>
              <p className="text-base font-bold" style={{ color: "#D4621A" }}>
                {cliente.nombre}
              </p>
              <p className="text-xs" style={{ color: "#A08060" }}>
                DNI {cliente.dni} - <span className="font-bold" style={{ color: "#D4621A" }}>{cliente.puntos}</span> puntos
              </p>
            </div>
            <button
              onClick={() => {
                setCliente(null);
                setQueryCliente("");
                setMostrarSugerenciasCliente(false);
              }}
              className="vendedor-cambiar-btn"
            >
              Cambiar
            </button>
          </div>
            </div>
          ) : null}

          <p className="ios-label mt-6">Catalogo</p>
          <input
            className="ios-input mb-2"
            placeholder="Buscar producto..."
            value={filtro}
            onChange={(event) => setFiltro(event.target.value)}
          />
          <div className="ios-card ios-list max-h-80 overflow-y-auto">
        {productosFiltrados.length === 0 ? <div className="ios-row text-ios-secondary text-sm">Sin productos.</div> : null}
        {productosFiltrados.map((producto) => (
          <button key={producto.id} type="button" onClick={() => add(producto.id)} className="vendedor-producto-item">
            <div className="min-w-0">
              <p className="text-base font-medium truncate">{producto.nombre}</p>
              <p className="text-xs" style={{ color: "#A08060" }}>
                +{producto.puntos_acumulables || 0} pts c/u
              </p>
            </div>
            <span className="text-[#D4621A] text-xl leading-none">+</span>
          </button>
        ))}
          </div>

          {cartItems.length > 0 ? (
            <>
              <p className="ios-label mt-6">Carrito</p>
              <div className="ios-card ios-list">
            {cartItems.map((item) => (
              <div key={item.id} className="ios-row">
                <div className="min-w-0">
                  <p className="text-base font-medium truncate">{item.nombre}</p>
                  <p className="text-xs text-ios-secondary">+{item.subtotal_puntos} pts</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button type="button" className="vendedor-round-btn" onClick={() => dec(item.id)}>
                    -
                  </button>
                  <span className="w-6 text-center font-medium">{item.cantidad}</span>
                  <button type="button" className="vendedor-round-btn" onClick={() => inc(item.id)}>
                    +
                  </button>
                </div>
              </div>
            ))}
              </div>

              <div className="ios-card mt-3 p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-ios-secondary">Puntos totales a cargar</p>
            </div>
            <div className="text-right">
              <p className="text-xl font-bold text-ios-green">+{totalPuntos}</p>
            </div>
              </div>
            </>
          ) : null}

          <div className="mt-6 space-y-3">
            <input
              className="ios-input"
              placeholder="Descripcion (opcional)"
              value={descripcion}
              onChange={(event) => setDescripcion(event.target.value)}
              disabled={!cliente}
            />

            {error ? <p className="text-ios-red text-sm">{error}</p> : null}
            {ok ? <p className="text-ios-green text-sm font-medium">{ok}</p> : null}

            <button
              type="button"
              className="ios-btn-primary"
              disabled={cargarMutation.isPending || !cliente || cartItems.length === 0}
              onClick={() => {
                setError("");
                setOk("");
                cargarMutation.mutate();
              }}
            >
              {cargarMutation.isPending ? "Cargando..." : "Cargar puntos"}
            </button>

            {cartItems.length > 0 ? (
              <button type="button" className="ios-btn-secondary" onClick={clear}>
                Vaciar carrito
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="ios-card p-4 mt-6" style={{ borderLeft: "4px solid #D4621A" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "flex-start", flexWrap: "wrap" }}>
          <div>
            <h2 className="ios-title" style={{ marginBottom: "0.25rem" }}>Pedidos</h2>
            <p className="text-sm" style={{ color: "#6b7280" }}>
              Gestiona pedidos pagados, preparacion, envio y entrega. Los pagos de Mercado Pago pendientes no se fuerzan manualmente.
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
