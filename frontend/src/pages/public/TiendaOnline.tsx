import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api";
import { useAuthStore } from "../../store/authStore";
import type { Producto } from "../../types";

function money(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(Number.isFinite(n) ? n : 0);
}

function productImage(producto: Producto): string | null {
  if (producto.imagenes?.length) return producto.imagenes[0];
  return producto.imagen_url ?? null;
}

type PriceRangeId = "all" | "low" | "mid-low" | "mid-high" | "high";
type StockFilterId = "all" | "available";

type PriceRange = {
  id: PriceRangeId;
  label: string;
  match: (precio: number) => boolean;
};

function productPrice(producto: Producto): number {
  const n = Number(producto.precio_dinero ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function productHasStock(producto: Producto): boolean {
  return producto.track_stock === false || Number(producto.stock_disponible ?? 0) > 0;
}

function niceRoundMoney(n: number): number {
  if (n < 1000) return Math.max(100, Math.round(n / 100) * 100);
  if (n < 10000) return Math.round(n / 500) * 500;
  return Math.round(n / 1000) * 1000;
}

export function TiendaOnline() {
  const user = useAuthStore((state) => state.user);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [categoriaActiva, setCategoriaActiva] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [ordenProductos, setOrdenProductos] = useState("");
  const [rangoPrecioId, setRangoPrecioId] = useState<PriceRangeId>("all");
  const [stockFilterId, setStockFilterId] = useState<StockFilterId>("all");
  const [filtrosOpen, setFiltrosOpen] = useState(false);
  const filtrosTriggerRef = useRef<HTMLButtonElement>(null);
  const filtrosPanelRef = useRef<HTMLDivElement>(null);
  const filtrosWasOpen = useRef(false);
  const [toast, setToast] = useState<string | null>(null);

  const productosQuery = useQuery({
    queryKey: ["productos", "venta"],
    queryFn: () => api.get<Producto[]>("/productos?modo=venta"),
  });

  const productos = productosQuery.data ?? [];
  const categorias = useMemo(
    () => Array.from(new Set(productos.map((p) => p.categoria).filter((c): c is string => Boolean(c)))).sort(),
    [productos],
  );

  const precioMax = useMemo(() => {
    if (!productos.length) return 1000;
    const maxRaw = Math.max(...productos.map(productPrice));
    return Math.max(100, Math.ceil(maxRaw / 100) * 100);
  }, [productos]);

  const rangosPrecio = useMemo<PriceRange[]>(() => {
    const q = Math.max(100, precioMax) / 4;
    const t1 = niceRoundMoney(q);
    const t2 = Math.max(t1 + 100, niceRoundMoney(q * 2));
    const t3 = Math.max(t2 + 100, niceRoundMoney(q * 3));
    return [
      { id: "all", label: "Todos", match: () => true },
      { id: "low", label: `Hasta ${money(t1)}`, match: (p) => p <= t1 },
      { id: "mid-low", label: `${money(t1)} - ${money(t2)}`, match: (p) => p > t1 && p <= t2 },
      { id: "mid-high", label: `${money(t2)} - ${money(t3)}`, match: (p) => p > t2 && p <= t3 },
      { id: "high", label: `Mas de ${money(t3)}`, match: (p) => p > t3 },
    ];
  }, [precioMax]);

  useEffect(() => {
    if (!rangosPrecio.some((r) => r.id === rangoPrecioId)) {
      setRangoPrecioId("all");
    }
  }, [rangosPrecio, rangoPrecioId]);

  const filtrosActivos = useMemo(() => {
    let n = 0;
    if (categoriaActiva) n += 1;
    if (ordenProductos) n += 1;
    if (rangoPrecioId !== "all") n += 1;
    if (stockFilterId !== "all") n += 1;
    return n;
  }, [categoriaActiva, ordenProductos, rangoPrecioId, stockFilterId]);

  const baseSearch = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return productos.filter((producto) => {
      const text = [producto.nombre, producto.descripcion ?? "", producto.categoria ?? ""].join(" ").toLowerCase();
      return !q || text.includes(q);
    });
  }, [busqueda, productos]);

  const conteosPorCategoria = useMemo(() => {
    const rangoSel = rangosPrecio.find((r) => r.id === rangoPrecioId) ?? rangosPrecio[0];
    const base = baseSearch.filter((producto) => {
      const priceOk = rangoSel ? rangoSel.match(productPrice(producto)) : true;
      const stockOk = stockFilterId === "all" || productHasStock(producto);
      return priceOk && stockOk;
    });
    const acc: Record<string, number> = { __all: base.length };
    for (const producto of base) {
      const cat = producto.categoria || "";
      if (cat) acc[cat] = (acc[cat] ?? 0) + 1;
    }
    return acc;
  }, [baseSearch, rangosPrecio, rangoPrecioId, stockFilterId]);

  const conteosPorPrecio = useMemo(() => {
    const base = baseSearch.filter((producto) => {
      const categoriaOk = !categoriaActiva || producto.categoria === categoriaActiva;
      const stockOk = stockFilterId === "all" || productHasStock(producto);
      return categoriaOk && stockOk;
    });
    return rangosPrecio.reduce<Record<string, number>>((acc, rango) => {
      acc[rango.id] = base.filter((producto) => rango.match(productPrice(producto))).length;
      return acc;
    }, {});
  }, [baseSearch, categoriaActiva, rangosPrecio, stockFilterId]);

  const conteosPorStock = useMemo(() => {
    const rangoSel = rangosPrecio.find((r) => r.id === rangoPrecioId) ?? rangosPrecio[0];
    const base = baseSearch.filter((producto) => {
      const categoriaOk = !categoriaActiva || producto.categoria === categoriaActiva;
      const priceOk = rangoSel ? rangoSel.match(productPrice(producto)) : true;
      return categoriaOk && priceOk;
    });
    return {
      all: base.length,
      available: base.filter(productHasStock).length,
    };
  }, [baseSearch, categoriaActiva, rangosPrecio, rangoPrecioId]);

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
    const rangoSel = rangosPrecio.find((r) => r.id === rangoPrecioId) ?? rangosPrecio[0];
    const filtrados = baseSearch.filter((producto) => {
      const categoriaOk = !categoriaActiva || producto.categoria === categoriaActiva;
      const precioOk = rangoSel ? rangoSel.match(productPrice(producto)) : true;
      const stockOk = stockFilterId === "all" || productHasStock(producto);
      return categoriaOk && precioOk && stockOk;
    });

    if (ordenProductos === "precio-asc") {
      return [...filtrados].sort((a, b) => productPrice(a) - productPrice(b));
    }
    if (ordenProductos === "precio-desc") {
      return [...filtrados].sort((a, b) => productPrice(b) - productPrice(a));
    }
    if (ordenProductos === "nombre-asc") {
      return [...filtrados].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    }

    return filtrados;
  }, [baseSearch, categoriaActiva, ordenProductos, rangosPrecio, rangoPrecioId, stockFilterId]);

  const addMutation = useMutation({
    mutationFn: (productoId: number) =>
      api.post<{ ok: true }>("/cliente/carrito/items", {
        producto_id: productoId,
        cantidad: 1,
        modo_compra: "dinero",
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["cliente", "carrito-online"] });
      setToast("Producto agregado al carrito.");
      window.setTimeout(() => setToast(null), 2600);
    },
    onError: (error: Error) => setToast(error.message),
  });

  function agregar(producto: Producto) {
    if (!user || user.rol !== "cliente") {
      navigate("/login");
      return;
    }
    addMutation.mutate(producto.id);
  }

  return (
    <section className="catalog-page store-page">
      <div className="catalog-top-shell store-head">
        <div className="catalog-header">
          <h1 className="catalog-title">Tienda Online</h1>
          <p className="catalog-subtitle">Compra productos con dinero y reserva stock para retiro en sucursal</p>
        </div>
        <div className="store-actions">
          <Link className="catalog-float-toast-btn-secondary" to="/carrito-tienda">Ver carrito</Link>
          {user?.rol === "cliente" ? <Link className="catalog-float-toast-btn-secondary" to="/mis-pedidos">Mis pedidos</Link> : null}
        </div>
      </div>

      <div className="catalog-products-shell">
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
                  <div className="catalog-filter-chips" role="radiogroup" aria-labelledby="store-price-label">
                    {rangosPrecio.map((rango) => {
                      const count = conteosPorPrecio[rango.id] ?? 0;
                      const checked = rangoPrecioId === rango.id;
                      const isEmpty = count === 0 && !checked;
                      return (
                        <label
                          key={rango.id}
                          className={`catalog-filter-chip${checked ? " is-active" : ""}${isEmpty ? " is-empty" : ""}`}
                        >
                          <input
                            type="radio"
                            name="store-rango-precio"
                            className="catalog-filter-chip-input"
                            value={rango.id}
                            checked={checked}
                            onChange={() => setRangoPrecioId(rango.id)}
                            aria-label={`${rango.label}, ${count} ${count === 1 ? "producto" : "productos"}`}
                          />
                          <span className="catalog-filter-chip-label">{rango.label}</span>
                          <span className="catalog-filter-chip-count" aria-hidden="true">
                            {count}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </section>

                <section className="catalog-filters-section">
                  <h3 className="catalog-filters-section-title" id="store-stock-label">
                    Disponibilidad
                  </h3>
                  <div className="catalog-filter-chips" role="radiogroup" aria-labelledby="store-stock-label">
                    {[
                      { value: "all" as StockFilterId, label: "Todos", count: conteosPorStock.all },
                      { value: "available" as StockFilterId, label: "Con stock", count: conteosPorStock.available },
                    ].map((opt) => {
                      const checked = stockFilterId === opt.value;
                      const isEmpty = opt.count === 0 && !checked;
                      return (
                        <label
                          key={opt.value}
                          className={`catalog-filter-chip${checked ? " is-active" : ""}${isEmpty ? " is-empty" : ""}`}
                        >
                          <input
                            type="radio"
                            name="store-stock"
                            className="catalog-filter-chip-input"
                            value={opt.value}
                            checked={checked}
                            onChange={() => setStockFilterId(opt.value)}
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
              </div>

              <footer className="catalog-filters-panel-footer">
                <button
                  type="button"
                  className="catalog-filter-clear"
                  onClick={() => {
                    setCategoriaActiva("");
                    setOrdenProductos("");
                    setRangoPrecioId("all");
                    setStockFilterId("all");
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
            {productosFiltrados.map((producto) => {
              const img = productImage(producto);
              const stock = Number(producto.stock_disponible ?? 0);
              const sinStock = producto.track_stock !== false && stock <= 0;
              return (
                <article key={producto.id} className="product-card store-product-card">
                  {img ? (
                    <img className="product-card-img" src={img} alt={producto.nombre} />
                  ) : (
                    <div className="product-card-placeholder" />
                  )}
                  {producto.categoria ? <span className="product-card-cat">{producto.categoria}</span> : null}
                  <div className="product-card-body">
                    <h2 className="product-card-name">{producto.nombre}</h2>
                    <p className="product-card-desc">{producto.descripcion || "Producto disponible para comprar online."}</p>
                    <div className="product-card-points store-price-box">
                      <div className="product-card-row">
                        <span>Precio</span>
                        <span className="cost">{money(producto.precio_dinero)}</span>
                      </div>
                      <div className="product-card-divider" />
                      <div className="product-card-row">
                        <span>Stock disponible</span>
                        <span className={sinStock ? "store-stock-empty" : "earn"}>{producto.track_stock === false ? "Consultar" : stock}</span>
                      </div>
                    </div>
                    <button
                      className="product-card-btn product-card-btn-canjear"
                      disabled={addMutation.isPending || sinStock}
                      onClick={() => agregar(producto)}
                    >
                      {sinStock ? "Sin stock" : addMutation.isPending ? "Agregando..." : "Agregar al carrito"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
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
    </section>
  );
}
