import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../../api";
import { useAuthStore } from "../../store/authStore";
import type { Producto } from "../../types";

type CanjeCarritoResponse = {
  canje_id: number;
  canje_codigo?: string | null;
  codigo_retiro?: string | null;
  nuevo_saldo: number;
  puntos_usados: number;
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
  dias_limite_retiro?: number;
  fecha_limite_retiro?: string | null;
  sucursal_id?: number | null;
  sucursal?: SucursalRetiro | null;
  lugar_retiro?: string | null;
};

type SucursalRetiro = {
  id: number;
  nombre: string;
  direccion: string;
  piso?: string | null;
  localidad: string;
  provincia: string;
};

type CatalogToast = {
  msg: string;
  variant: "success" | "error" | "info" | "redeem_notice";
  actionLabel?: string;
  onAction?: () => void;
  dismissLabel?: string;
  autoHideMs?: number;
  title?: string;
  codigoCanje?: string | null;
  sucursalDetalle?: SucursalRetiro | null;
  lugarRetiroTexto?: string;
  diasLimiteRetiro?: number | null;
};

function isLegacyCanjeCode(code?: string | null): boolean {
  return Boolean(code && /^C0{2,}[A-Z0-9]*$/.test(code));
}

function getCanjeCode(data: CanjeCarritoResponse): string | null {
  if (data.canje_codigo && !isLegacyCanjeCode(data.canje_codigo)) return data.canje_codigo;
  if (data.codigo_retiro && !isLegacyCanjeCode(data.codigo_retiro)) return data.codigo_retiro;
  return null;
}

function formatSucursalLabel(sucursal: SucursalRetiro): string {
  const piso = sucursal.piso ? `, Piso ${sucursal.piso}` : "";
  return `${sucursal.nombre} - ${sucursal.direccion}${piso}, ${sucursal.localidad}, ${sucursal.provincia}`;
}

function getProductoImagen(producto: Producto): string | null {
  if (producto.imagenes?.length) return producto.imagenes[0];
  return producto.imagen_url ?? null;
}

function getProductoImagenes(producto: Producto): string[] {
  const imagenes = producto.imagenes?.filter(Boolean) ?? [];
  if (imagenes.length) return imagenes;
  return producto.imagen_url ? [producto.imagen_url] : [];
}

export function Catalogo() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const updateUserPoints = useAuthStore((state) => state.updateUserPoints);
  const isCliente = user?.rol === "cliente";

  const [categoriaActiva, setCategoriaActiva] = useState("");
  const [maxPuntos, setMaxPuntos] = useState(0);
  const [busquedaProducto, setBusquedaProducto] = useState("");
  const [productoModal, setProductoModal] = useState<Producto | null>(null);
  const [productoModalImageIndex, setProductoModalImageIndex] = useState(0);
  const [imgZoomed, setImgZoomed] = useState(false);
  const [zoomOrigin, setZoomOrigin] = useState("50% 50%");
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ active: boolean; startX: number; startY: number; panX: number; panY: number } | null>(null);
  const hasDragged = useRef(false);
  const [toast, setToast] = useState<CatalogToast | null>(null);
  const [sucursalRetiroId, setSucursalRetiroId] = useState("");
  const [canjeCart, setCanjeCart] = useState<Record<number, number>>({});
  const [canjeConfirmOpen, setCanjeConfirmOpen] = useState(false);
  const [cantidadesSeleccionadas, setCantidadesSeleccionadas] = useState<Record<number, number>>({});
  const [cantidadModalCanje, setCantidadModalCanje] = useState(1);
  const [codigoCopiado, setCodigoCopiado] = useState(false);

  const productosQuery = useQuery({
    queryKey: ["productos"],
    queryFn: () => api.get<Producto[]>("/productos"),
  });

  const categoriasQuery = useQuery({
    queryKey: ["productos", "categorias"],
    queryFn: () => api.get<string[]>("/productos/categorias"),
  });

  const sucursalesQuery = useQuery({
    queryKey: ["cliente", "sucursales-retiro"],
    queryFn: () => api.get<SucursalRetiro[]>("/cliente/sucursales"),
    enabled: isCliente,
  });

  const productos = productosQuery.data ?? [];
  const categorias = categoriasQuery.data ?? [];
  const sucursalesRetiro = sucursalesQuery.data ?? [];
  const sucursalRetiroSeleccionada =
    (sucursalRetiroId ? sucursalesRetiro.find((item) => String(item.id) === sucursalRetiroId) : undefined) ||
    (sucursalesRetiro.length === 1 ? sucursalesRetiro[0] : undefined);
  const productoModalImagenes = productoModal ? getProductoImagenes(productoModal) : [];
  const productoModalImagenActual = productoModalImagenes[productoModalImageIndex] ?? productoModalImagenes[0] ?? null;
  const productoModalTieneCarousel = productoModalImagenes.length > 1;

  const puntosMax = useMemo(() => {
    if (!productos.length) return 1000;
    const maxRaw = Math.max(...productos.map((producto) => producto.puntos_requeridos || 0));
    return Math.max(50, Math.ceil(maxRaw / 50) * 50);
  }, [productos]);

  useEffect(() => {
    setMaxPuntos(puntosMax);
  }, [puntosMax]);

  useEffect(() => {
    setProductoModalImageIndex(0);
    setImgZoomed(false);
    setPan({ x: 0, y: 0 });
    setZoomOrigin("50% 50%");
  }, [productoModal?.id]);

  useEffect(() => {
    if (!productoModalImagenes.length) return;
    setProductoModalImageIndex((prev) => Math.min(prev, productoModalImagenes.length - 1));
  }, [productoModalImagenes.length]);

  function cambiarImagenModal(nextIndex: number) {
    if (!productoModalImagenes.length) return;
    const normalizedIndex = (nextIndex + productoModalImagenes.length) % productoModalImagenes.length;
    setProductoModalImageIndex(normalizedIndex);
    setImgZoomed(false);
    setPan({ x: 0, y: 0 });
    setZoomOrigin("50% 50%");
  }

  useEffect(() => {
    document.body.classList.add("catalogo-background");
    return () => {
      document.body.classList.remove("catalogo-background");
    };
  }, []);

  useEffect(() => {
    if (!toast?.autoHideMs) return;
    const timer = window.setTimeout(() => {
      setToast(null);
    }, toast.autoHideMs);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (toast?.variant !== "redeem_notice") {
      setCodigoCopiado(false);
    }
  }, [toast?.variant]);

  useEffect(() => {
    const state = location.state as { accessDeniedNotice?: string } | null;
    const deniedMessage = state?.accessDeniedNotice?.trim();
    if (!deniedMessage) return;
    setToast({
      msg: deniedMessage,
      variant: "error",
      dismissLabel: "Cerrar",
      autoHideMs: 10000,
    });
    navigate("/catalogo", { replace: true });
  }, [location.state, navigate]);

  useEffect(() => {
    if (!isCliente) return;
    if (sucursalesRetiro.length === 1) {
      setSucursalRetiroId(String(sucursalesRetiro[0].id));
      return;
    }
    if (!sucursalRetiroId) return;
    const exists = sucursalesRetiro.some((item) => String(item.id) === sucursalRetiroId);
    if (!exists) setSucursalRetiroId("");
  }, [isCliente, sucursalRetiroId, sucursalesRetiro]);

  const productosFiltrados = useMemo(() => {
    const q = busquedaProducto.trim().toLowerCase();
    return productos.filter((producto) => {
      const coincideCategoria = !categoriaActiva || producto.categoria === categoriaActiva;
      const coincidePuntos = !maxPuntos || producto.puntos_requeridos <= maxPuntos;
      const texto = [producto.nombre, producto.descripcion || "", producto.categoria || ""].join(" ").toLowerCase();
      const coincideBusqueda = !q || texto.includes(q);
      return coincideCategoria && coincidePuntos && coincideBusqueda;
    });
  }, [productos, categoriaActiva, maxPuntos, busquedaProducto]);

  const canjeCartItems = useMemo(() => {
    return productos
      .filter((producto) => canjeCart[producto.id])
      .map((producto) => ({
        ...producto,
        cantidad: canjeCart[producto.id],
        subtotal_puntos: (producto.puntos_requeridos || 0) * canjeCart[producto.id],
      }));
  }, [productos, canjeCart]);

  const canjeCartTotalPuntos = useMemo(
    () => canjeCartItems.reduce((acc, item) => acc + item.subtotal_puntos, 0),
    [canjeCartItems],
  );

  const canjeCartTotalUnidades = useMemo(
    () => canjeCartItems.reduce((acc, item) => acc + item.cantidad, 0),
    [canjeCartItems],
  );

  const canjearCarritoMutation = useMutation({
    mutationFn: ({ items, sucursalId }: { items: Array<{ producto_id: number; cantidad: number }>; sucursalId?: number }) =>
      api.post<CanjeCarritoResponse>("/cliente/canjear-carrito", {
        items,
        sucursal_id: sucursalId,
      }),
    onSuccess: (data) => {
      const codigoRetiro = getCanjeCode(data);
      const sucursalElegida =
        data.sucursal ??
        (data.sucursal_id ? sucursalesRetiro.find((item) => item.id === data.sucursal_id) : undefined);
      const lugarRetiro = sucursalElegida
        ? formatSucursalLabel(sucursalElegida)
        : (data.lugar_retiro || "informada por la administración").trim();
      updateUserPoints(data.nuevo_saldo);
      setToast({
        variant: "redeem_notice",
        title: "Canje de carrito hecho con exito",
        msg:
          typeof data.total_unidades === "number" && data.total_unidades > 0
            ? `Tu canje se registro correctamente con ${data.total_unidades} producto(s).`
            : "Tu canje se registro correctamente.",
        codigoCanje: codigoRetiro ?? "Disponible en Mis Canjes",
        sucursalDetalle: sucursalElegida ?? null,
        lugarRetiroTexto: lugarRetiro,
        diasLimiteRetiro:
          typeof data.dias_limite_retiro === "number" && data.dias_limite_retiro > 0
            ? data.dias_limite_retiro
            : null,
      });
      setCanjeCart({});
      setCanjeConfirmOpen(false);
      setProductoModal(null);
    },
    onError: (error: Error) => {
      const message = error.message.toLowerCase();
      if (message.includes("completa tus datos obligatorios")) {
        setToast({
          msg: error.message,
          variant: "error",
          actionLabel: "Completar mi perfil",
          onAction: () => navigate("/mi-perfil"),
          dismissLabel: "Cerrar",
          autoHideMs: 9000,
        });
        return;
      }
      setToast({
        msg: error.message,
        variant: "error",
        dismissLabel: "Cerrar",
        autoHideMs: 7000,
      });
    },
  });

  const loading = productosQuery.isLoading || categoriasQuery.isLoading;

  function abrirProducto(producto: Producto) {
    setProductoModal(producto);
    setCantidadModalCanje(1);
    setImgZoomed(false);
    setPan({ x: 0, y: 0 });
    setZoomOrigin("50% 50%");
  }

  function agregarProductoAlCarrito(producto: Producto, onAdded?: () => void, cantidad = 1) {
    if (!user || user.rol !== "cliente") {
      setToast({
        msg: "Solo los clientes pueden canjear productos.",
        variant: "info",
        actionLabel: "Ir a login",
        onAction: () => navigate("/login"),
        dismissLabel: "Cerrar",
        autoHideMs: 7000,
      });
      return;
    }

    if (canjearCarritoMutation.isPending) return;
    const cantidadSafe = Number.isInteger(cantidad) && cantidad > 0 ? cantidad : 1;

    setCanjeCart((prev) => ({
      ...prev,
      [producto.id]: (prev[producto.id] || 0) + cantidadSafe,
    }));
    onAdded?.();
  }

  async function copiarCodigoCanje() {
    const code = toast?.codigoCanje?.trim();
    if (!code || code === "Disponible en Mis Canjes") return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const input = document.createElement("textarea");
        input.value = code;
        input.setAttribute("readonly", "true");
        input.style.position = "absolute";
        input.style.left = "-9999px";
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
      }
      setCodigoCopiado(true);
      window.setTimeout(() => setCodigoCopiado(false), 2200);
    } catch {
      setCodigoCopiado(false);
    }
  }

  function incrementarCarrito(productoId: number) {
    setCanjeCart((prev) => ({
      ...prev,
      [productoId]: (prev[productoId] || 0) + 1,
    }));
  }

  function decrementarCarrito(productoId: number) {
    setCanjeCart((prev) => {
      const next = { ...prev };
      const cantidadActual = next[productoId] || 0;
      if (cantidadActual <= 1) {
        delete next[productoId];
      } else {
        next[productoId] = cantidadActual - 1;
      }
      return next;
    });
  }

  function abrirConfirmacionCarrito() {
    if (!user || user.rol !== "cliente") {
      setToast({
        msg: "Solo los clientes pueden canjear productos.",
        variant: "info",
        actionLabel: "Ir a login",
        onAction: () => navigate("/login"),
        dismissLabel: "Cerrar",
        autoHideMs: 7000,
      });
      return;
    }

    if (!canjeCartItems.length) {
      setToast({
        msg: "Agrega productos al carrito para canjear.",
        variant: "info",
        dismissLabel: "Cerrar",
        autoHideMs: 6000,
      });
      return;
    }

    if (!sucursalesRetiro.length) {
      setToast({
        msg: "No hay sucursales de retiro disponibles en este momento.",
        variant: "error",
        dismissLabel: "Cerrar",
        autoHideMs: 7000,
      });
      return;
    }

    if (!sucursalRetiroId && sucursalesRetiro.length === 1) {
      setSucursalRetiroId(String(sucursalesRetiro[0].id));
    }

    setCanjeConfirmOpen(true);
  }

  function confirmarCanjeCarritoPendiente() {
    if (!canjeCartItems.length) return;
    const sucursalElegida = sucursalRetiroSeleccionada || sucursalesRetiro[0];

    if (sucursalesRetiro.length > 1 && !sucursalElegida) {
      setToast({
        msg: "Selecciona una sucursal de retiro antes de confirmar el canje.",
        variant: "info",
        dismissLabel: "Cerrar",
        autoHideMs: 7000,
      });
      return;
    }

    canjearCarritoMutation.mutate({
      items: canjeCartItems.map((item) => ({
        producto_id: item.id,
        cantidad: item.cantidad,
      })),
      sucursalId: sucursalElegida?.id,
    });
  }

  function vaciarCarritoCanje() {
    setCanjeCart({});
  }

  function getCantidadSeleccionada(productoId: number): number {
    const value = cantidadesSeleccionadas[productoId];
    return Number.isInteger(value) && value > 0 ? value : 1;
  }

  function ajustarCantidadSeleccionada(productoId: number, delta: number) {
    setCantidadesSeleccionadas((prev) => {
      const actual = Number.isInteger(prev[productoId]) && prev[productoId] > 0 ? prev[productoId] : 1;
      const next = Math.max(1, Math.min(100, actual + delta));
      return { ...prev, [productoId]: next };
    });
  }

  return (
    <section className="catalog-page">
      <div className="catalog-top-shell">
        <div className="catalog-header">
          <h1 className="catalog-title">Catalogo de productos</h1>
          <p className="catalog-subtitle">Canjea tus puntos por productos exclusivos Nande</p>
        </div>

        {isCliente ? (
          <div className="catalog-user-banner">
            <div>
              <p>
                Hola, <strong>{user.nombre}</strong>
              </p>
              <p style={{ fontSize: "0.8rem", color: "#A08060", marginTop: "0.15rem" }}>Tus puntos disponibles</p>
            </div>
            <div style={{ textAlign: "right" }}>
              <p className="banner-pts">{user.puntos_saldo ?? 0}</p>
              <p className="banner-pts-label">puntos</p>
            </div>
          </div>
        ) : null}

      </div>
      <div className="catalog-products-shell">
        {!loading ? (
          <div className="catalog-filters">
            <div className="catalog-filter-dropdown" style={{ position: "relative" }}>
              <select
                className="catalog-dropdown-btn"
                value={categoriaActiva}
                onChange={(event) => setCategoriaActiva(event.target.value)}
              >
                <option value="">Todas las categorias</option>
                {categorias.map((categoria) => (
                  <option key={categoria} value={categoria}>
                    {categoria}
                  </option>
                ))}
              </select>
            </div>

            <div className="catalog-filter-search">
              <input
                className="catalog-filter-search-input"
                placeholder="Buscar producto..."
                value={busquedaProducto}
                onChange={(event) => setBusquedaProducto(event.target.value)}
              />
            </div>

            <div className="catalog-filter-range">
              <div className="catalog-filter-range-header">
                <label className="catalog-filter-label">Puntos maximos</label>
                <span className="catalog-filter-range-val">{maxPuntos} pts</span>
              </div>
              <input
                type="range"
                className="catalog-range-slider"
                min={0}
                max={puntosMax}
                step={50}
                value={maxPuntos}
                onChange={(event) => setMaxPuntos(Number(event.target.value))}
              />
            </div>

            <button
              className="catalog-filter-clear"
              onClick={() => {
                setCategoriaActiva("");
                setMaxPuntos(puntosMax);
                setBusquedaProducto("");
              }}
            >
              Limpiar
            </button>
          </div>
        ) : null}

        {isCliente ? (
          <div
            className="catalog-redeem-cart-panel"
            style={{
              border: "1.5px solid #E6D3B8",
              borderRadius: "14px",
              padding: "0.75rem",
              background: "#FFF8F0",
              marginBottom: "0.9rem",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
              <p style={{ margin: 0, fontWeight: 700, color: "#4A2C1A" }}>
                Carrito de canje ({canjeCartTotalUnidades} producto{canjeCartTotalUnidades === 1 ? "" : "s"})
              </p>
              <p style={{ margin: 0, fontWeight: 700, color: "#6B3E26" }}>
                Total: {canjeCartTotalPuntos} pts
              </p>
            </div>

            {canjeCartItems.length > 0 ? (
              <div style={{ marginTop: "0.65rem", display: "grid", gap: "0.45rem" }}>
                {canjeCartItems.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "0.55rem",
                      alignItems: "center",
                      border: "1px solid #E6D3B8",
                      borderRadius: "10px",
                      padding: "0.45rem 0.55rem",
                      background: "#FFFDF8",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <p style={{ margin: 0, color: "#4A2C1A", fontWeight: 600, fontSize: "0.87rem" }}>{item.nombre}</p>
                      <p style={{ margin: "0.1rem 0 0", color: "#8B5A30", fontSize: "0.76rem" }}>
                        {item.subtotal_puntos} pts
                      </p>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", flexShrink: 0 }}>
                      <button className="vendedor-round-btn" onClick={() => decrementarCarrito(item.id)} type="button">-</button>
                      <span style={{ minWidth: "18px", textAlign: "center", fontWeight: 700, color: "#4A2C1A" }}>{item.cantidad}</span>
                      <button className="vendedor-round-btn" onClick={() => incrementarCarrito(item.id)} type="button">+</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ margin: "0.6rem 0 0", color: "#8B5A30", fontSize: "0.83rem" }}>
                Agrega productos para canjearlos juntos con un solo codigo.
              </p>
            )}

            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
              <button
                className="catalog-float-toast-btn-primary"
                type="button"
                disabled={canjearCarritoMutation.isPending || !canjeCartItems.length}
                onClick={abrirConfirmacionCarrito}
              >
                {canjearCarritoMutation.isPending ? "Procesando..." : "Canjear carrito"}
              </button>
              <button
                className="catalog-float-toast-btn-secondary"
                type="button"
                disabled={!canjeCartItems.length}
                onClick={vaciarCarritoCanje}
              >
                Vaciar
              </button>
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="catalog-grid">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="product-card">
                <div className="product-card-placeholder" />
                <div className="product-card-body">
                  <div className="catalog-skeleton" style={{ height: "1rem", borderRadius: "6px" }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="catalog-grid">
            {productosFiltrados.length === 0 ? (
              <div className="catalog-empty">
                <h3>Sin productos disponibles</h3>
                <p>Prueba con otros filtros.</p>
              </div>
            ) : null}

            {productosFiltrados.map((producto) => (
              <div key={producto.id} className="product-card">
                <button
                  type="button"
                  className="product-card-media-btn"
                  onClick={() => abrirProducto(producto)}
                  aria-label={`Ver producto ${producto.nombre}`}
                >
                  {getProductoImagen(producto) ? (
                    <img src={getProductoImagen(producto) as string} alt={producto.nombre} className="product-card-img" />
                  ) : (
                    <div className="product-card-placeholder" />
                  )}
                </button>

                {producto.categoria ? <span className="product-card-cat">{producto.categoria}</span> : null}

                <div className="product-card-body">
                  <p className="product-card-name">{producto.nombre}</p>
                  <p className="product-card-desc">{producto.descripcion || "Producto disponible para canje."}</p>

                  <div className="product-card-points">
                    <div className="product-card-row">
                      <span>Puntos para canjear</span>
                      <span className="cost">{producto.puntos_requeridos} pts</span>
                    </div>
                    {producto.puntos_acumulables ? (
                      <>
                        <div className="product-card-divider" />
                        <div className="product-card-row">
                          <span>Puntos que sumas al comprar</span>
                          <span className="earn">+{producto.puntos_acumulables} pts</span>
                        </div>
                      </>
                    ) : null}
                  </div>

                  <button
                    className="product-card-btn product-card-btn-ver"
                    onClick={() => abrirProducto(producto)}
                  >
                    Ver producto
                  </button>

                  {user ? (
                    <>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem", marginTop: "0.5rem" }}>
                        <button
                          type="button"
                          className="vendedor-round-btn"
                          disabled={canjearCarritoMutation.isPending || getCantidadSeleccionada(producto.id) <= 1}
                          onClick={() => ajustarCantidadSeleccionada(producto.id, -1)}
                        >
                          -
                        </button>
                        <span style={{ minWidth: "28px", textAlign: "center", fontWeight: 700, color: "#4A2C1A" }}>
                          {getCantidadSeleccionada(producto.id)}
                        </span>
                        <button
                          type="button"
                          className="vendedor-round-btn"
                          disabled={canjearCarritoMutation.isPending}
                          onClick={() => ajustarCantidadSeleccionada(producto.id, +1)}
                        >
                          +
                        </button>
                      </div>
                      <button
                        className="product-card-btn product-card-btn-canjear"
                        style={{ marginTop: "0.5rem" }}
                        disabled={canjearCarritoMutation.isPending}
                        onClick={() =>
                          agregarProductoAlCarrito(
                            producto,
                            () =>
                              setCantidadesSeleccionadas((prev) => {
                                const next = { ...prev };
                                delete next[producto.id];
                                return next;
                              }),
                            getCantidadSeleccionada(producto.id)
                          )
                        }
                      >
                        Agregar al carrito
                      </button>
                    </>
                  ) : (
                    <Link to="/login" className="product-card-btn product-card-btn-login" style={{ marginTop: "0.5rem" }}>
                      Iniciar sesion para canjear
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {canjeConfirmOpen ? (
        <div className="catalog-confirm-overlay" onClick={() => setCanjeConfirmOpen(false)}>
          <div className="catalog-confirm-card" onClick={(event) => event.stopPropagation()}>
            <p className="catalog-confirm-title">Confirmar canje de carrito</p>
            <p className="catalog-confirm-msg">
              Vas a canjear <strong>{canjeCartTotalUnidades}</strong> producto(s) por{" "}
              <strong>{canjeCartTotalPuntos} pts</strong>.
            </p>

            <div className="catalog-confirm-branch-detail">
              {canjeCartItems.map((item) => (
                <p key={item.id}>
                  <strong>{item.nombre}</strong> x{item.cantidad} — {item.subtotal_puntos} pts
                </p>
              ))}
            </div>

            <div className="catalog-confirm-field">
              <label className="catalog-confirm-label" htmlFor="catalog-confirm-sucursal">
                Sucursal donde vas a retirar
              </label>
              <select
                id="catalog-confirm-sucursal"
                className="catalog-pickup-select"
                value={sucursalRetiroId}
                onChange={(event) => setSucursalRetiroId(event.target.value)}
                disabled={sucursalesQuery.isLoading || !sucursalesRetiro.length || canjearCarritoMutation.isPending}
              >
                {sucursalesRetiro.length > 1 ? <option value="">Selecciona una sucursal</option> : null}
                {sucursalesRetiro.map((sucursal) => (
                  <option key={sucursal.id} value={sucursal.id}>
                    {sucursal.nombre}
                  </option>
                ))}
              </select>
            </div>

            {sucursalRetiroSeleccionada ? (
              <div className="catalog-confirm-branch-detail">
                <p><strong>Nombre:</strong> {sucursalRetiroSeleccionada.nombre}</p>
                <p><strong>Direccion:</strong> {sucursalRetiroSeleccionada.direccion}</p>
                {sucursalRetiroSeleccionada.piso ? <p><strong>Piso:</strong> {sucursalRetiroSeleccionada.piso}</p> : null}
                <p><strong>Localidad:</strong> {sucursalRetiroSeleccionada.localidad}</p>
                <p><strong>Provincia:</strong> {sucursalRetiroSeleccionada.provincia}</p>
              </div>
            ) : (
              <p className="catalog-confirm-hint">Selecciona una sucursal para ver los datos de retiro.</p>
            )}

            <div className="catalog-float-toast-actions">
              <button
                className="catalog-float-toast-btn-primary"
                onClick={confirmarCanjeCarritoPendiente}
                disabled={canjearCarritoMutation.isPending || !canjeCartItems.length || (sucursalesRetiro.length > 1 && !sucursalRetiroSeleccionada)}
              >
                {canjearCarritoMutation.isPending ? "Procesando..." : "Confirmar canje"}
              </button>
              <button className="catalog-float-toast-btn-secondary" onClick={() => setCanjeConfirmOpen(false)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        toast.variant === "redeem_notice" ? (
          <div className="catalog-alert-overlay">
            <div className="catalog-alert-card" role="alertdialog" aria-modal="true" aria-label="Aviso de retiro de canje">
              <button className="catalog-alert-close" onClick={() => setToast(null)} aria-label="Cerrar aviso">✕</button>
              <p className="catalog-alert-title">{toast.title ?? "Canje confirmado"}</p>
              <p className="catalog-alert-msg">{toast.msg}</p>
              <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", flexWrap: "wrap" }}>
                <p className="catalog-alert-code">
                  Código de canje: <strong>{toast.codigoCanje ?? "Disponible en Mis Canjes"}</strong>
                </p>
                <button
                  type="button"
                  className="catalog-float-toast-btn-secondary"
                  style={{ padding: "0.35rem 0.62rem" }}
                  onClick={() => void copiarCodigoCanje()}
                  disabled={!toast.codigoCanje || toast.codigoCanje === "Disponible en Mis Canjes"}
                >
                  {codigoCopiado ? "Copiado" : "Copiar"}
                </button>
              </div>
              {toast.sucursalDetalle ? (
                <div className="catalog-confirm-branch-detail catalog-alert-branch-detail">
                  <p><strong>Nombre:</strong> {toast.sucursalDetalle.nombre}</p>
                  <p><strong>Direccion:</strong> {toast.sucursalDetalle.direccion}</p>
                  {toast.sucursalDetalle.piso ? <p><strong>Piso:</strong> {toast.sucursalDetalle.piso}</p> : null}
                  <p><strong>Localidad:</strong> {toast.sucursalDetalle.localidad}</p>
                  <p><strong>Provincia:</strong> {toast.sucursalDetalle.provincia}</p>
                </div>
              ) : (
                <p className="catalog-alert-msg">
                  Sucursal de retiro: <strong>{toast.lugarRetiroTexto ?? "informada por la administración"}</strong>
                </p>
              )}
              <p className="catalog-alert-msg">
                Para retirar tu producto, acercate a la sucursal indicada, presentá este código al vendedor y reclamá tu canje.
              </p>
              {toast.diasLimiteRetiro ? (
                <p className="catalog-alert-expire">
                  Tenes <strong>{toast.diasLimiteRetiro} dias</strong> para retirar este canje. Si no lo retiras dentro de ese plazo, el canje expira automaticamente.
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <div className={`catalog-float-toast catalog-float-toast-${toast.variant}`}>
            <p className="catalog-float-toast-msg">{toast.msg}</p>
            <div className="catalog-float-toast-actions">
              {toast.actionLabel && toast.onAction ? (
                <button
                  className="catalog-float-toast-btn-primary"
                  onClick={() => {
                    toast.onAction?.();
                    setToast(null);
                  }}
                >
                  {toast.actionLabel}
                </button>
              ) : null}
              <button className="catalog-float-toast-btn-secondary" onClick={() => setToast(null)}>
                {toast.dismissLabel ?? "Cerrar"}
              </button>
            </div>
          </div>
        )
      ) : null}

      {productoModal ? (
        <div className="producto-modal-overlay" onClick={() => setProductoModal(null)}>
          <div className="producto-modal" onClick={(e) => e.stopPropagation()}>
            <button className="producto-modal-close" onClick={() => setProductoModal(null)}>✕</button>

            <div className="producto-modal-img-wrap">
              {productoModalImagenActual ? (
                <img
                  src={productoModalImagenActual}
                  alt={`${productoModal.nombre} - imagen ${productoModalImageIndex + 1}`}
                  className="producto-modal-img"
                  style={{
                    transformOrigin: zoomOrigin,
                    transform: imgZoomed ? `translate(${pan.x}px, ${pan.y}px) scale(2.4)` : "none",
                    cursor: !imgZoomed ? "zoom-in" : "grab",
                    transition: dragRef.current?.active ? "none" : "transform 0.3s ease",
                  }}
                  onClick={(e) => {
                    if (hasDragged.current) return;
                    if (imgZoomed) {
                      setImgZoomed(false);
                      setPan({ x: 0, y: 0 });
                      setZoomOrigin("50% 50%");
                    } else {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const x = ((e.clientX - rect.left) / rect.width) * 100;
                      const y = ((e.clientY - rect.top) / rect.height) * 100;
                      setZoomOrigin(`${x}% ${y}%`);
                      setImgZoomed(true);
                    }
                  }}
                  onMouseDown={(e) => {
                    if (!imgZoomed) return;
                    e.preventDefault();
                    hasDragged.current = false;
                    dragRef.current = { active: true, startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
                  }}
                  onMouseMove={(e) => {
                    if (!dragRef.current?.active) return;
                    const dx = e.clientX - dragRef.current.startX;
                    const dy = e.clientY - dragRef.current.startY;
                    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) hasDragged.current = true;
                    setPan({ x: dragRef.current.panX + dx, y: dragRef.current.panY + dy });
                  }}
                  onMouseUp={() => { if (dragRef.current) dragRef.current.active = false; }}
                  onMouseLeave={() => { if (dragRef.current) dragRef.current.active = false; }}
                  onTouchStart={(e) => {
                    if (!imgZoomed) return;
                    const t = e.touches[0];
                    hasDragged.current = false;
                    dragRef.current = { active: true, startX: t.clientX, startY: t.clientY, panX: pan.x, panY: pan.y };
                  }}
                  onTouchMove={(e) => {
                    if (!dragRef.current?.active) return;
                    e.preventDefault();
                    const t = e.touches[0];
                    const dx = t.clientX - dragRef.current.startX;
                    const dy = t.clientY - dragRef.current.startY;
                    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) hasDragged.current = true;
                    setPan({ x: dragRef.current.panX + dx, y: dragRef.current.panY + dy });
                  }}
                  onTouchEnd={() => { if (dragRef.current) dragRef.current.active = false; }}
                  title={imgZoomed ? "Arrastrá para mover · Click para alejar" : "Click para hacer zoom"}
                />
              ) : (
                <div className="product-card-placeholder" style={{ height: "260px" }} />
              )}
              {productoModalTieneCarousel ? (
                <>
                  <button
                    type="button"
                    className="producto-carousel-btn producto-carousel-btn-prev"
                    onClick={() => cambiarImagenModal(productoModalImageIndex - 1)}
                    aria-label="Ver imagen anterior"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    className="producto-carousel-btn producto-carousel-btn-next"
                    onClick={() => cambiarImagenModal(productoModalImageIndex + 1)}
                    aria-label="Ver imagen siguiente"
                  >
                    ›
                  </button>
                  <div className="producto-carousel-count">
                    {productoModalImageIndex + 1} / {productoModalImagenes.length}
                  </div>
                  <div className="producto-carousel-dots" aria-label="Selector de imagenes">
                    {productoModalImagenes.map((imagen, index) => (
                      <button
                        key={`${imagen}-${index}`}
                        type="button"
                        className={`producto-carousel-dot ${index === productoModalImageIndex ? "active" : ""}`}
                        onClick={() => cambiarImagenModal(index)}
                        aria-label={`Ver imagen ${index + 1}`}
                      />
                    ))}
                  </div>
                </>
              ) : null}
              {productoModal.categoria ? (
                <span className="product-card-cat">{productoModal.categoria}</span>
              ) : null}
            </div>

            <div className="producto-modal-body">
              <p className="producto-modal-name">{productoModal.nombre}</p>
              <p className="producto-modal-desc">{productoModal.descripcion || "Producto disponible para canje."}</p>

              <div className="product-card-points">
                <div className="product-card-row">
                  <span>Puntos para canjear</span>
                  <span className="cost">{productoModal.puntos_requeridos} pts</span>
                </div>
                {productoModal.puntos_acumulables ? (
                  <>
                    <div className="product-card-divider" />
                    <div className="product-card-row">
                      <span>Puntos que sumas al comprar</span>
                      <span className="earn">+{productoModal.puntos_acumulables} pts</span>
                    </div>
                  </>
                ) : null}
              </div>

              {user ? (
                <>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.55rem", marginBottom: "0.65rem" }}>
                    <button
                      type="button"
                      className="vendedor-round-btn"
                      onClick={() => setCantidadModalCanje((prev) => Math.max(1, prev - 1))}
                    >
                      -
                    </button>
                    <span style={{ minWidth: "26px", textAlign: "center", fontWeight: 700, color: "#4A2C1A" }}>
                      {cantidadModalCanje}
                    </span>
                    <button
                      type="button"
                      className="vendedor-round-btn"
                      onClick={() => setCantidadModalCanje((prev) => Math.min(100, prev + 1))}
                    >
                      +
                    </button>
                  </div>
                  <button
                    className="product-card-btn product-card-btn-canjear"
                    disabled={canjearCarritoMutation.isPending}
                    onClick={() => agregarProductoAlCarrito(productoModal, () => setProductoModal(null), cantidadModalCanje)}
                  >
                    Agregar {cantidadModalCanje > 1 ? `${cantidadModalCanje} al carrito` : "al carrito"}
                  </button>
                </>
              ) : (
                <Link to="/login" className="product-card-btn product-card-btn-login">
                  Iniciar sesion para canjear
                </Link>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

