import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { scrollPageToTop } from "../lib/scrollTop";
import { useAuthStore } from "../store/authStore";
import { useCartStore } from "../store/cartStore";

function navClass(isActive: boolean): string {
  return `navbar-link${isActive ? " active" : ""}`;
}

type OnlineCartResponse = {
  items: Array<{
    cantidad: number;
    modo_compra: "dinero" | "puntos";
  }>;
};

type SupportConversationNav = {
  unread_cliente?: number;
  unread_staff?: number;
};

type StaffOrderNav = {
  id: number;
  estado: "pendiente_pago" | "pagada" | "preparandose" | "preparada" | "enviada" | "entregando" | "entregada" | "cancelada" | "expirada" | string;
  pago?: {
    proveedor: string;
    metodo: string | null;
    estado: string;
  } | null;
};

type ClienteOrderNav = {
  id: number;
  estado: string;
  tipo_orden?: "canje" | "venta" | "mixta" | string;
  direccion_envio?: unknown | null;
};

type ArrepentimientoSolicitudNav = {
  codigo_tramite: string;
  numero_orden: string;
  estado: "pendiente" | "revisado" | "resuelto" | "desestimado" | string;
  created_at: string;
  updated_at: string;
};

function formatArrepentimientoEstado(estado: string): string {
  const normalized = estado.trim().toLowerCase();
  if (normalized === "resuelto") return "Aceptado";
  if (normalized === "desestimado") return "Rechazado";
  if (normalized === "revisado") return "En revision";
  return "Pendiente";
}

function hasActiveShippingOrder(order: ClienteOrderNav): boolean {
  const estado = order.estado.trim().toLowerCase();
  return Boolean(order.direccion_envio) && ["pagada", "preparandose", "preparada", "enviada", "entregando"].includes(estado);
}

function hasPendingCustomerOrder(order: ClienteOrderNav): boolean {
  const estado = order.estado.trim().toLowerCase();
  return order.tipo_orden !== "canje" && (estado === "pendiente_pago" || estado === "borrador");
}

export function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const location = useLocation();
  const navigate = useNavigate();

  const user = useAuthStore((state) => state.user);
  const isRestoringSession = useAuthStore((state) => state.isRestoringSession);
  const hasRestoredSession = useAuthStore((state) => state.hasRestoredSession);
  const logout = useAuthStore((state) => state.logout);
  const cartItems = useCartStore((state) => state.items);

  const authReady = hasRestoredSession && !isRestoringSession;
  const canSeeCliente = user?.rol === "cliente";
  const canSeeVendedor = user?.rol === "vendedor" || user?.rol === "admin" || user?.rol === "superAdmin";
  const canSeeAdmin = user?.rol === "admin" || user?.rol === "superAdmin";
  const canSeeSupport = canSeeCliente || canSeeVendedor;
  const adminPanelPath = user?.rol === "superAdmin" ? "/superadmin" : "/admin";
  const adminPanelLabel = user?.rol === "superAdmin" ? "Panel SuperAdmin" : "Panel Admin";
  const shippingZonesPath = canSeeAdmin ? `${adminPanelPath}/envios` : "/vendedor/envios";
  const ordersMapPath = canSeeAdmin ? `${adminPanelPath}/mapa-pedidos` : "/vendedor/mapa-pedidos";
  const onlineCartQuery = useQuery({
    queryKey: ["cliente", "carrito-online"],
    queryFn: () => api.get<OnlineCartResponse>("/cliente/carrito"),
    enabled: authReady && canSeeCliente,
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  });
  const supportConversationsQuery = useQuery({
    queryKey: ["navbar", "support-unread", user?.rol],
    queryFn: () => api.get<SupportConversationNav[]>("/soporte/conversaciones"),
    enabled: authReady && canSeeSupport,
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  });
  const clienteOrdersQuery = useQuery({
    queryKey: ["cliente", "ordenes"],
    queryFn: () => api.get<ClienteOrderNav[]>("/cliente/ordenes"),
    enabled: authReady && canSeeCliente,
    refetchInterval: (query) => {
      const orders = query.state.data ?? [];
      return orders.some(hasActiveShippingOrder) ? 5000 : 15000;
    },
    refetchIntervalInBackground: true,
  });
  const arrepentimientosQuery = useQuery({
    queryKey: ["cliente", "arrepentimientos"],
    queryFn: () => api.get<ArrepentimientoSolicitudNav[]>("/cliente/arrepentimientos"),
    enabled: authReady && canSeeCliente,
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
  });
  const staffOrdersQuery = useQuery({
    queryKey: ["navbar", "staff-orders-alert"],
    queryFn: () => api.get<StaffOrderNav[]>("/vendedor/ordenes"),
    enabled: authReady && canSeeVendedor,
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  });

  const canjeCartCount = useMemo(
    () => Object.values(cartItems).reduce((acc, item) => acc + item.cantidad, 0),
    [cartItems],
  );
  const onlineCartCount = useMemo(
    () =>
      (onlineCartQuery.data?.items ?? [])
        .filter((item) => item.modo_compra === "dinero")
        .reduce((acc, item) => acc + Number(item.cantidad ?? 0), 0),
    [onlineCartQuery.data?.items],
  );
  const supportUnreadCount = useMemo(
    () =>
      (supportConversationsQuery.data ?? []).reduce((acc, item) => {
        const unread = canSeeCliente ? Number(item.unread_cliente ?? 0) : Number(item.unread_staff ?? 0);
        return acc + unread;
      }, 0),
    [canSeeCliente, supportConversationsQuery.data],
  );
  const staffOrdersAttentionCount = useMemo(
    () =>
      (staffOrdersQuery.data ?? []).filter((order) => {
        if (order.estado === "pagada" || order.estado === "preparandose" || order.estado === "preparada") return true;
        if (order.estado !== "pendiente_pago") return false;
        return order.pago?.proveedor === "efectivo" || order.pago?.metodo === "cash";
      }).length,
    [staffOrdersQuery.data],
  );
  const activeShippingOrdersCount = useMemo(
    () => (clienteOrdersQuery.data ?? []).filter(hasActiveShippingOrder).length,
    [clienteOrdersQuery.data],
  );
  const pendingOrdersCount = useMemo(
    () => (clienteOrdersQuery.data ?? []).filter(hasPendingCustomerOrder).length,
    [clienteOrdersQuery.data],
  );
  const arrepentimientoSolicitudes = arrepentimientosQuery.data ?? [];
  const pendingOrdersLabel = pendingOrdersCount === 1
    ? "Tenes un pedido pendiente en Mis pedidos"
    : `Tenes ${pendingOrdersCount} pedidos pendientes en Mis pedidos`;
  const navbarMobileBadgeCount =
    supportUnreadCount +
    (canSeeVendedor ? staffOrdersAttentionCount : 0) +
    (canSeeCliente ? activeShippingOrdersCount + pendingOrdersCount : 0);
  const isRedemptionCatalog = location.pathname.startsWith("/catalogo");
  const activeCart = isRedemptionCatalog
    ? {
        target: "/carrito-canjes",
        count: canjeCartCount,
        label: "Carrito de canjes",
        className: "navbar-cart-btn navbar-cart-btn-canje",
      }
    : {
        target: "/carrito-tienda",
        count: onlineCartCount,
        label: "Carrito de compras",
        className: "navbar-cart-btn navbar-cart-btn-store",
      };

  const closeMenu = () => setMenuOpen(false);

  function closeMenuAndScrollTop() {
    closeMenu();
    scrollPageToTop();
  }

  function renderNavLabel(label: string, unreadCount = 0) {
    return (
      <span className="navbar-link-content">
        <span>{label}</span>
        {unreadCount > 0 ? (
          <span className="navbar-link-badge" aria-label={`${unreadCount} mensajes sin leer`}>
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </span>
    );
  }

  function renderOrdersLabel(label = "Mis Pedidos") {
    return (
      <span className="navbar-link-content">
        <span>{label}</span>
        {pendingOrdersCount > 0 ? (
          <span
            className="navbar-link-badge navbar-link-badge-warning"
            aria-label={pendingOrdersLabel}
            title={pendingOrdersLabel}
          >
            {pendingOrdersCount > 99 ? "99+" : pendingOrdersCount}
          </span>
        ) : null}
        {activeShippingOrdersCount > 0 ? (
          <span
            className="navbar-link-dot"
            aria-label={`${activeShippingOrdersCount} envio${activeShippingOrdersCount === 1 ? "" : "s"} en seguimiento`}
            title={`${activeShippingOrdersCount} envio${activeShippingOrdersCount === 1 ? "" : "s"} en seguimiento`}
          />
        ) : null}
      </span>
    );
  }

  function renderArrepentimientosSummary(variant: "desktop" | "mobile") {
    if (arrepentimientoSolicitudes.length === 0) return null;

    return (
      <div className={`navbar-arrepentimiento-summary navbar-arrepentimiento-summary-${variant}`}>
        <p className="navbar-arrepentimiento-title">Mis formularios de arrepentimiento</p>
        <div className="navbar-arrepentimiento-list">
          {arrepentimientoSolicitudes.slice(0, 3).map((item) => {
            const estado = item.estado.trim().toLowerCase();
            return (
              <div key={item.codigo_tramite} className="navbar-arrepentimiento-item">
                <span className="navbar-arrepentimiento-order">Pedido {item.numero_orden}</span>
                <span className={`navbar-arrepentimiento-status is-${estado}`}>
                  {formatArrepentimientoEstado(item.estado)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function handleIrACarrito(target: string) {
    closeMenu();
    scrollPageToTop();
    if (location.pathname !== target) {
      navigate(target);
    }
  }

  const cartIcon = (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="21" r="1.6" />
      <circle cx="18" cy="21" r="1.6" />
      <path d="M2.5 3h2.4l2.7 12.3a2 2 0 0 0 2 1.7h8.5a2 2 0 0 0 2-1.6L21.5 7H6" />
    </svg>
  );

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (!userMenuRef.current?.contains(target)) setUserMenuOpen(false);
    }

    function onEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setUserMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  useEffect(() => {
    setMenuOpen(false);
    setUserMenuOpen(false);
  }, [location.pathname, location.hash]);

  useEffect(() => {
    if (!menuOpen) return;

    const scrollY = window.scrollY;
    const { style: bodyStyle } = document.body;
    const { style: htmlStyle } = document.documentElement;
    const previousBody = {
      overflow: bodyStyle.overflow,
      position: bodyStyle.position,
      top: bodyStyle.top,
      left: bodyStyle.left,
      right: bodyStyle.right,
      width: bodyStyle.width,
      touchAction: bodyStyle.touchAction,
    };
    const previousHtmlOverflow = htmlStyle.overflow;

    htmlStyle.overflow = "hidden";
    bodyStyle.overflow = "hidden";
    bodyStyle.position = "fixed";
    bodyStyle.top = `-${scrollY}px`;
    bodyStyle.left = "0";
    bodyStyle.right = "0";
    bodyStyle.width = "100%";
    bodyStyle.touchAction = "none";

    return () => {
      htmlStyle.overflow = previousHtmlOverflow;
      bodyStyle.overflow = previousBody.overflow;
      bodyStyle.position = previousBody.position;
      bodyStyle.top = previousBody.top;
      bodyStyle.left = previousBody.left;
      bodyStyle.right = previousBody.right;
      bodyStyle.width = previousBody.width;
      bodyStyle.touchAction = previousBody.touchAction;
      window.scrollTo(0, scrollY);
    };
  }, [menuOpen]);

  const cartButton = canSeeCliente ? (
    <div className="navbar-cart-wrap">
      <button
        type="button"
        onClick={() => handleIrACarrito(activeCart.target)}
        aria-label={`${activeCart.label}${activeCart.count > 0 ? ` (${activeCart.count} producto${activeCart.count === 1 ? "" : "s"})` : ""}`}
        title={activeCart.label}
        className={activeCart.className}
      >
        {cartIcon}
        {activeCart.count > 0 ? (
          <span aria-hidden="true" className="navbar-cart-badge">
            {activeCart.count > 99 ? "99+" : activeCart.count}
          </span>
        ) : null}
      </button>
    </div>
  ) : null;

  return (
    <>
      {menuOpen ? <div className="navbar-backdrop" onClick={closeMenu} /> : null}

      <nav className={`navbar navbar-app-shell${!user ? " navbar-guest" : ""}`}>
        <div className="navbar-inner">
          <Link to="/" className="navbar-logo" onClick={closeMenu}>
            <img src="/logo.png" alt="Nande" />
          </Link>

          <Link to="/tienda" className="navbar-mobile-store-shortcut" onClick={closeMenuAndScrollTop}>
            Tienda Online
          </Link>

          <div className="navbar-links">
            <NavLink to="/" className={({ isActive }) => navClass(isActive)}>Inicio</NavLink>
            <NavLink to="/tienda" className={({ isActive }) => navClass(isActive)} onClick={() => scrollPageToTop()}>Tienda Online</NavLink>
            <NavLink to="/catalogo" className={({ isActive }) => navClass(isActive)}>Canjes</NavLink>
            {!canSeeVendedor ? <NavLink to="/sobre-nosotros" className={({ isActive }) => navClass(isActive)}>Quienes Somos</NavLink> : null}
            {!canSeeVendedor ? <NavLink to="/terminos" className={({ isActive }) => navClass(isActive)}>Terminos y condiciones</NavLink> : null}
            {!canSeeVendedor ? <NavLink to="/politica-privacidad" className={({ isActive }) => navClass(isActive)}>Politicas de privacidad</NavLink> : null}
            {canSeeCliente ? (
              <NavLink to="/soporte" className={({ isActive }) => navClass(isActive)}>
                {renderNavLabel("Mensajes", supportUnreadCount)}
              </NavLink>
            ) : null}
            {canSeeVendedor ? (
              <NavLink to="/staff/soporte" className={({ isActive }) => navClass(isActive)}>
                {renderNavLabel("Mensajes", supportUnreadCount)}
              </NavLink>
            ) : null}
            {canSeeVendedor ? <NavLink end to="/vendedor" className={({ isActive }) => navClass(isActive)}>Puntos y Canjes</NavLink> : null}
            {canSeeVendedor ? (
              <NavLink to="/vendedor/ventas/pedidos" className={({ isActive }) => navClass(isActive)}>
                {renderNavLabel("Ventas y Pedidos", staffOrdersAttentionCount)}
              </NavLink>
            ) : null}
            {canSeeVendedor ? <NavLink to={ordersMapPath} className={({ isActive }) => navClass(isActive)}>Mapa pedidos</NavLink> : null}
            {canSeeVendedor ? <NavLink to={shippingZonesPath} className={({ isActive }) => navClass(isActive)}>Zonas de envio</NavLink> : null}
            {canSeeAdmin ? <NavLink to={adminPanelPath} className={({ isActive }) => navClass(isActive)}>{adminPanelLabel}</NavLink> : null}
          </div>

          <div className="navbar-auth">
            {canSeeCliente ? (
              <NavLink to="/cliente" className={({ isActive }) => `navbar-points-action${isActive ? " active" : ""}`}>
                Mis Puntos
              </NavLink>
            ) : null}
            {user ? (
              <div className="navbar-user">
                <div ref={userMenuRef} className="navbar-user-menu">
                  <button
                    className="navbar-name-btn"
                    onClick={() => setUserMenuOpen((prev) => !prev)}
                    aria-expanded={userMenuOpen}
                    aria-haspopup="menu"
                  >
                    <span className="navbar-name-wrap">
                      <span className="navbar-name">{user.nombre}</span>
                      {pendingOrdersCount > 0 ? (
                        <span
                          className="navbar-link-badge navbar-link-badge-warning navbar-name-order-badge"
                          aria-label={pendingOrdersLabel}
                          title={pendingOrdersLabel}
                        >
                          {pendingOrdersCount > 99 ? "99+" : pendingOrdersCount}
                        </span>
                      ) : null}
                    </span>
                    <span className={`navbar-name-caret${userMenuOpen ? " open" : ""}`} />
                  </button>

                  {userMenuOpen ? (
                    <div className="navbar-user-dropdown" role="menu">
                      {user.rol === "cliente" ? (
                        <>
                          <Link
                            to="/mi-perfil"
                            className="navbar-user-dropdown-item"
                            onClick={() => setUserMenuOpen(false)}
                          >
                            Perfil
                          </Link>
                          <Link
                            to="/mis-direcciones"
                            className="navbar-user-dropdown-item"
                            onClick={() => setUserMenuOpen(false)}
                          >
                            Mis Direcciones
                          </Link>
                          <Link
                            to="/mis-canjes"
                            className="navbar-user-dropdown-item"
                            onClick={() => setUserMenuOpen(false)}
                          >
                            Mis Canjes
                          </Link>
                          <Link
                            to="/mis-pedidos"
                            className="navbar-user-dropdown-item"
                            onClick={() => setUserMenuOpen(false)}
                          >
                            {renderOrdersLabel()}
                          </Link>
                          <Link
                            to="/soporte"
                            className="navbar-user-dropdown-item"
                            onClick={() => setUserMenuOpen(false)}
                          >
                            Mensajes
                          </Link>
                          {renderArrepentimientosSummary("desktop")}
                        </>
                      ) : null}
                      {user.rol === "vendedor" || user.rol === "admin" || user.rol === "superAdmin" ? (
                        <>
                          <Link
                            to="/staff/soporte"
                            className="navbar-user-dropdown-item"
                            onClick={() => setUserMenuOpen(false)}
                          >
                            Mensajes
                          </Link>
                          <Link
                            to="/vendedor"
                            className="navbar-user-dropdown-item"
                            onClick={() => setUserMenuOpen(false)}
                          >
                            Puntos y Canjes
                          </Link>
                          <Link
                            to="/vendedor/ventas/pedidos"
                            className="navbar-user-dropdown-item"
                            onClick={() => setUserMenuOpen(false)}
                          >
                            Ventas y Pedidos
                          </Link>
                          <Link
                            to={ordersMapPath}
                            className="navbar-user-dropdown-item"
                            onClick={() => setUserMenuOpen(false)}
                          >
                            Mapa pedidos
                          </Link>
                          {user.rol === "vendedor" ? (
                            <Link
                              to={shippingZonesPath}
                              className="navbar-user-dropdown-item"
                              onClick={() => setUserMenuOpen(false)}
                            >
                              Zonas de envio
                            </Link>
                          ) : null}
                        </>
                      ) : null}
                      {user.rol === "admin" || user.rol === "superAdmin" ? (
                        <>
                          <Link
                            to={adminPanelPath}
                            className="navbar-user-dropdown-item"
                            onClick={() => setUserMenuOpen(false)}
                          >
                            {adminPanelLabel}
                          </Link>
                          <Link
                            to={`${adminPanelPath}/envios`}
                            className="navbar-user-dropdown-item"
                            onClick={() => setUserMenuOpen(false)}
                          >
                            Zonas de envio
                          </Link>
                        </>
                      ) : null}
                      <button
                        className="navbar-user-dropdown-item navbar-user-dropdown-logout"
                        onClick={() => {
                          logout();
                          setUserMenuOpen(false);
                          closeMenu();
                        }}
                      >
                        Salir
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <Link to="/login" className="navbar-btn-outline">Iniciar Sesion</Link>
                <Link to="/registro" className="navbar-btn-solid">Registrarse</Link>
              </div>
            )}
          </div>

          {cartButton}

          <button className="navbar-hamburger" onClick={() => setMenuOpen((prev) => !prev)} aria-label="Menu">
            <span />
            <span />
            <span />
            {navbarMobileBadgeCount > 0 ? (
              <span className="navbar-hamburger-badge" aria-hidden="true">
                {navbarMobileBadgeCount > 99 ? "99+" : navbarMobileBadgeCount}
              </span>
            ) : null}
          </button>
        </div>
      </nav>

      {menuOpen ? (
        <div className="navbar-mobile navbar-mobile-shell">
          <NavLink to="/" className={({ isActive }) => navClass(isActive)} onClick={closeMenu}>Inicio</NavLink>
          <NavLink to="/tienda" className={({ isActive }) => navClass(isActive)} onClick={closeMenuAndScrollTop}>Tienda Online</NavLink>
          <NavLink to="/catalogo" className={({ isActive }) => navClass(isActive)} onClick={closeMenu}>Canjes</NavLink>
          {!canSeeVendedor ? <NavLink to="/sobre-nosotros" className={({ isActive }) => navClass(isActive)} onClick={closeMenu}>Quienes Somos</NavLink> : null}
          {!canSeeVendedor ? <NavLink to="/terminos" className={({ isActive }) => navClass(isActive)} onClick={closeMenu}>Terminos y condiciones</NavLink> : null}
          {!canSeeVendedor ? <NavLink to="/politica-privacidad" className={({ isActive }) => navClass(isActive)} onClick={closeMenu}>Politicas de privacidad</NavLink> : null}
          {canSeeCliente ? (
            <NavLink to="/soporte" className={({ isActive }) => navClass(isActive)} onClick={closeMenu}>
              {renderNavLabel("Mensajes", supportUnreadCount)}
            </NavLink>
          ) : null}
          {canSeeVendedor ? (
            <NavLink to="/staff/soporte" className={({ isActive }) => navClass(isActive)} onClick={closeMenu}>
              {renderNavLabel("Mensajes", supportUnreadCount)}
            </NavLink>
          ) : null}
          {canSeeCliente ? <NavLink to="/cliente" className={({ isActive }) => navClass(isActive)} onClick={closeMenu}>Puntos</NavLink> : null}
          {canSeeVendedor ? <NavLink end to="/vendedor" className={({ isActive }) => navClass(isActive)} onClick={closeMenu}>Puntos y Canjes</NavLink> : null}
          {canSeeVendedor ? (
            <NavLink to="/vendedor/ventas/pedidos" className={({ isActive }) => navClass(isActive)} onClick={closeMenu}>
              {renderNavLabel("Ventas y Pedidos", staffOrdersAttentionCount)}
            </NavLink>
          ) : null}
          {canSeeVendedor ? <NavLink to={ordersMapPath} className={({ isActive }) => navClass(isActive)} onClick={closeMenu}>Mapa pedidos</NavLink> : null}
          {canSeeVendedor ? <NavLink to={shippingZonesPath} className={({ isActive }) => navClass(isActive)} onClick={closeMenu}>Zonas de envio</NavLink> : null}
          {canSeeAdmin ? <NavLink to={adminPanelPath} className={({ isActive }) => navClass(isActive)} onClick={closeMenu}>{adminPanelLabel}</NavLink> : null}

          <div className="navbar-mobile-divider" />

          <div className="navbar-mobile-auth">
            {user ? (
              <div className="navbar-mobile-user">
                <div className="navbar-mobile-user-head">
                  <span className="navbar-name">{user.nombre}</span>
                  {user.rol === "cliente" ? (
                    <span className="navbar-points" style={{ marginLeft: "0.5rem" }}>
                      {user.puntos_saldo ?? 0} pts
                    </span>
                  ) : null}
                </div>

                {user.rol === "cliente" ? (
                  <div className="navbar-mobile-user-links">
                    <Link to="/mi-perfil" className="navbar-link" onClick={closeMenu}>Perfil</Link>
                    <Link to="/mis-direcciones" className="navbar-link" onClick={closeMenu}>Mis Direcciones</Link>
                    <Link to="/mis-canjes" className="navbar-link" onClick={closeMenu}>Mis Canjes</Link>
                    <Link to="/mis-pedidos" className="navbar-link" onClick={closeMenu}>{renderOrdersLabel()}</Link>
                    <Link to="/soporte" className="navbar-link" onClick={closeMenu}>Mensajes</Link>
                    {renderArrepentimientosSummary("mobile")}
                  </div>
                ) : null}
                {user.rol === "vendedor" || user.rol === "admin" || user.rol === "superAdmin" ? (
                  <div className="navbar-mobile-user-links">
                    <Link to="/staff/soporte" className="navbar-link" onClick={closeMenu}>Mensajes</Link>
                    <Link to="/vendedor" className="navbar-link" onClick={closeMenu}>Puntos y Canjes</Link>
                    <Link to="/vendedor/ventas/pedidos" className="navbar-link" onClick={closeMenu}>Ventas y Pedidos</Link>
                    <Link to={ordersMapPath} className="navbar-link" onClick={closeMenu}>Mapa pedidos</Link>
                    {user.rol === "vendedor" ? (
                      <Link to={shippingZonesPath} className="navbar-link" onClick={closeMenu}>Zonas de envio</Link>
                    ) : null}
                    {(user.rol === "admin" || user.rol === "superAdmin") ? (
                      <>
                        <Link to={adminPanelPath} className="navbar-link" onClick={closeMenu}>{adminPanelLabel}</Link>
                        <Link to={`${adminPanelPath}/envios`} className="navbar-link" onClick={closeMenu}>Zonas de envio</Link>
                      </>
                    ) : null}
                  </div>
                ) : null}

                <button
                  className="navbar-logout"
                  onClick={() => {
                    logout();
                    closeMenu();
                  }}
                >
                  Salir
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <Link to="/login" className="navbar-mobile-btn navbar-btn-outline" onClick={closeMenu}>Iniciar Sesion</Link>
                <Link to="/registro" className="navbar-mobile-btn navbar-btn-solid" onClick={closeMenu}>Registrarse</Link>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
