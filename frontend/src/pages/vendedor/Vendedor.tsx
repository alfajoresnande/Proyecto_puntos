import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
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

export function Vendedor() {
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

  const productos = productosQuery.data ?? [];
  const resultadosClientes = clientesQuery.data ?? [];

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
              <p className="text-sm"><strong>Producto:</strong> {canjeInfo.producto_nombre}</p>
              {canjeInfo.items && canjeInfo.items.length > 1 ? (
                <div className="text-xs" style={{ color: "#A08060" }}>
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
    </section>
  );
}
