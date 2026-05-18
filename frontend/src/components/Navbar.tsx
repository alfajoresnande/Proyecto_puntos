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
  estado: "pendiente_pago" | "pagada" | "preparada" | "enviada" | "entregada" | "cancelada" | "expirada" | string;
  pago?: {
    proveedor: string;
    metodo: string | null;
    estado: string;
  } | null;
};

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
        if (order.estado === "pagada" || order.estado === "preparada") return true;
        if (order.estado !== "pendiente_pago") return false;
        return order.pago?.proveedor === "efectivo" || order.pago?.metodo === "cash";
      }).length,
    [staffOrdersQuery.data],
  );
  const navbarMobileBadgeCount = supportUnreadCount + (canSeeVendedor ? staffOrdersAttentionCount : 0);
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
          <Link to="/inicio" className="navbar-logo" onClick={closeMenu}>
            <img src="/logo.png" alt="Nande" />
          </Link>

          <Link to="/tienda" className="navbar-mobile-store-shortcut" onClick={closeMenuAndScrollTop}>
            Tienda Online
          </Link>

          <div className="navbar-links">
            <NavLink to="/inicio" className={({ isActive }) => navClass(isActive)}>Inicio</NavLink>
            <NavLink to="/tienda" className={({ isActive }) => navClass(isActive)} onClick={() => scrollPageToTop()}>Tienda Online</NavLink>
            <NavLink to="/catalogo" className={({ isActive }) => navClass(isActive)}>Canjes</NavLink>
            {!canSeeVendedor ? <NavLink to="/sobre-nosotros" className={({ isActive }) => navClass(isActive)}>Quienes Somos</NavLink> : null}
            {!canSeeVendedor ? <NavLink to="/terminos" className={({ isActive }) => navClass(isActive)}>Terminos</NavLink> : null}
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
            {canSeeVendedor ? <NavLink to="/vendedor" className={({ isActive }) => navClass(isActive)}>Puntos y Canjes</NavLink> : null}
            {canSeeVendedor ? (
              <NavLink to="/vendedor/ventas/pedidos" className={({ isActive }) => navClass(isActive)}>
                {renderNavLabel("Ventas y Pedidos", staffOrdersAttentionCount)}
              </NavLink>
            ) : null}
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
                    <span className="navbar-name">{user.nombre}</span>
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
                            Mis Pedidos
                          </Link>
                          <Link
                            to="/soporte"
                            className="navbar-user-dropdown-item"
                            onClick={() => setUserMenuOpen(false)}
                          >
                            Mensajes
                          </Link>
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
                        </>
                      ) : null}
                      {user.rol === "admin" || user.rol === "superAdmin" ? (
                        <Link
                          to={adminPanelPath}
                          className="navbar-user-dropdown-item"
                          onClick={() => setUserMenuOpen(false)}
                        >
                          {adminPanelLabel}
                        </Link>
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
          <NavLink to="/inicio" className={({ isActive }) => navClass(isActive)} onClick={closeMenu}>Inicio</NavLink>
          <NavLink to="/tienda" className={({ isActive }) => navClass(isActive)} onClick={closeMenuAndScrollTop}>Tienda Online</NavLink>
          <NavLink to="/catalogo" className={({ isActive }) => navClass(isActive)} onClick={closeMenu}>Canjes</NavLink>
          {!canSeeVendedor ? <NavLink to="/sobre-nosotros" className={({ isActive }) => navClass(isActive)} onClick={closeMenu}>Quienes Somos</NavLink> : null}
          {!canSeeVendedor ? <NavLink to="/terminos" className={({ isActive }) => navClass(isActive)} onClick={closeMenu}>Terminos</NavLink> : null}
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
          {canSeeVendedor ? <NavLink to="/vendedor" className={({ isActive }) => navClass(isActive)} onClick={closeMenu}>Puntos y Canjes</NavLink> : null}
          {canSeeVendedor ? (
            <NavLink to="/vendedor/ventas/pedidos" className={({ isActive }) => navClass(isActive)} onClick={closeMenu}>
              {renderNavLabel("Ventas y Pedidos", staffOrdersAttentionCount)}
            </NavLink>
          ) : null}
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
                    <Link to="/mis-canjes" className="navbar-link" onClick={closeMenu}>Mis Canjes</Link>
                    <Link to="/mis-pedidos" className="navbar-link" onClick={closeMenu}>Mis Pedidos</Link>
                    <Link to="/soporte" className="navbar-link" onClick={closeMenu}>Mensajes</Link>
                  </div>
                ) : null}
                {user.rol === "vendedor" || user.rol === "admin" || user.rol === "superAdmin" ? (
                  <div className="navbar-mobile-user-links">
                    <Link to="/staff/soporte" className="navbar-link" onClick={closeMenu}>Mensajes</Link>
                    <Link to="/vendedor" className="navbar-link" onClick={closeMenu}>Puntos y Canjes</Link>
                    <Link to="/vendedor/ventas/pedidos" className="navbar-link" onClick={closeMenu}>Ventas y Pedidos</Link>
                    {(user.rol === "admin" || user.rol === "superAdmin") ? (
                      <Link to={adminPanelPath} className="navbar-link" onClick={closeMenu}>{adminPanelLabel}</Link>
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
