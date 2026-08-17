import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../../api";
import { CatalogPagination } from "../../components/CatalogPagination";
import { CATALOG_PRODUCTS_PER_PAGE } from "../../lib/catalogPagination";
import { mediaUrl, mediaCardSrcSet, CARD_IMG_SIZES, dropSrcSetOnError } from "../../lib/apiBase";
import { useAuthStore } from "../../store/authStore";
import { usePickupStore } from "../../store/pickupStore";
import type { Producto } from "../../types";

function money(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(Number.isFinite(n) ? n : 0);
}

function productImage(producto: Producto): string | null {
  if (producto.imagen_url) return mediaUrl(producto.imagen_url);
  if (producto.imagenes?.length) return mediaUrl(producto.imagenes[0]);
  return null;
}

function productImages(producto: Producto): string[] {
  const imagenes = producto.imagenes?.filter(Boolean) ?? [];
  if (imagenes.length) return imagenes.map(mediaUrl);
  return producto.imagen_url ? [mediaUrl(producto.imagen_url)] : [];
}

type SucursalRetiro = {
  id: number;
  nombre: string;
  direccion: string;
  piso?: string | null;
  localidad: string;
  provincia: string;
};

type OnlineCartItem = {
  id: number;
  producto_id: number;
  cantidad: number;
  modo_compra: "dinero" | "puntos";
  config_hash?: string;
  precio_dinero_unit: number | null;
  puntaje_al_comprar_unitario?: number | null;
  subtotal_dinero: number;
  nombre: string;
  imagen_url: string | null;
  configuracion_tipo?: "simple" | "caja_sabores";
  capacidad_sabores?: number | null;
  sabores?: Array<{
    sabor_id: number;
    nombre: string;
    cantidad: number;
  }>;
};

type OnlineCartResponse = {
  items: OnlineCartItem[];
  resumen: {
    total_items: number;
    total_unidades: number;
    total_dinero: number;
    total_puntos: number;
    total_puntos_ganados?: number;
  };
};

const DEFAULT_SELECTABLE_QUANTITY_LIMIT = 100;
const MAX_SELECTABLE_QUANTITY_LIMIT = 100000;
const LOGIN_CART_NOTICE = "Para agregar un producto al carrito debe de iniciar sesion.";

function productPrice(producto: Producto): number {
  const n = Number(producto.precio_dinero ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function productOriginalPrice(producto: Producto): number {
  const n = Number(producto.precio_dinero_original ?? producto.precio_dinero_lista ?? producto.precio_dinero ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function productDiscount(producto: Producto): number {
  const n = Number(producto.descuento_porcentaje_aplicado ?? 0);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function productEventbarPromo(producto: Producto): {
  label: string;
  requiredQuantity: number;
  paidQuantity: number;
  effectiveUnitPrice: number;
  packPrice: number;
} | null {
  const requiredQuantity = Number(producto.promo_eventbar_cantidad_requerida ?? 0);
  const paidQuantity = Number(producto.promo_eventbar_cantidad_paga ?? 0);
  const effectiveUnitPrice = Number(producto.promo_eventbar_precio_efectivo ?? 0);
  const packPrice = Number(producto.promo_eventbar_precio_pack ?? 0);
  if (!producto.promo_eventbar_activa || requiredQuantity <= 0 || paidQuantity <= 0 || effectiveUnitPrice <= 0) {
    return null;
  }
  return {
    label: producto.promo_eventbar_label || producto.promo_eventbar_tipo?.toUpperCase() || `${requiredQuantity}X${paidQuantity}`,
    requiredQuantity,
    paidQuantity,
    effectiveUnitPrice,
    packPrice: Number.isFinite(packPrice) && packPrice > 0 ? packPrice : productPrice(producto) * paidQuantity,
  };
}

function productDisplayPrice(producto: Producto): number {
  return productEventbarPromo(producto)?.effectiveUnitPrice ?? productPrice(producto);
}

function productPromotionalSubtotal(producto: Producto, quantity: number): number {
  const qty = Math.max(0, Math.floor(Number(quantity || 0)));
  const unitPrice = productPrice(producto);
  const promo = productEventbarPromo(producto);
  if (!promo || qty <= 0 || unitPrice <= 0) return unitPrice * qty;
  const promoGroups = Math.floor(qty / promo.requiredQuantity);
  const remainder = qty % promo.requiredQuantity;
  const chargedQuantity = promoGroups * promo.paidQuantity + remainder;
  return unitPrice * chargedQuantity;
}

function hasFreeShipping(producto: Producto): boolean {
  return Boolean(producto.permite_envio && producto.envio_gratis);
}

function productHasStock(producto: Producto): boolean {
  if (isCajaSabores(producto)) {
    const capacity = Number(producto.capacidad_sabores ?? 0);
    const available = (producto.sabores_disponibles ?? []).reduce(
      (acc, sabor) => acc + Math.max(0, Number(sabor.stock_disponible ?? 0)),
      0,
    );
    return capacity > 0 && available >= capacity;
  }
  return producto.track_stock === false || Number(producto.stock_disponible ?? 0) > 0;
}

function productAvailableStock(producto: Producto): number {
  const stock = Number(producto.stock_disponible ?? 0);
  return Number.isFinite(stock) ? Math.max(0, Math.floor(stock)) : 0;
}

function productPurchaseLimit(producto: Producto): number {
  if (producto.limite_compra === null) return MAX_SELECTABLE_QUANTITY_LIMIT;
  const limit = Number(producto.limite_compra ?? DEFAULT_SELECTABLE_QUANTITY_LIMIT);
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_SELECTABLE_QUANTITY_LIMIT;
  return Math.min(MAX_SELECTABLE_QUANTITY_LIMIT, Math.floor(limit));
}

function maxSelectableQuantity(producto: Producto): number {
  if (isCajaSabores(producto)) return 1;
  const limit = productPurchaseLimit(producto);
  if (producto.track_stock === false) return limit;
  return Math.max(1, Math.min(limit, productAvailableStock(producto)));
}

function stockLimitMessage(producto: Producto, maxCantidad: number): string | null {
  const stock = productAvailableStock(producto);
  const profileLimit = productPurchaseLimit(producto);
  if (producto.track_stock !== false && stock <= profileLimit) {
    return `El stock maximo disponible para este producto en este momento es de ${maxCantidad} unidades.`;
  }
  return null;
}

function isCajaSabores(producto: Producto): boolean {
  return producto.configuracion_tipo === "caja_sabores";
}

export function TiendaOnline() {
  const user = useAuthStore((state) => state.user);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [categoriaActiva, setCategoriaActiva] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [ordenProductos, setOrdenProductos] = useState("");
  const [precioFiltro, setPrecioFiltro] = useState<{ min: number; max: number } | null>(null);
  const [filtrosOpen, setFiltrosOpen] = useState(false);
  const filtrosTriggerRef = useRef<HTMLButtonElement>(null);
  const filtrosPanelRef = useRef<HTMLDivElement>(null);
  const filtrosWasOpen = useRef(false);
  const resultsColumnRef = useRef<HTMLDivElement>(null);
  const [productosPage, setProductosPage] = useState(1);
  const [toast, setToast] = useState<string | null>(null);
  const [cantidadesSeleccionadas, setCantidadesSeleccionadas] = useState<Record<number, string>>({});
  const [saboresCajaDraft, setSaboresCajaDraft] = useState<Record<number, Record<number, number>>>({});
  const [productoModal, setProductoModal] = useState<Producto | null>(null);
  const [productoModalImageIndex, setProductoModalImageIndex] = useState(0);
  const [imgZoomed, setImgZoomed] = useState(false);
  const [zoomOrigin, setZoomOrigin] = useState("50% 50%");
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ active: boolean; startX: number; startY: number; panX: number; panY: number } | null>(null);
  const hasDragged = useRef(false);
  const sucursalId = usePickupStore((state) => state.sucursalRetiroId);
  const setSucursalId = usePickupStore((state) => state.setSucursalRetiroId);

  const productosQuery = useQuery({
    queryKey: ["productos", "venta", sucursalId],
    queryFn: () => {
      const qs = new URLSearchParams({ modo: "venta" });
      if (sucursalId) qs.set("sucursal_id", sucursalId);
      return api.get<Producto[]>(`/productos?${qs.toString()}`);
    },
    staleTime: 0,
    refetchOnMount: true,
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  });

  const sucursalesQuery = useQuery({
    queryKey: ["productos", "sucursales"],
    queryFn: () => api.get<SucursalRetiro[]>("/productos/sucursales"),
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
  });

  const productos = productosQuery.data ?? [];
  const productoUrlId = searchParams.get("producto");
  const openedProductUrlIdRef = useRef<string | null>(null);
  const dismissedProductUrlIdRef = useRef<string | null>(null);
  const sucursales = sucursalesQuery.data ?? [];
  const preciosCatalogo = useMemo(
    () => productos.map(productDisplayPrice).filter((precio) => Number.isFinite(precio) && precio > 0),
    [productos],
  );
  const precioMin = preciosCatalogo.length ? Math.min(...preciosCatalogo) : 0;
  const precioMax = preciosCatalogo.length ? Math.max(...preciosCatalogo) : 0;
  const precioFiltroMin = precioFiltro?.min ?? precioMin;
  const precioFiltroMax = precioFiltro?.max ?? precioMax;
  const precioFiltroActivo = preciosCatalogo.length > 0 && (precioFiltroMin > precioMin || precioFiltroMax < precioMax);
  const precioRangeSpan = Math.max(1, precioMax - precioMin);
  const precioMinPercent = preciosCatalogo.length ? ((precioFiltroMin - precioMin) / precioRangeSpan) * 100 : 0;
  const precioMaxPercent = preciosCatalogo.length ? ((precioFiltroMax - precioMin) / precioRangeSpan) * 100 : 100;
  const productoModalImagenes = productoModal ? productImages(productoModal) : [];
  const productoModalImagenActual = productoModalImagenes[productoModalImageIndex] ?? productoModalImagenes[0] ?? null;
  const productoModalTieneCarousel = productoModalImagenes.length > 1;
  const productoModalEventbarPromo = productoModal ? productEventbarPromo(productoModal) : null;

  useEffect(() => {
    if (!productoUrlId) {
      openedProductUrlIdRef.current = null;
      dismissedProductUrlIdRef.current = null;
      return;
    }
    if (dismissedProductUrlIdRef.current === productoUrlId) return;
    if (openedProductUrlIdRef.current === productoUrlId) return;

    const id = Number(productoUrlId);
    if (!Number.isFinite(id)) return;
    const producto = productos.find((item) => Number(item.id) === id);
    if (!producto) return;
    openedProductUrlIdRef.current = productoUrlId;
    openProductoModal(producto);
  }, [productoUrlId, productos]);

  useEffect(() => {
    if (!sucursales.length) return;
    if (!sucursalId || !sucursales.some((sucursal) => String(sucursal.id) === sucursalId)) {
      setSucursalId(String(sucursales[0].id));
    }
  }, [sucursalId, sucursales]);

  useEffect(() => {
    if (!productoModal) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeProductoModal();
      if (event.key === "ArrowLeft" && productoModalTieneCarousel) cambiarImagenModal(productoModalImageIndex - 1);
      if (event.key === "ArrowRight" && productoModalTieneCarousel) cambiarImagenModal(productoModalImageIndex + 1);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [productoModal, productoModalImageIndex, productoModalTieneCarousel]);

  const categorias = useMemo(
    () => Array.from(new Set(productos.map((p) => p.categoria).filter((c): c is string => Boolean(c)))).sort(),
    [productos],
  );

  useEffect(() => {
    if (!preciosCatalogo.length) {
      setPrecioFiltro(null);
      return;
    }
    setPrecioFiltro((prev) => {
      if (!prev) return null;
      const min = Math.min(Math.max(prev.min, precioMin), precioMax);
      const max = Math.min(Math.max(prev.max, precioMin), precioMax);
      const next = min > max ? { min: max, max: min } : { min, max };
      if (next.min === precioMin && next.max === precioMax) return null;
      if (next.min === prev.min && next.max === prev.max) return prev;
      return next;
    });
  }, [precioMin, precioMax, preciosCatalogo.length]);

  const filtrosActivos = useMemo(() => {
    let n = 0;
    if (categoriaActiva) n += 1;
    if (ordenProductos) n += 1;
    if (precioFiltroActivo) n += 1;
    return n;
  }, [categoriaActiva, ordenProductos, precioFiltroActivo]);

  const baseSearch = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return productos.filter((producto) => {
      if (!productHasStock(producto)) return false;
      const text = [producto.nombre, producto.descripcion ?? "", producto.categoria ?? ""].join(" ").toLowerCase();
      return !q || text.includes(q);
    });
  }, [busqueda, productos]);

  const conteosPorCategoria = useMemo(() => {
    const base = baseSearch.filter((producto) => {
      const precio = productDisplayPrice(producto);
      return !preciosCatalogo.length || (precio >= precioFiltroMin && precio <= precioFiltroMax);
    });
    const acc: Record<string, number> = { __all: base.length };
    for (const producto of base) {
      const cat = producto.categoria || "";
      if (cat) acc[cat] = (acc[cat] ?? 0) + 1;
    }
    return acc;
  }, [baseSearch, precioFiltroMax, precioFiltroMin, preciosCatalogo.length]);

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

  const productosFiltrados = useMemo(() => {
    const filtrados = baseSearch.filter((producto) => {
      const categoriaOk = !categoriaActiva || producto.categoria === categoriaActiva;
      const precio = productDisplayPrice(producto);
      const precioOk = !preciosCatalogo.length || (precio >= precioFiltroMin && precio <= precioFiltroMax);
      return categoriaOk && precioOk;
    });

    if (ordenProductos === "precio-asc") {
      return [...filtrados].sort((a, b) => productDisplayPrice(a) - productDisplayPrice(b));
    }
    if (ordenProductos === "precio-desc") {
      return [...filtrados].sort((a, b) => productDisplayPrice(b) - productDisplayPrice(a));
    }
    if (ordenProductos === "nombre-asc") {
      return [...filtrados].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    }

    return filtrados;
  }, [baseSearch, categoriaActiva, ordenProductos, precioFiltroMax, precioFiltroMin, preciosCatalogo.length]);

  const productosTotalPages = Math.max(1, Math.ceil(productosFiltrados.length / CATALOG_PRODUCTS_PER_PAGE));
  const productosPageSafe = Math.min(productosPage, productosTotalPages);
  const productosPaginaActual = useMemo(() => {
    const start = (productosPageSafe - 1) * CATALOG_PRODUCTS_PER_PAGE;
    return productosFiltrados.slice(start, start + CATALOG_PRODUCTS_PER_PAGE);
  }, [productosFiltrados, productosPageSafe]);

  useEffect(() => {
    setProductosPage(1);
  }, [busqueda, categoriaActiva, ordenProductos, precioFiltroMin, precioFiltroMax, sucursalId]);

  useEffect(() => {
    setProductosPage((prev) => Math.min(prev, productosTotalPages));
  }, [productosTotalPages]);

  function cambiarPaginaProductos(nextPage: number) {
    setProductosPage(Math.min(Math.max(1, nextPage), productosTotalPages));
    window.requestAnimationFrame(() => {
      resultsColumnRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function getCantidadInputValue(productoId: number): string {
    return Object.prototype.hasOwnProperty.call(cantidadesSeleccionadas, productoId)
      ? cantidadesSeleccionadas[productoId]
      : "1";
  }

  function getCantidadSeleccionada(productoId: number): number {
    const value = Math.floor(Number(getCantidadInputValue(productoId)));
    return Number.isInteger(value) && value >= 1 ? value : 0;
  }

  function openProductoModal(producto: Producto) {
    setProductoModal(producto);
    setProductoModalImageIndex(0);
    setImgZoomed(false);
    setZoomOrigin("50% 50%");
    setPan({ x: 0, y: 0 });
  }

  function closeProductoModal() {
    if (productoUrlId) {
      dismissedProductUrlIdRef.current = productoUrlId;
      openedProductUrlIdRef.current = productoUrlId;
    }
    setProductoModal(null);
    setProductoModalImageIndex(0);
    setImgZoomed(false);
    setZoomOrigin("50% 50%");
    setPan({ x: 0, y: 0 });
    dragRef.current = null;
    hasDragged.current = false;
    if (searchParams.has("producto")) {
      const next = new URLSearchParams(searchParams);
      next.delete("producto");
      setSearchParams(next, { replace: true });
    }
  }

  function cambiarImagenModal(index: number) {
    if (!productoModalImagenes.length) return;
    const nextIndex = (index + productoModalImagenes.length) % productoModalImagenes.length;
    setProductoModalImageIndex(nextIndex);
    setImgZoomed(false);
    setZoomOrigin("50% 50%");
    setPan({ x: 0, y: 0 });
    dragRef.current = null;
    hasDragged.current = false;
  }

  function actualizarCantidadSeleccionada(producto: Producto, rawValue: string | number) {
    const raw = String(rawValue);
    if (raw.trim() === "") {
      setCantidadesSeleccionadas((prev) => ({ ...prev, [producto.id]: "" }));
      return;
    }

    const parsed = Math.floor(Number(raw));
    if (!Number.isFinite(parsed)) return;

    const max = maxSelectableQuantity(producto);
    const next = Math.max(0, Math.min(max, parsed));
    if (parsed > max) {
      const message = stockLimitMessage(producto, max);
      if (message) setToast(message);
    }

    setCantidadesSeleccionadas((prev) => {
      return { ...prev, [producto.id]: String(next) };
    });
  }

  function cajaDraft(producto: Producto): Record<number, number> {
    return saboresCajaDraft[producto.id] ?? {};
  }

  function cajaSeleccionTotal(producto: Producto): number {
    return Object.values(cajaDraft(producto)).reduce((acc, value) => acc + Number(value || 0), 0);
  }

  function cajaCapacidad(producto: Producto): number {
    return Math.max(0, Number(producto.capacidad_sabores ?? 0));
  }

  function cajaSaboresPayload(producto: Producto) {
    return Object.entries(cajaDraft(producto))
      .map(([saborId, cantidad]) => ({ sabor_id: Number(saborId), cantidad: Number(cantidad) }))
      .filter((item) => Number.isInteger(item.sabor_id) && item.sabor_id > 0 && item.cantidad > 0)
      .sort((a, b) => a.sabor_id - b.sabor_id);
  }

  function cajaSeleccionCompleta(producto: Producto): boolean {
    return isCajaSabores(producto) && cajaCapacidad(producto) > 0 && cajaSeleccionTotal(producto) === cajaCapacidad(producto);
  }

  function ajustarSaborCaja(producto: Producto, saborId: number, delta: number) {
    const capacidad = cajaCapacidad(producto);
    const sabor = producto.sabores_disponibles?.find((item) => Number(item.id) === Number(saborId));
    const disponible = Math.max(0, Number(sabor?.stock_disponible ?? 0));
    setSaboresCajaDraft((prev) => {
      const current = prev[producto.id] ?? {};
      const actual = Number(current[saborId] ?? 0);
      const totalActual = Object.values(current).reduce((acc, value) => acc + Number(value || 0), 0);
      const maxByBox = Math.max(0, capacidad - (totalActual - actual));
      const nextQty = Math.max(0, Math.min(disponible, maxByBox, actual + delta));
      const nextProduct = { ...current };
      if (nextQty > 0) nextProduct[saborId] = nextQty;
      else delete nextProduct[saborId];
      return { ...prev, [producto.id]: nextProduct };
    });
  }

  const addMutation = useMutation({
    mutationFn: ({
      productoId,
      cantidad,
      sucursalId,
      sabores,
    }: {
      productoId: number;
      cantidad: number;
      sucursalId: number | null;
      sabores?: Array<{ sabor_id: number; cantidad: number }>;
    }) =>
      api.post<{ ok: true }>("/cliente/carrito/items", {
        producto_id: productoId,
        cantidad,
        modo_compra: "dinero",
        sucursal_id: sucursalId,
        sabores,
      }),
    onMutate: async ({ productoId, cantidad, sabores }) => {
      await queryClient.cancelQueries({ queryKey: ["cliente", "carrito-online"] });
      const previousCart = queryClient.getQueryData<OnlineCartResponse>(["cliente", "carrito-online"]);
      if (sabores?.length) return { previousCart };
      const producto = productos.find((item) => item.id === productoId);
      if (producto) {
        queryClient.setQueryData<OnlineCartResponse>(["cliente", "carrito-online"], (current) => {
          const base = current ?? {
            items: [],
            resumen: { total_items: 0, total_unidades: 0, total_dinero: 0, total_puntos: 0 },
          };
          const existingIndex = base.items.findIndex((item) => item.producto_id === productoId && item.modo_compra === "dinero");
          const precio = productPrice(producto);
          const items = [...base.items];
          if (existingIndex >= 0) {
            const existing = items[existingIndex];
            const nuevaCantidad = existing.cantidad + cantidad;
            items[existingIndex] = {
              ...existing,
              cantidad: nuevaCantidad,
              subtotal_dinero: productPromotionalSubtotal(producto, nuevaCantidad),
            };
          } else {
            items.push({
              id: -productoId,
              producto_id: productoId,
              cantidad,
              modo_compra: "dinero",
              precio_dinero_unit: precio,
              puntaje_al_comprar_unitario: producto.puntaje_al_comprar ?? 0,
              subtotal_dinero: productPromotionalSubtotal(producto, cantidad),
              nombre: producto.nombre,
              imagen_url: productImage(producto),
            });
          }
          const totalUnidades = items
            .filter((item) => item.modo_compra === "dinero")
            .reduce((acc, item) => acc + Number(item.cantidad ?? 0), 0);
          const totalDinero = items
            .filter((item) => item.modo_compra === "dinero")
            .reduce((acc, item) => acc + Number(item.subtotal_dinero ?? 0), 0);
          return {
            items,
            resumen: {
              ...base.resumen,
              total_items: items.length,
              total_unidades: totalUnidades,
              total_dinero: totalDinero,
            },
          };
        });
      }
      return { previousCart };
    },
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["cliente", "carrito-online"] });
      setCantidadesSeleccionadas((prev) => {
        const next = { ...prev };
        delete next[variables.productoId];
        return next;
      });
      setSaboresCajaDraft((prev) => {
        const next = { ...prev };
        delete next[variables.productoId];
        return next;
      });
      setToast(
        variables.sabores?.length
          ? "Caja personalizada agregada al carrito."
          : variables.cantidad > 1
          ? `${variables.cantidad} productos agregados al carrito.`
          : "Producto agregado al carrito.",
      );
      window.setTimeout(() => setToast(null), 2600);
    },
    onError: (error: Error, _variables, context) => {
      if (context?.previousCart) {
        queryClient.setQueryData(["cliente", "carrito-online"], context.previousCart);
      }
      setToast(error.message);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["cliente", "carrito-online"] }),
  });

  function agregar(producto: Producto, cantidad: number) {
    if (!user || user.rol !== "cliente") {
      navigate("/login", {
        state: {
          from: `${location.pathname}${location.search}`,
          loginNotice: LOGIN_CART_NOTICE,
        },
      });
      return;
    }
    if (!Number.isInteger(cantidad) || cantidad < 1) {
      setToast("Elegi una cantidad mayor o igual a 1.");
      return;
    }
    const maxCantidad = maxSelectableQuantity(producto);
    if (cantidad > maxCantidad) {
      const message = stockLimitMessage(producto, maxCantidad);
      if (message) setToast(message);
      return;
    }
    if (isCajaSabores(producto)) {
      if (!sucursalId) {
        setToast("Selecciona una sucursal para validar stock de sabores.");
        return;
      }
      if (!cajaSeleccionCompleta(producto)) {
        setToast(`Elegi exactamente ${cajaCapacidad(producto)} sabores para esta caja.`);
        return;
      }
      addMutation.mutate({
        productoId: producto.id,
        cantidad: 1,
        sucursalId: Number(sucursalId),
        sabores: cajaSaboresPayload(producto),
      });
      return;
    }
    if (producto.track_stock !== false && !sucursalId) {
      setToast("Selecciona una sucursal para validar stock.");
      return;
    }
    const disponible = productAvailableStock(producto);
    if (producto.track_stock !== false && cantidad > disponible) {
      setToast(`Solo hay ${disponible} unidades disponibles en la sucursal seleccionada.`);
      return;
    }
    addMutation.mutate({
      productoId: producto.id,
      cantidad,
      sucursalId: sucursalId ? Number(sucursalId) : null,
    });
  }

  function shouldIgnoreCardOpen(target: EventTarget | null): boolean {
    return target instanceof Element && Boolean(target.closest("button, a, input, select, textarea, label"));
  }

  function actualizarPrecioMin(value: number) {
    if (!preciosCatalogo.length) return;
    setPrecioFiltro((prev) => {
      const currentMax = prev?.max ?? precioMax;
      const min = Math.min(Math.max(value, precioMin), currentMax);
      const next = { min, max: currentMax };
      return next.min === precioMin && next.max === precioMax ? null : next;
    });
  }

  function actualizarPrecioMax(value: number) {
    if (!preciosCatalogo.length) return;
    setPrecioFiltro((prev) => {
      const currentMin = prev?.min ?? precioMin;
      const max = Math.max(Math.min(value, precioMax), currentMin);
      const next = { min: currentMin, max };
      return next.min === precioMin && next.max === precioMax ? null : next;
    });
  }

  function renderPrecioRangeControl(labelledBy: string) {
    const disabled = !preciosCatalogo.length || precioMin === precioMax;
    return (
      <div className="catalog-range-control" aria-labelledby={labelledBy}>
        <div className="catalog-range-track" aria-hidden="true">
          <span
            className="catalog-range-fill"
            style={{
              left: `${Math.max(0, Math.min(100, precioMinPercent))}%`,
              right: `${100 - Math.max(0, Math.min(100, precioMaxPercent))}%`,
            }}
          />
        </div>
        <div className="catalog-range-inputs">
          <input
            type="range"
            min={precioMin}
            max={precioMax}
            step="1"
            value={precioFiltroMin}
            disabled={disabled}
            onChange={(event) => actualizarPrecioMin(Number(event.target.value))}
            aria-label="Precio minimo"
          />
          <input
            type="range"
            min={precioMin}
            max={precioMax}
            step="1"
            value={precioFiltroMax}
            disabled={disabled}
            onChange={(event) => actualizarPrecioMax(Number(event.target.value))}
            aria-label="Precio maximo"
          />
        </div>
        <div className="catalog-range-badges" aria-hidden="true">
          <span style={{ left: `${Math.max(0, Math.min(100, precioMinPercent))}%` }}>{money(precioFiltroMin)}</span>
          <span style={{ left: `${Math.max(0, Math.min(100, precioMaxPercent))}%` }}>{money(precioFiltroMax)}</span>
        </div>
        <div className="catalog-range-values">
          <span>{money(precioMin)}<small>min</small></span>
          <span>{money(precioMax)}<small>max</small></span>
        </div>
      </div>
    );
  }

  return (
    <section className="catalog-page store-page store-page-isolated catalog-redemption-page">
      <div className="catalog-top-shell catalog-redemption-hero">
        <div className="catalog-header">
          <h1 className="catalog-title">Tienda Online</h1>
          <p className="catalog-subtitle">Compra productos con dinero y reserva para retiro en sucursal</p>
        </div>
        <div className="catalog-redemption-account">
          {user?.rol === "cliente" ? (
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
                value={sucursalId}
                onChange={(event) => setSucursalId(event.target.value)}
                disabled={sucursalesQuery.isLoading || !sucursales.length}
              >
                {sucursales.map((sucursal) => (
                  <option key={sucursal.id} value={sucursal.id}>
                    {sucursal.nombre}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {user?.rol === "cliente" ? (
            <div className="catalog-redemption-account-actions">
              <Link className="catalog-float-toast-btn-secondary" to="/mis-pedidos">Mis pedidos</Link>
            </div>
          ) : null}
        </div>
      </div>

      <div className="catalog-products-shell">
        <div className="catalog-layout-shell">
          <aside className="catalog-sidebar" aria-label="Filtros de tienda">
            <div className="catalog-sidebar-head">
              <p className="catalog-sidebar-title">Filtros</p>
              <span>{productosFiltrados.length} {productosFiltrados.length === 1 ? "producto encontrado" : "productos encontrados"}</span>
            </div>

            <section className="catalog-filters-section">
              <h3 className="catalog-filters-section-title" id="store-cat-label-desktop">
                Categoria
              </h3>
              <details className="catalog-filter-dropdown">
                <summary>{categoriaActiva || "Todas"}</summary>
                <div className="catalog-filter-chips" role="radiogroup" aria-labelledby="store-cat-label-desktop">
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
                        name="store-categoria-desktop"
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
              <h3 className="catalog-filters-section-title" id="store-orden-label-desktop">
                Ordenar por
              </h3>
              <details className="catalog-filter-dropdown">
                <summary>
                  {ordenProductos === "precio-asc"
                    ? "Menor precio"
                    : ordenProductos === "precio-desc"
                      ? "Mayor precio"
                      : ordenProductos === "nombre-asc"
                        ? "Nombre A-Z"
                        : "Recomendado"}
                </summary>
                <div className="catalog-filter-chips" role="radiogroup" aria-labelledby="store-orden-label-desktop">
                {[
                  { value: "", label: "Recomendado" },
                  { value: "precio-asc", label: "Menor precio" },
                  { value: "precio-desc", label: "Mayor precio" },
                  { value: "nombre-asc", label: "Nombre A-Z" },
                ].map((opt) => {
                  const checked = ordenProductos === opt.value;
                  return (
                    <label key={opt.value || "__rec"} className={`catalog-filter-chip${checked ? " is-active" : ""}`}>
                      <input
                        type="radio"
                        name="store-orden-desktop"
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
              <h3 className="catalog-filters-section-title" id="store-price-label-desktop">
                Rango de precio
              </h3>
              {renderPrecioRangeControl("store-price-label-desktop")}
            </section>

            <button
              type="button"
              className="catalog-filter-clear catalog-sidebar-clear"
              onClick={() => {
                setCategoriaActiva("");
                setOrdenProductos("");
                setPrecioFiltro(null);
              }}
              disabled={filtrosActivos === 0}
            >
              Limpiar filtros
            </button>
          </aside>

          <div className="catalog-results-column" ref={resultsColumnRef}>
        {!productosQuery.isLoading ? (
          <div className="catalog-filters">
            <div className="catalog-filter-search">
              <input
                className="catalog-filter-search-input"
                value={busqueda}
                onChange={(event) => setBusqueda(event.target.value)}
                placeholder="Buscar producto..."
                aria-label="Buscar producto en tienda"
              />
            </div>

            <div className="catalog-filters-bar">
              <button
                ref={filtrosTriggerRef}
                type="button"
                className={`catalog-filters-trigger${filtrosActivos > 0 ? " has-active" : ""}`}
                aria-haspopup="dialog"
                aria-expanded={filtrosOpen}
                aria-controls="store-filters-panel"
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
                  <span className="catalog-filters-trigger-badge" aria-label={`${filtrosActivos} filtros activos`}>
                    {filtrosActivos}
                  </span>
                ) : null}
              </button>

              <span className="catalog-filter-results" role="status" aria-live="polite" aria-atomic="true">
                {productosFiltrados.length} {productosFiltrados.length === 1 ? "producto" : "productos"}
              </span>
            </div>
          </div>
        ) : null}
        {filtrosOpen ? (
          <div className="catalog-filters-overlay" onClick={() => setFiltrosOpen(false)}>
            <div
              ref={filtrosPanelRef}
              id="store-filters-panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby="store-filters-title"
              tabIndex={-1}
              className="catalog-filters-panel"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="catalog-filters-panel-header">
                <h2 id="store-filters-title" className="catalog-filters-panel-title">
                  Filtros
                </h2>
                <button
                  type="button"
                  className="catalog-filters-panel-close"
                  aria-label="Cerrar filtros"
                  onClick={() => setFiltrosOpen(false)}
                >
                  x
                </button>
              </header>

              <div className="catalog-filters-panel-body">
                <section className="catalog-filters-section">
                  <h3 className="catalog-filters-section-title" id="store-cat-label">
                    Categoria
                  </h3>
                  <div className="catalog-filter-chips" role="radiogroup" aria-labelledby="store-cat-label">
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
                            name="store-categoria"
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
                </section>

                <section className="catalog-filters-section">
                  <h3 className="catalog-filters-section-title" id="store-orden-label">
                    Ordenar por
                  </h3>
                  <div className="catalog-filter-chips" role="radiogroup" aria-labelledby="store-orden-label">
                    {[
                      { value: "", label: "Recomendado" },
                      { value: "precio-asc", label: "Menor precio" },
                      { value: "precio-desc", label: "Mayor precio" },
                      { value: "nombre-asc", label: "Nombre A-Z" },
                    ].map((opt) => {
                      const checked = ordenProductos === opt.value;
                      return (
                        <label key={opt.value || "__rec"} className={`catalog-filter-chip${checked ? " is-active" : ""}`}>
                          <input
                            type="radio"
                            name="store-orden"
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
                  <h3 className="catalog-filters-section-title" id="store-price-label">
                    Rango de precio
                  </h3>
                  {renderPrecioRangeControl("store-price-label")}
                </section>

              </div>

              <footer className="catalog-filters-panel-footer">
                <button
                  type="button"
                  className="catalog-filter-clear"
                  onClick={() => {
                    setCategoriaActiva("");
                    setOrdenProductos("");
                    setPrecioFiltro(null);
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
                  Ver {productosFiltrados.length} {productosFiltrados.length === 1 ? "producto" : "productos"}
                </button>
              </footer>
            </div>
          </div>
        ) : null}

        {productosQuery.isLoading ? (
          <div className="catalog-grid">
            {Array.from({ length: 6 }).map((_, idx) => <div key={idx} className="catalog-skeleton store-skeleton" />)}
          </div>
        ) : productosFiltrados.length === 0 ? (
          <div className="catalog-empty">
            <h3>No hay productos de venta disponibles</h3>
            <p>Cuando actives productos tipo venta o mixto van a aparecer aca.</p>
          </div>
        ) : (
          <div className="catalog-grid">
            {productosPaginaActual.map((producto) => {
              const img = productImage(producto);
              const descripcion = producto.descripcion || "Producto disponible para comprar online.";
              const descripcionLarga = descripcion.length > 86;
              const stock = Number(producto.stock_disponible ?? 0);
              const esCaja = isCajaSabores(producto);
              const sinStock = esCaja ? !productHasStock(producto) : producto.track_stock !== false && stock <= 0;
              const cantidadInputValue = getCantidadInputValue(producto.id);
              const cantidadSeleccionada = getCantidadSeleccionada(producto.id);
              const maxCantidad = maxSelectableQuantity(producto);
              const eventbarPromo = productEventbarPromo(producto);
              return (
                <article
                  key={producto.id}
                  className="product-card store-product-card"
                  onClick={(event) => {
                    if (shouldIgnoreCardOpen(event.target)) return;
                    openProductoModal(producto);
                  }}
                >
                  <button
                    type="button"
                    className="product-card-media-btn"
                    onClick={() => openProductoModal(producto)}
                    aria-label={`Ver producto ${producto.nombre}`}
                  >
                    {img ? (
                      <picture>
                        {producto.imagen_mobile_url && (
                          <source media="(max-width: 768px)" srcSet={mediaUrl(producto.imagen_mobile_url)} />
                        )}
                        <img
                          className="product-card-img"
                          src={img}
                          srcSet={mediaCardSrcSet(img)}
                          sizes={CARD_IMG_SIZES}
                          onError={dropSrcSetOnError}
                          alt={producto.nombre}
                          width={600}
                          height={338}
                          loading="lazy"
                          decoding="async"
                        />
                      </picture>
                    ) : (
                      <div className="product-card-placeholder" />
                    )}
                  </button>
                  {producto.categoria ? <span className="product-card-cat">{producto.categoria}</span> : null}
                  <div className="product-card-body">
                    <h2 className="product-card-name">{producto.nombre}</h2>
                    <div className="product-card-desc-wrap">
                      <p className={`product-card-desc ${descripcionLarga ? "is-collapsed" : "is-expanded"}`}>
                        {descripcion}
                      </p>
                      {descripcionLarga ? (
                        <button
                          type="button"
                          className="product-card-desc-toggle"
                          onClick={(event) => {
                            event.stopPropagation();
                            openProductoModal(producto);
                          }}
                        >
                          Ver más
                        </button>
                      ) : null}
                    </div>
                    <div className="product-card-points store-price-box">
                      <div className="product-card-row">
                        <span>Precio</span>
                        <span className="cost">{money(producto.precio_dinero)}</span>
                      </div>
                      {eventbarPromo ? (
                        <p className="store-mobile-promo-pill">
                          Llevas {eventbarPromo.requiredQuantity} y pagas {eventbarPromo.paidQuantity}
                        </p>
                      ) : null}
                      {hasFreeShipping(producto) ? (
                        <>
                          <div className="product-card-divider" />
                          <div className="product-card-row product-card-free-shipping-row">
                            <span>Envio</span>
                            <strong>Gratis</strong>
                          </div>
                        </>
                      ) : null}
                      {productDiscount(producto) > 0 ? (
                        <>
                          <div className="product-card-divider" />
                          <div className="product-card-row" style={{ color: "#8B5A30" }}>
                            <span>Lista</span>
                            <span style={{ textDecoration: "line-through" }}>{money(productOriginalPrice(producto))}</span>
                          </div>
                          <div className="product-card-row" style={{ color: "#8B5A30", fontWeight: 700 }}>
                            <span>Descuento {productDiscount(producto)}%</span>
                            <span>{producto.tipo_cliente_precio === "empleado" ? "Empleado" : "Mayorista"}</span>
                          </div>
                        </>
                      ) : null}
                      {productPrice(producto) > 0 ? (
                        <>
                          <div className="product-card-divider" />
                          <div className="product-card-row" style={{ color: "#8B5A30", fontWeight: 700 }}>
                            <span style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                              Suma puntos segun el total de la compra
                            </span>
                          </div>
                        </>
                      ) : null}
                    </div>
                    <div className="product-card-actions">
                      <button
                        type="button"
                        className="product-card-btn product-card-btn-ver"
                        onClick={() => openProductoModal(producto)}
                      >
                        Ver producto
                      </button>
                      {user && !esCaja ? (
                        <div className="product-card-action-slot">
                          <div className="product-card-qty">
                            <button
                              type="button"
                              className="vendedor-round-btn"
                              disabled={addMutation.isPending || cantidadSeleccionada <= 1}
                              onClick={() => actualizarCantidadSeleccionada(producto, cantidadSeleccionada - 1)}
                            >
                              -
                            </button>
                            <input
                              className="product-card-qty-input"
                              type="number"
                              min={0}
                              max={Math.max(1, maxCantidad)}
                              step={1}
                              inputMode="numeric"
                              value={cantidadInputValue}
                              disabled={addMutation.isPending || maxCantidad <= 0}
                              onChange={(event) => actualizarCantidadSeleccionada(producto, event.target.value)}
                            />
                            <button
                              type="button"
                              className="vendedor-round-btn"
                              disabled={addMutation.isPending || cantidadSeleccionada >= maxCantidad}
                              onClick={() => actualizarCantidadSeleccionada(producto, cantidadSeleccionada + 1)}
                            >
                              +
                            </button>
                          </div>
                        </div>
                      ) : null}
                      <button
                        className="product-card-btn product-card-btn-canjear"
                        disabled={addMutation.isPending || sinStock || (!esCaja && cantidadSeleccionada < 1)}
                        onClick={() => esCaja ? openProductoModal(producto) : agregar(producto, cantidadSeleccionada)}
                      >
                        {sinStock
                          ? "Sin stock"
                          : addMutation.isPending
                            ? "Agregando..."
                            : esCaja
                              ? "Comprar caja"
                              : cantidadSeleccionada < 1
                                ? "Elegi cantidad"
                                : (
                                  <>
                                    <span className="store-cart-label-full">
                                      {`Agregar ${cantidadSeleccionada > 1 ? `${cantidadSeleccionada} al carrito de compras` : "al carrito de compras"}`}
                                    </span>
                                    <span className="store-cart-label-mobile">
                                      {`Agregar ${cantidadSeleccionada > 1 ? `${cantidadSeleccionada} al carrito` : "al carrito"}`}
                                    </span>
                                  </>
                                )}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {!productosQuery.isLoading && productosFiltrados.length > 0 ? (
          <CatalogPagination
            page={productosPageSafe}
            totalPages={productosTotalPages}
            totalItems={productosFiltrados.length}
            pageSize={CATALOG_PRODUCTS_PER_PAGE}
            onPageChange={cambiarPaginaProductos}
          />
        ) : null}
          </div>
        </div>
      </div>

      {toast ? (
        <div className="catalog-float-toast catalog-float-toast-info">
          <p className="catalog-float-toast-msg">{toast}</p>
          <div className="catalog-float-toast-actions">
            <Link className="catalog-float-toast-btn-primary" to="/carrito-tienda">Ir al carrito</Link>
            <button className="catalog-float-toast-btn-secondary" onClick={() => setToast(null)}>Cerrar</button>
          </div>
        </div>
      ) : null}

      {productoModal ? (
        <div className="producto-modal-overlay" onClick={closeProductoModal}>
          <div className="producto-modal" onClick={(event) => event.stopPropagation()}>
            <button className="producto-modal-close" onClick={closeProductoModal}>✕</button>

            <div className="producto-modal-img-wrap">
              {productoModalImagenActual ? (
                <img
                  src={productoModalImagenActual}
                  alt={`${productoModal.nombre} - imagen ${productoModalImageIndex + 1}`}
                  className="producto-modal-img"
                  decoding="async"
                  style={{
                    transformOrigin: zoomOrigin,
                    transform: imgZoomed ? `translate(${pan.x}px, ${pan.y}px) scale(2.4)` : "none",
                    cursor: !imgZoomed ? "zoom-in" : "grab",
                    transition: dragRef.current?.active ? "none" : "transform 0.3s ease",
                  }}
                  onClick={(event) => {
                    if (hasDragged.current) return;
                    if (imgZoomed) {
                      setImgZoomed(false);
                      setPan({ x: 0, y: 0 });
                      setZoomOrigin("50% 50%");
                      return;
                    }
                    const rect = event.currentTarget.getBoundingClientRect();
                    const x = ((event.clientX - rect.left) / rect.width) * 100;
                    const y = ((event.clientY - rect.top) / rect.height) * 100;
                    setZoomOrigin(`${x}% ${y}%`);
                    setImgZoomed(true);
                  }}
                  onMouseDown={(event) => {
                    if (!imgZoomed) return;
                    event.preventDefault();
                    hasDragged.current = false;
                    dragRef.current = { active: true, startX: event.clientX, startY: event.clientY, panX: pan.x, panY: pan.y };
                  }}
                  onMouseMove={(event) => {
                    if (!dragRef.current?.active) return;
                    const dx = event.clientX - dragRef.current.startX;
                    const dy = event.clientY - dragRef.current.startY;
                    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) hasDragged.current = true;
                    setPan({ x: dragRef.current.panX + dx, y: dragRef.current.panY + dy });
                  }}
                  onMouseUp={() => {
                    if (dragRef.current) dragRef.current.active = false;
                  }}
                  onMouseLeave={() => {
                    if (dragRef.current) dragRef.current.active = false;
                  }}
                  onTouchStart={(event) => {
                    if (!imgZoomed) return;
                    const touch = event.touches[0];
                    hasDragged.current = false;
                    dragRef.current = { active: true, startX: touch.clientX, startY: touch.clientY, panX: pan.x, panY: pan.y };
                  }}
                  onTouchMove={(event) => {
                    if (!dragRef.current?.active) return;
                    event.preventDefault();
                    const touch = event.touches[0];
                    const dx = touch.clientX - dragRef.current.startX;
                    const dy = touch.clientY - dragRef.current.startY;
                    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) hasDragged.current = true;
                    setPan({ x: dragRef.current.panX + dx, y: dragRef.current.panY + dy });
                  }}
                  onTouchEnd={() => {
                    if (dragRef.current) dragRef.current.active = false;
                  }}
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

              {productoModal.categoria ? <span className="product-card-cat">{productoModal.categoria}</span> : null}
            </div>

            <div className="producto-modal-body">
              <p className="producto-modal-name">{productoModal.nombre}</p>
              <p className="producto-modal-desc">{productoModal.descripcion || "Producto disponible para comprar online."}</p>

              <div className="product-card-points store-price-box">
                <div className="product-card-row">
                  <span>Precio</span>
                  <span className="cost">{money(productoModal.precio_dinero)}</span>
                </div>
                {productoModalEventbarPromo ? (
                  <p className="store-mobile-promo-pill">
                    Llevas {productoModalEventbarPromo.requiredQuantity} y pagas {productoModalEventbarPromo.paidQuantity}
                  </p>
                ) : null}
                {hasFreeShipping(productoModal) ? (
                  <>
                    <div className="product-card-divider" />
                    <div className="product-card-row product-card-free-shipping-row">
                      <span>Envio</span>
                      <strong>Gratis</strong>
                    </div>
                  </>
                ) : null}
                {productDiscount(productoModal) > 0 ? (
                  <>
                    <div className="product-card-divider" />
                    <div className="product-card-row" style={{ color: "#8B5A30" }}>
                      <span>Lista</span>
                      <span style={{ textDecoration: "line-through" }}>{money(productOriginalPrice(productoModal))}</span>
                    </div>
                    <div className="product-card-row" style={{ color: "#8B5A30", fontWeight: 700 }}>
                      <span>Descuento {productDiscount(productoModal)}%</span>
                      <span>{productoModal.tipo_cliente_precio === "empleado" ? "Empleado" : "Mayorista"}</span>
                    </div>
                  </>
                ) : null}
                {productPrice(productoModal) > 0 ? (
                  <>
                    <div className="product-card-divider" />
                    <div className="product-card-row" style={{ color: "#8B5A30", fontWeight: 700 }}>
                      <span>Suma puntos segun el total de la compra</span>
                    </div>
                  </>
                ) : null}
              </div>

              {user ? (
                <>
                  {isCajaSabores(productoModal) ? (
                    <div className="box-flavor-picker">
                      <div className="box-flavor-picker-head">
                        <strong>Elegi sabores</strong>
                        <span>{cajaSeleccionTotal(productoModal)} / {cajaCapacidad(productoModal)}</span>
                      </div>
                      <p className="box-flavor-picker-help">
                        Arma tu caja seleccionando exactamente {cajaCapacidad(productoModal)} alfajores.
                      </p>
                      <div className="box-flavor-list">
                        {(productoModal.sabores_disponibles ?? []).map((sabor) => {
                          const selected = cajaDraft(productoModal)[sabor.id] ?? 0;
                          const disponible = Math.max(0, Number(sabor.stock_disponible ?? 0));
                          return (
                            <div key={sabor.id} className="box-flavor-row">
                              <div>
                                <strong>{sabor.nombre}</strong>
                                <span>{disponible > 0 ? `${disponible} disponibles` : "Sin stock"}</span>
                              </div>
                              <div className="catalog-canje-item-qty">
                                <button
                                  type="button"
                                  disabled={addMutation.isPending || selected <= 0}
                                  onClick={() => ajustarSaborCaja(productoModal, sabor.id, -1)}
                                >
                                  -
                                </button>
                                <span>{selected}</span>
                                <button
                                  type="button"
                                  disabled={addMutation.isPending || disponible <= selected || cajaSeleccionTotal(productoModal) >= cajaCapacidad(productoModal)}
                                  onClick={() => ajustarSaborCaja(productoModal, sabor.id, +1)}
                                >
                                  +
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {!isCajaSabores(productoModal) ? (
                  <div className="product-card-qty">
                    <button
                      type="button"
                      className="vendedor-round-btn"
                      disabled={addMutation.isPending || getCantidadSeleccionada(productoModal.id) <= 1}
                      onClick={() => actualizarCantidadSeleccionada(productoModal, getCantidadSeleccionada(productoModal.id) - 1)}
                    >
                      -
                    </button>
                    <input
                      className="product-card-qty-input"
                      type="number"
                      min={0}
                      max={Math.max(1, maxSelectableQuantity(productoModal))}
                      step={1}
                      inputMode="numeric"
                      value={getCantidadInputValue(productoModal.id)}
                      disabled={addMutation.isPending || maxSelectableQuantity(productoModal) <= 0}
                      onChange={(event) => actualizarCantidadSeleccionada(productoModal, event.target.value)}
                    />
                    <button
                      type="button"
                      className="vendedor-round-btn"
                      disabled={addMutation.isPending || getCantidadSeleccionada(productoModal.id) >= maxSelectableQuantity(productoModal)}
                      onClick={() => actualizarCantidadSeleccionada(productoModal, getCantidadSeleccionada(productoModal.id) + 1)}
                    >
                      +
                    </button>
                  </div>
                  ) : null}

                  <button
                    className="product-card-btn product-card-btn-canjear"
                    disabled={addMutation.isPending || !productHasStock(productoModal) || (!isCajaSabores(productoModal) && getCantidadSeleccionada(productoModal.id) < 1) || (isCajaSabores(productoModal) && !cajaSeleccionCompleta(productoModal))}
                    onClick={() => agregar(productoModal, getCantidadSeleccionada(productoModal.id))}
                  >
                    {!productHasStock(productoModal)
                      ? "Sin stock"
                      : addMutation.isPending
                        ? "Agregando..."
                        : isCajaSabores(productoModal)
                          ? "Agregar al carrito de compras"
                          : getCantidadSeleccionada(productoModal.id) < 1
                            ? "Elegi cantidad"
                            : `Agregar ${getCantidadSeleccionada(productoModal.id) > 1 ? `${getCantidadSeleccionada(productoModal.id)} al carrito de compras` : "al carrito de compras"}`}
                  </button>
                </>
              ) : (
                <Link
                  to="/login"
                  state={{ from: `${location.pathname}${location.search}`, loginNotice: LOGIN_CART_NOTICE }}
                  className="product-card-btn product-card-btn-login"
                >
                  Iniciar sesión para comprar
                </Link>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
