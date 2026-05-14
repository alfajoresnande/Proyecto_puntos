import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../../api";
import { useAuthStore } from "../../store/authStore";
import { useCartStore } from "../../store/cartStore";
import { usePickupStore } from "../../store/pickupStore";
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

function productHasStock(producto: Producto): boolean {
  return producto.track_stock === false || Number(producto.stock_disponible ?? 0) > 0;
}

export function Catalogo() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const updateUserPoints = useAuthStore((state) => state.updateUserPoints);
  const isCliente = user?.rol === "cliente";

  const [categoriaActiva, setCategoriaActiva] = useState("");
  const [puntosFiltro, setPuntosFiltro] = useState<{ min: number; max: number } | null>(null);
  const [busquedaProducto, setBusquedaProducto] = useState("");
  const [ordenProductos, setOrdenProductos] = useState("");
  const [filtrosOpen, setFiltrosOpen] = useState(false);
  const filtrosTriggerRef = useRef<HTMLButtonElement>(null);
  const filtrosPanelRef = useRef<HTMLDivElement>(null);
  const filtrosWasOpen = useRef(false);
  const [productoModal, setProductoModal] = useState<Producto | null>(null);
  const [productoModalImageIndex, setProductoModalImageIndex] = useState(0);
  const [imgZoomed, setImgZoomed] = useState(false);
  const [zoomOrigin, setZoomOrigin] = useState("50% 50%");
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ active: boolean; startX: number; startY: number; panX: number; panY: number } | null>(null);
  const hasDragged = useRef(false);
  const [toast, setToast] = useState<CatalogToast | null>(null);
  const sucursalRetiroId = usePickupStore((state) => state.sucursalRetiroId);
  const setSucursalRetiroId = usePickupStore((state) => state.setSucursalRetiroId);
  const canjeCart = useCartStore((state) => state.items);
  const cartAdd = useCartStore((state) => state.add);
  const cartClear = useCartStore((state) => state.clear);
  const pendingCanje = useCartStore((state) => state.pendingCanje);
  const consumePendingCanje = useCartStore((state) => state.consumePendingCanje);
  const [canjeConfirmOpen, setCanjeConfirmOpen] = useState(false);
  const [cantidadesSeleccionadas, setCantidadesSeleccionadas] = useState<Record<number, number>>({});
  const [cantidadModalCanje, setCantidadModalCanje] = useState(1);
  const [expandedProductDescriptions, setExpandedProductDescriptions] = useState<Record<number, boolean>>({});
  const [codigoCopiado, setCodigoCopiado] = useState(false);

  const productosQuery = useQuery({
    queryKey: ["productos", "canje", sucursalRetiroId],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (sucursalRetiroId) qs.set("sucursal_id", sucursalRetiroId);
      const suffix = qs.toString();
      return api.get<Producto[]>(suffix ? `/productos?${suffix}` : "/productos");
    },
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  });

  const categoriasQuery = useQuery({
    queryKey: ["productos", "categorias"],
    queryFn: () => api.get<string[]>("/productos/categorias"),
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
  });

  const sucursalesQuery = useQuery({
    queryKey: ["productos", "sucursales"],
    queryFn: () => api.get<SucursalRetiro[]>("/productos/sucursales"),
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
  });

  const productos = productosQuery.data ?? [];
  const categorias = categoriasQuery.data ?? [];
  const sucursalesRetiro = sucursalesQuery.data ?? [];
  const puntosCatalogo = useMemo(
    () =>
      productos
        .map((producto) => Number(producto.puntos_requeridos || 0))
        .filter((puntos) => Number.isFinite(puntos) && puntos > 0),
    [productos],
  );
  const puntosMin = puntosCatalogo.length ? Math.min(...puntosCatalogo) : 0;
  const puntosMax = puntosCatalogo.length ? Math.max(...puntosCatalogo) : 0;
  const puntosFiltroMin = puntosFiltro?.min ?? puntosMin;
  const puntosFiltroMax = puntosFiltro?.max ?? puntosMax;
  const puntosFiltroActivo = puntosCatalogo.length > 0 && (puntosFiltroMin > puntosMin || puntosFiltroMax < puntosMax);
  const puntosRangeSpan = Math.max(1, puntosMax - puntosMin);
  const puntosMinPercent = puntosCatalogo.length ? ((puntosFiltroMin - puntosMin) / puntosRangeSpan) * 100 : 0;
  const puntosMaxPercent = puntosCatalogo.length ? ((puntosFiltroMax - puntosMin) / puntosRangeSpan) * 100 : 100;
  const sucursalRetiroSeleccionada =
    (sucursalRetiroId ? sucursalesRetiro.find((item) => String(item.id) === sucursalRetiroId) : undefined) ||
    (sucursalesRetiro.length === 1 ? sucursalesRetiro[0] : undefined);
  const productoModalImagenes = productoModal ? getProductoImagenes(productoModal) : [];
  const productoModalImagenActual = productoModalImagenes[productoModalImageIndex] ?? productoModalImagenes[0] ?? null;
  const productoModalTieneCarousel = productoModalImagenes.length > 1;

  useEffect(() => {
    if (!sucursalesRetiro.length) return;
    if (!sucursalRetiroId || !sucursalesRetiro.some((item) => String(item.id) === sucursalRetiroId)) {
      setSucursalRetiroId(String(sucursalesRetiro[0].id));
    }
  }, [sucursalRetiroId, sucursalesRetiro]);

  useEffect(() => {
    if (!puntosCatalogo.length) {
      setPuntosFiltro(null);
      return;
    }
    setPuntosFiltro((prev) => {
      if (!prev) return null;
      const min = Math.min(Math.max(prev.min, puntosMin), puntosMax);
      const max = Math.min(Math.max(prev.max, puntosMin), puntosMax);
      const next = min > max ? { min: max, max: min } : { min, max };
      if (next.min === puntosMin && next.max === puntosMax) return null;
      if (next.min === prev.min && next.max === prev.max) return prev;
      return next;
    });
  }, [puntosCatalogo.length, puntosMax, puntosMin]);

  const conteosPorCategoria = useMemo(() => {
    const q = busquedaProducto.trim().toLowerCase();
    const base = productos.filter((p) => {
      const txt = [p.nombre, p.descripcion || "", p.categoria || ""].join(" ").toLowerCase();
      const matchSearch = !q || txt.includes(q);
      const puntos = Number(p.puntos_requeridos || 0);
      const matchRange = !puntosCatalogo.length || (puntos >= puntosFiltroMin && puntos <= puntosFiltroMax);
      return matchSearch && matchRange;
    });
    const acc: Record<string, number> = { __all: base.length };
    for (const p of base) {
      const cat = p.categoria || "";
      if (cat) acc[cat] = (acc[cat] ?? 0) + 1;
    }
    return acc;
  }, [productos, puntosCatalogo.length, puntosFiltroMax, puntosFiltroMin, busquedaProducto]);

  const filtrosActivos = useMemo(() => {
    let n = 0;
    if (categoriaActiva) n += 1;
    if (puntosFiltroActivo) n += 1;
    if (ordenProductos) n += 1;
    return n;
  }, [categoriaActiva, puntosFiltroActivo, ordenProductos]);

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
    if (!filtrosOpen) {
      if (filtrosWasOpen.current) {
        filtrosWasOpen.current = false;
        filtrosTriggerRef.current?.focus();
      }
      return;
    }
    filtrosWasOpen.current = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusId = window.setTimeout(() => filtrosPanelRef.current?.focus(), 0);

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        setFiltrosOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const panel = filtrosPanelRef.current;
      if (!panel) return;
      const focusables = panel.querySelectorAll<HTMLElement>(
        'button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      const visibles = Array.from(focusables).filter((el) => !el.hasAttribute("disabled"));
      if (!visibles.length) return;
      const first = visibles[0];
      const last = visibles[visibles.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusId);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [filtrosOpen]);

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

  // Cuando el navbar (u otro componente) pide canjear vía cartStore.requestCanje(),
  // redirigimos a la pantalla dedicada de confirmación de canje.
  useEffect(() => {
    if (!pendingCanje) return;
    consumePendingCanje();
    navigate("/carrito-canjes");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCanje]);

  const productosFiltrados = useMemo(() => {
    const q = busquedaProducto.trim().toLowerCase();
    const filtrados = productos.filter((producto) => {
      const tieneStock = productHasStock(producto);
      const coincideCategoria = !categoriaActiva || producto.categoria === categoriaActiva;
      const puntos = Number(producto.puntos_requeridos || 0);
      const coincidePuntos = !puntosCatalogo.length || (puntos >= puntosFiltroMin && puntos <= puntosFiltroMax);
      const texto = [producto.nombre, producto.descripcion || "", producto.categoria || ""].join(" ").toLowerCase();
      const coincideBusqueda = !q || texto.includes(q);
      return tieneStock && coincideCategoria && coincidePuntos && coincideBusqueda;
    });

    if (ordenProductos === "puntos-desc") {
      return [...filtrados].sort((a, b) => (b.puntos_requeridos || 0) - (a.puntos_requeridos || 0));
    }

    if (ordenProductos === "puntos-asc") {
      return [...filtrados].sort((a, b) => (a.puntos_requeridos || 0) - (b.puntos_requeridos || 0));
    }

    return filtrados;
  }, [productos, categoriaActiva, puntosCatalogo.length, puntosFiltroMax, puntosFiltroMin, busquedaProducto, ordenProductos]);

  const canjeCartItems = useMemo(() => {
    return Object.values(canjeCart).map((item) => ({
      id: item.producto_id,
      nombre: item.nombre,
      puntos_requeridos: item.puntos_requeridos,
      imagen_url: item.imagen_url,
      cantidad: item.cantidad,
      subtotal_puntos: item.puntos_requeridos * item.cantidad,
    }));
  }, [canjeCart]);

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
      cartClear();
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
    const stock = Number(producto.stock_disponible ?? 0);
    if (producto.track_stock !== false && stock <= 0) {
      setToast({
        msg: "No hay stock disponible en la sucursal seleccionada.",
        variant: "error",
        dismissLabel: "Cerrar",
        autoHideMs: 7000,
      });
      return;
    }
    cartAdd(
      {
        id: producto.id,
        nombre: producto.nombre,
        puntos_requeridos: producto.puntos_requeridos,
        imagen_url: producto.imagen_url,
      },
      cantidadSafe,
    );
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

  function actualizarPuntosMin(value: number) {
    if (!puntosCatalogo.length) return;
    setPuntosFiltro((prev) => {
      const currentMax = prev?.max ?? puntosMax;
      const min = Math.min(Math.max(value, puntosMin), currentMax);
      const next = { min, max: currentMax };
      return next.min === puntosMin && next.max === puntosMax ? null : next;
    });
  }

  function actualizarPuntosMax(value: number) {
    if (!puntosCatalogo.length) return;
    setPuntosFiltro((prev) => {
      const currentMin = prev?.min ?? puntosMin;
      const max = Math.max(Math.min(value, puntosMax), currentMin);
      const next = { min: currentMin, max };
      return next.min === puntosMin && next.max === puntosMax ? null : next;
    });
  }

  function renderPuntosRangeControl(labelledBy: string) {
    const disabled = !puntosCatalogo.length || puntosMin === puntosMax;
    return (
      <div className="catalog-range-control" aria-labelledby={labelledBy}>
        <div className="catalog-range-track" aria-hidden="true">
          <span
            className="catalog-range-fill"
            style={{
              left: `${Math.max(0, Math.min(100, puntosMinPercent))}%`,
              right: `${100 - Math.max(0, Math.min(100, puntosMaxPercent))}%`,
            }}
          />
        </div>
        <div className="catalog-range-inputs">
          <input
            type="range"
            min={puntosMin}
            max={puntosMax}
            step="1"
            value={puntosFiltroMin}
            disabled={disabled}
            onChange={(event) => actualizarPuntosMin(Number(event.target.value))}
            aria-label="Puntos minimos"
          />
          <input
            type="range"
            min={puntosMin}
            max={puntosMax}
            step="1"
            value={puntosFiltroMax}
            disabled={disabled}
            onChange={(event) => actualizarPuntosMax(Number(event.target.value))}
            aria-label="Puntos maximos"
          />
        </div>
        <div className="catalog-range-badges" aria-hidden="true">
          <span style={{ left: `${Math.max(0, Math.min(100, puntosMinPercent))}%` }}>{puntosFiltroMin} pts</span>
          <span style={{ left: `${Math.max(0, Math.min(100, puntosMaxPercent))}%` }}>{puntosFiltroMax} pts</span>
        </div>
        <div className="catalog-range-values">
          <span>{puntosMin} pts<small>min</small></span>
          <span>{puntosMax} pts<small>max</small></span>
        </div>
      </div>
    );
  }

  const productoModalSinStock = productoModal ? !productHasStock(productoModal) : false;

  return (
    <section className="catalog-page catalog-redemption-page">
      <div className="catalog-top-shell catalog-redemption-hero">
        <div className="catalog-header">
          <h1 className="catalog-title">Catalogo de productos</h1>
          <p className="catalog-subtitle">Canjea tus puntos por productos exclusivos Nande</p>
        </div>

        <div className="catalog-redemption-account">
          {isCliente ? (
            <div className="catalog-user-banner">
              <div className="catalog-user-copy">
                <span className="catalog-user-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false">
                    <path d="M12 12.4c2.7 0 4.8-2.2 4.8-4.9S14.7 2.6 12 2.6 7.2 4.8 7.2 7.5s2.1 4.9 4.8 4.9Z" />
                    <path d="M4.2 21.4c.4-4.3 3.5-7 7.8-7s7.4 2.7 7.8 7H4.2Z" />
                  </svg>
                </span>
                <div>
                  <p>
                    Hola, <strong>{user.nombre}</strong>
                  </p>
                  <p>Tus puntos disponibles</p>
                </div>
              </div>
              <div className="catalog-points-summary">
                <p className="banner-pts">{user.puntos_saldo ?? 0}</p>
                <p className="banner-pts-label">puntos</p>
              </div>
            </div>
          ) : null}

          <div className="catalog-redemption-branch-row">
            <label className="catalog-branch-select">
              <span>Sucursal de retiro</span>
              <select
                value={sucursalRetiroId}
                onChange={(event) => setSucursalRetiroId(event.target.value)}
                disabled={sucursalesQuery.isLoading || !sucursalesRetiro.length}
              >
                {sucursalesRetiro.map((sucursal) => (
                  <option key={sucursal.id} value={sucursal.id}>
                    {sucursal.nombre}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>
      <div className="catalog-products-shell">
        <div className="catalog-layout-shell">
          <aside className="catalog-sidebar" aria-label="Filtros de canjes">
            <div className="catalog-sidebar-head">
              <p className="catalog-sidebar-title">Filtros</p>
              <span>{productosFiltrados.length} {productosFiltrados.length === 1 ? "producto encontrado" : "productos encontrados"}</span>
            </div>

            <section className="catalog-filters-section">
              <h3 className="catalog-filters-section-title" id="catalog-cat-label-desktop">
                Categoria
              </h3>
              <details className="catalog-filter-dropdown">
                <summary>{categoriaActiva || "Todas"}</summary>
                <div className="catalog-filter-chips" role="radiogroup" aria-labelledby="catalog-cat-label-desktop">
                {[
                  { value: "", label: "Todas", count: conteosPorCategoria.__all ?? 0 },
                  ...categorias.map((c) => ({
                    value: c,
                    label: c,
                    count: conteosPorCategoria[c] ?? 0,
                  })),
                ].map((opt) => {
                  const checked = categoriaActiva === opt.value;
                  const isEmpty = opt.count === 0 && !checked;
                  return (
                    <label
                      key={opt.value || "__all"}
                      className={`catalog-filter-chip${checked ? " is-active" : ""}${isEmpty ? " is-empty" : ""}`}
                    >
                      <input
                        type="radio"
                        name="catalog-categoria-desktop"
                        className="catalog-filter-chip-input"
                        value={opt.value}
                        checked={checked}
                        onChange={() => setCategoriaActiva(opt.value)}
                        aria-label={`${opt.label}, ${opt.count} ${opt.count === 1 ? "producto" : "productos"}`}
                      />
                      <span className="catalog-filter-chip-label">{opt.label}</span>
                      <span className="catalog-filter-chip-count" aria-hidden="true">
                        {opt.count}
                      </span>
                    </label>
                  );
                })}
                </div>
              </details>
            </section>

            <section className="catalog-filters-section">
              <h3 className="catalog-filters-section-title" id="catalog-orden-label-desktop">
                Ordenar por
              </h3>
              <details className="catalog-filter-dropdown">
                <summary>
                  {ordenProductos === "puntos-asc"
                    ? "Menor puntaje"
                    : ordenProductos === "puntos-desc"
                      ? "Mayor puntaje"
                      : "Recomendado"}
                </summary>
                <div className="catalog-filter-chips" role="radiogroup" aria-labelledby="catalog-orden-label-desktop">
                {[
                  { value: "", label: "Recomendado" },
                  { value: "puntos-asc", label: "Menor puntaje" },
                  { value: "puntos-desc", label: "Mayor puntaje" },
                ].map((opt) => {
                  const checked = ordenProductos === opt.value;
                  return (
                    <label key={opt.value || "__rec"} className={`catalog-filter-chip${checked ? " is-active" : ""}`}>
                      <input
                        type="radio"
                        name="catalog-orden-desktop"
                        className="catalog-filter-chip-input"
                        value={opt.value}
                        checked={checked}
                        onChange={() => setOrdenProductos(opt.value)}
                      />
                      <span className="catalog-filter-chip-label">{opt.label}</span>
                    </label>
                  );
                })}
                </div>
              </details>
            </section>

            <section className="catalog-filters-section">
              <h3 className="catalog-filters-section-title" id="catalog-rango-label-desktop">
                Rango de puntos
              </h3>
              {renderPuntosRangeControl("catalog-rango-label-desktop")}
            </section>

            <button
              type="button"
              className="catalog-filter-clear catalog-sidebar-clear"
              onClick={() => {
                setCategoriaActiva("");
                setPuntosFiltro(null);
                setOrdenProductos("");
              }}
              disabled={filtrosActivos === 0}
            >
              Limpiar filtros
            </button>
          </aside>

          <div className="catalog-results-column">
        {!loading ? (
          <div className="catalog-filters">
            <div className="catalog-filter-search">
              <input
                className="catalog-filter-search-input"
                placeholder="Buscar producto..."
                value={busquedaProducto}
                onChange={(event) => setBusquedaProducto(event.target.value)}
                aria-label="Buscar producto"
              />
            </div>

            <div className="catalog-filters-bar">
              <button
                ref={filtrosTriggerRef}
                type="button"
                className={`catalog-filters-trigger${filtrosActivos > 0 ? " has-active" : ""}`}
                aria-haspopup="dialog"
                aria-expanded={filtrosOpen}
                aria-controls="catalog-filters-panel"
                onClick={() => setFiltrosOpen(true)}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="4" y1="6" x2="20" y2="6" />
                  <circle cx="9" cy="6" r="2" />
                  <line x1="4" y1="12" x2="20" y2="12" />
                  <circle cx="15" cy="12" r="2" />
                  <line x1="4" y1="18" x2="20" y2="18" />
                  <circle cx="9" cy="18" r="2" />
                </svg>
                <span>Filtros</span>
                {filtrosActivos > 0 ? (
                  <span
                    className="catalog-filters-trigger-badge"
                    aria-label={`${filtrosActivos} filtros activos`}
                  >
                    {filtrosActivos}
                  </span>
                ) : null}
              </button>

              <span
                className="catalog-filter-results"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {productosFiltrados.length}{" "}
                {productosFiltrados.length === 1 ? "producto" : "productos"}
              </span>
            </div>
          </div>
        ) : null}
        {filtrosOpen ? (
          <div
            className="catalog-filters-overlay"
            onClick={() => setFiltrosOpen(false)}
          >
            <div
              ref={filtrosPanelRef}
              id="catalog-filters-panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby="catalog-filters-title"
              tabIndex={-1}
              className="catalog-filters-panel"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="catalog-filters-panel-header">
                <h2 id="catalog-filters-title" className="catalog-filters-panel-title">
                  Filtros
                </h2>
                <button
                  type="button"
                  className="catalog-filters-panel-close"
                  aria-label="Cerrar filtros"
                  onClick={() => setFiltrosOpen(false)}
                >
                  ✕
                </button>
              </header>

              <div className="catalog-filters-panel-body">
                <section className="catalog-filters-section">
                  <h3 className="catalog-filters-section-title" id="catalog-cat-label">
                    Categoría
                  </h3>
                  <div
                    className="catalog-filter-chips"
                    role="radiogroup"
                    aria-labelledby="catalog-cat-label"
                  >
                    {[
                      { value: "", label: "Todas", count: conteosPorCategoria.__all ?? 0 },
                      ...categorias.map((c) => ({
                        value: c,
                        label: c,
                        count: conteosPorCategoria[c] ?? 0,
                      })),
                    ].map((opt) => {
                      const checked = categoriaActiva === opt.value;
                      const isEmpty = opt.count === 0 && !checked;
                      return (
                        <label
                          key={opt.value || "__all"}
                          className={`catalog-filter-chip${checked ? " is-active" : ""}${
                            isEmpty ? " is-empty" : ""
                          }`}
                        >
                          <input
                            type="radio"
                            name="catalog-categoria"
                            className="catalog-filter-chip-input"
                            value={opt.value}
                            checked={checked}
                            onChange={() => setCategoriaActiva(opt.value)}
                            aria-label={`${opt.label}, ${opt.count} ${
                              opt.count === 1 ? "producto" : "productos"
                            }`}
                          />
                          <span className="catalog-filter-chip-label">{opt.label}</span>
                          <span className="catalog-filter-chip-count" aria-hidden="true">
                            {opt.count}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </section>

                <section className="catalog-filters-section">
                  <h3 className="catalog-filters-section-title" id="catalog-orden-label">
                    Ordenar por
                  </h3>
                  <div
                    className="catalog-filter-chips"
                    role="radiogroup"
                    aria-labelledby="catalog-orden-label"
                  >
                    {[
                      { value: "", label: "Recomendado" },
                      { value: "puntos-asc", label: "Menor puntaje" },
                      { value: "puntos-desc", label: "Mayor puntaje" },
                    ].map((opt) => {
                      const checked = ordenProductos === opt.value;
                      return (
                        <label
                          key={opt.value || "__rec"}
                          className={`catalog-filter-chip${checked ? " is-active" : ""}`}
                        >
                          <input
                            type="radio"
                            name="catalog-orden"
                            className="catalog-filter-chip-input"
                            value={opt.value}
                            checked={checked}
                            onChange={() => setOrdenProductos(opt.value)}
                          />
                          <span className="catalog-filter-chip-label">{opt.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </section>

                <section className="catalog-filters-section">
                  <h3 className="catalog-filters-section-title" id="catalog-rango-label">
                    Rango de puntos
                  </h3>
                  {renderPuntosRangeControl("catalog-rango-label")}
                </section>
              </div>

              <footer className="catalog-filters-panel-footer">
                <button
                  type="button"
                  className="catalog-filter-clear"
                  onClick={() => {
                    setCategoriaActiva("");
                    setPuntosFiltro(null);
                    setOrdenProductos("");
                  }}
                  disabled={filtrosActivos === 0}
                >
                  Limpiar todo
                </button>
                <button
                  type="button"
                  className="catalog-filters-panel-apply"
                  onClick={() => setFiltrosOpen(false)}
                >
                  Ver {productosFiltrados.length}{" "}
                  {productosFiltrados.length === 1 ? "producto" : "productos"}
                </button>
              </footer>
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

            {productosFiltrados.map((producto) => {
              const descripcion = producto.descripcion || "Producto disponible para canje.";
              const descripcionLarga = descripcion.length > 82;
              const descripcionExpandida = Boolean(expandedProductDescriptions[producto.id]);
              const imagenesProducto = getProductoImagenes(producto);
              const tieneCarouselCard = imagenesProducto.length > 1;
              const stock = Number(producto.stock_disponible ?? 0);
              const sinStock = !productHasStock(producto);
              const cantidadSeleccionada = getCantidadSeleccionada(producto.id);

              return (
              <div key={producto.id} className={`product-card ${descripcionExpandida ? "product-card-expanded" : ""}`}>
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
                  {tieneCarouselCard ? (
                    <>
                      <span className="product-card-media-indicator" aria-hidden="true">
                        1/{imagenesProducto.length}
                      </span>
                      <span className="product-card-media-dots" aria-hidden="true">
                        {imagenesProducto.map((imagen, index) => (
                          <span
                            key={`${imagen}-${index}`}
                            className={`product-card-media-dot${index === 0 ? " active" : ""}`}
                          />
                        ))}
                      </span>
                    </>
                  ) : null}
                </button>

                  {producto.categoria ? <span className="product-card-cat">{producto.categoria}</span> : null}

                <div className="product-card-body">
                  <p className="product-card-name">{producto.nombre}</p>
                  <div className="product-card-desc-wrap">
                    <p className={`product-card-desc ${descripcionLarga && !descripcionExpandida ? "is-collapsed" : "is-expanded"}`}>
                      {descripcion}
                    </p>
                    {descripcionLarga ? (
                      <button
                        type="button"
                        className="product-card-desc-toggle"
                        onClick={() =>
                          setExpandedProductDescriptions((prev) => ({
                            ...prev,
                            [producto.id]: !prev[producto.id],
                          }))
                        }
                      >
                        {descripcionExpandida ? "Ver menos" : "Ver más"}
                      </button>
                    ) : null}
                  </div>

                  <div className="product-card-points">
                    <div className="product-card-row product-card-points-tile">
                      <span className="product-points-copy">
                        <span>Canje:</span>
                        <span className="cost">{producto.puntos_requeridos} pts</span>
                      </span>
                    </div>
                    {producto.puntos_acumulables ? (
                      <>
                        <div className="product-card-divider" />
                        <div className="product-card-row product-card-points-tile">
                          <span className="product-points-copy">
                            <span className="product-card-points-label">
                              Suma:
                              <button
                                type="button"
                                className="product-points-info"
                                aria-label="Estos son los puntos que sumas al comprar el producto en la tienda"
                              >
                                i
                                <span className="product-points-info-bubble">
                                  Estos son los puntos que sumas al comprar el producto en la tienda.
                                </span>
                              </button>
                            </span>
                            <span className="earn">+{producto.puntos_acumulables} pts</span>
                          </span>
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
                      <div className="product-card-qty">
                        <button
                          type="button"
                          className="vendedor-round-btn"
                          disabled={canjearCarritoMutation.isPending || cantidadSeleccionada <= 1}
                          onClick={() => ajustarCantidadSeleccionada(producto.id, -1)}
                        >
                          -
                        </button>
                        <span style={{ minWidth: "28px", textAlign: "center", fontWeight: 700, color: "#4A2C1A" }}>
                          {cantidadSeleccionada}
                        </span>
                        <button
                          type="button"
                          className="vendedor-round-btn"
                          disabled={canjearCarritoMutation.isPending || cantidadSeleccionada >= 100}
                          onClick={() => ajustarCantidadSeleccionada(producto.id, +1)}
                        >
                          +
                        </button>
                      </div>
                      <button
                        className="product-card-btn product-card-btn-canjear"
                        style={{ marginTop: "0.5rem" }}
                        disabled={canjearCarritoMutation.isPending || sinStock}
                        onClick={() =>
                          agregarProductoAlCarrito(
                            producto,
                            () =>
                              setCantidadesSeleccionadas((prev) => {
                                const next = { ...prev };
                                delete next[producto.id];
                                return next;
                              }),
                            cantidadSeleccionada
                          )
                        }
                      >
                        {sinStock ? "Sin stock" : "Agregar al carrito"}
                      </button>
                    </>
                  ) : (
                    <Link to="/login" className="product-card-btn product-card-btn-login" style={{ marginTop: "0.5rem" }}>
                      Iniciar sesion para canjear
                    </Link>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        )}
          </div>
        </div>
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
                    &lt;
                  </button>
                  <button
                    type="button"
                    className="producto-carousel-btn producto-carousel-btn-next"
                    onClick={() => cambiarImagenModal(productoModalImageIndex + 1)}
                    aria-label="Ver imagen siguiente"
                  >
                    &gt;
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
                      <span className="product-card-points-label">
                        Puntos que sumas al comprar
                        <button
                          type="button"
                          className="product-points-info"
                          aria-label="Estos son los puntos que sumas al comprar el producto en la tienda"
                        >
                          i
                          <span className="product-points-info-bubble">
                            Estos son los puntos que sumas al comprar el producto en la tienda.
                          </span>
                        </button>
                      </span>
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
                      disabled={cantidadModalCanje <= 1}
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
                      disabled={cantidadModalCanje >= 100}
                      onClick={() => setCantidadModalCanje((prev) => Math.min(100, prev + 1))}
                    >
                      +
                    </button>
                  </div>
                  <button
                    className="product-card-btn product-card-btn-canjear"
                    disabled={canjearCarritoMutation.isPending || productoModalSinStock}
                    onClick={() => agregarProductoAlCarrito(productoModal, () => setProductoModal(null), cantidadModalCanje)}
                  >
                    {productoModalSinStock ? "Sin stock" : `Agregar ${cantidadModalCanje > 1 ? `${cantidadModalCanje} al carrito` : "al carrito"}`}
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

