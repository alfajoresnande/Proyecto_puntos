import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api";
import { useAuthStore } from "../../store/authStore";
import type { Producto } from "../../types";

type CanjeProductoResponse = {
  canje_id: number;
  canje_codigo?: string | null;
  codigo_retiro?: string | null;
  nuevo_saldo: number;
  puntos_usados: number;
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

type CanjeConfirmState = {
  producto: Producto;
  onConfirm?: () => void;
};

function isLegacyCanjeCode(code?: string | null): boolean {
  return Boolean(code && /^C0{2,}[A-Z0-9]*$/.test(code));
}

function getCanjeCode(data: CanjeProductoResponse): string | null {
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

export function Catalogo() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const updateUserPoints = useAuthStore((state) => state.updateUserPoints);
  const isCliente = user?.rol === "cliente";

  const [categoriaActiva, setCategoriaActiva] = useState("");
  const [maxPuntos, setMaxPuntos] = useState(0);
  const [busquedaProducto, setBusquedaProducto] = useState("");
  const [productoModal, setProductoModal] = useState<Producto | null>(null);
  const [imgZoomed, setImgZoomed] = useState(false);
  const [zoomOrigin, setZoomOrigin] = useState("50% 50%");
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ active: boolean; startX: number; startY: number; panX: number; panY: number } | null>(null);
  const hasDragged = useRef(false);
  const [toast, setToast] = useState<CatalogToast | null>(null);
  const [sucursalRetiroId, setSucursalRetiroId] = useState("");
  const [canjeConfirmState, setCanjeConfirmState] = useState<CanjeConfirmState | null>(null);

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

  const puntosMax = useMemo(() => {
    if (!productos.length) return 1000;
    const maxRaw = Math.max(...productos.map((producto) => producto.puntos_requeridos || 0));
    return Math.max(50, Math.ceil(maxRaw / 50) * 50);
  }, [productos]);

  useEffect(() => {
    setMaxPuntos(puntosMax);
  }, [puntosMax]);

  useEffect(() => {
    document.body.classList.add("catalog-background");
    return () => {
      document.body.classList.remove("catalog-background");
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

  const canjearMutation = useMutation({
    mutationFn: ({ productoId, sucursalId }: { productoId: number; sucursalId?: number }) =>
      api.post<CanjeProductoResponse>("/cliente/canjear-producto", {
        producto_id: productoId,
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
        title: "Canje hecho con éxito",
        msg: "Tu canje se registró correctamente.",
        codigoCanje: codigoRetiro ?? "Disponible en Mis Canjes",
        sucursalDetalle: sucursalElegida ?? null,
        lugarRetiroTexto: lugarRetiro,
        diasLimiteRetiro:
          typeof data.dias_limite_retiro === "number" && data.dias_limite_retiro > 0
            ? data.dias_limite_retiro
            : null,
      });
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
    setImgZoomed(false);
    setPan({ x: 0, y: 0 });
    setZoomOrigin("50% 50%");
  }

  function prepararCanje(producto: Producto, onConfirm?: () => void) {
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

    setCanjeConfirmState({ producto, onConfirm });
  }

  function confirmarCanjePendiente() {
    if (!canjeConfirmState) return;
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

    canjearMutation.mutate({
      productoId: canjeConfirmState.producto.id,
      sucursalId: sucursalElegida?.id,
    });
    canjeConfirmState.onConfirm?.();
    setCanjeConfirmState(null);
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
                    <button
                      className="product-card-btn product-card-btn-canjear"
                      style={{ marginTop: "0.5rem" }}
                      disabled={canjearMutation.isPending}
                      onClick={() => prepararCanje(producto)}
                    >
                      Canjear producto
                    </button>
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
      {canjeConfirmState ? (
        <div className="catalog-confirm-overlay" onClick={() => setCanjeConfirmState(null)}>
          <div className="catalog-confirm-card" onClick={(event) => event.stopPropagation()}>
            <p className="catalog-confirm-title">Confirmar canje</p>
            <p className="catalog-confirm-msg">
              Vas a canjear <strong>{canjeConfirmState.producto.nombre}</strong> por{" "}
              <strong>{canjeConfirmState.producto.puntos_requeridos} pts</strong>.
            </p>

            <div className="catalog-confirm-field">
              <label className="catalog-confirm-label" htmlFor="catalog-confirm-sucursal">
                Sucursal donde vas a retirar
              </label>
              <select
                id="catalog-confirm-sucursal"
                className="catalog-pickup-select"
                value={sucursalRetiroId}
                onChange={(event) => setSucursalRetiroId(event.target.value)}
                disabled={sucursalesQuery.isLoading || !sucursalesRetiro.length || canjearMutation.isPending}
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
                onClick={confirmarCanjePendiente}
                disabled={canjearMutation.isPending || (sucursalesRetiro.length > 1 && !sucursalRetiroSeleccionada)}
              >
                {canjearMutation.isPending ? "Procesando..." : "Confirmar canje"}
              </button>
              <button className="catalog-float-toast-btn-secondary" onClick={() => setCanjeConfirmState(null)}>
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
              <p className="catalog-alert-code">
                Código de canje: <strong>{toast.codigoCanje ?? "Disponible en Mis Canjes"}</strong>
              </p>
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
              {getProductoImagen(productoModal) ? (
                <img
                  src={getProductoImagen(productoModal) as string}
                  alt={productoModal.nombre}
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
                <button
                  className="product-card-btn product-card-btn-canjear"
                  disabled={canjearMutation.isPending}
                  onClick={() => prepararCanje(productoModal, () => setProductoModal(null))}
                >
                  Canjear producto
                </button>
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
