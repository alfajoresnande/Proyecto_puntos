import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
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

export function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const location = useLocation();
  const navigate = useNavigate();

  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const cartItems = useCartStore((state) => state.items);

  const canSeeCliente = user?.rol === "cliente";
  const canSeeVendedor = user?.rol === "vendedor" || user?.rol === "admin" || user?.rol === "superAdmin";
  const canSeeAdmin = user?.rol === "admin" || user?.rol === "superAdmin";
  const adminPanelPath = user?.rol === "superAdmin" ? "/superadmin" : "/admin";
  const adminPanelLabel = user?.rol === "superAdmin" ? "Panel SuperAdmin" : "Panel Admin";
  const onlineCartQuery = useQuery({
    queryKey: ["cliente", "carrito-online"],
    queryFn: () => api.get<OnlineCartResponse>("/cliente/carrito"),
    enabled: canSeeCliente,
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

  function handleIrACarrito(target: string) {
    closeMenu();
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

      <nav className="navbar">
        <div className="navbar-inner">
          <Link to="/catalogo" className="navbar-logo" onClick={closeMenu}>
            <img src="/logo.png" alt="Nande" />
          </Link>

          <div className="navbar-links">
            <NavLink to="/tienda" className={({ isActive }) => navClass(isActive)}>Tienda Online</NavLink>
            <NavLink to="/catalogo" className={({ isActive }) => navClass(isActive)}>Canjes</NavLink>
            {!canSeeVendedor ? <NavLink to="/sobre-nosotros" className={({ isActive }) => navClass(isActive)}>Quienes Somos</NavLink> : null}
            {!canSeeVendedor ? <NavLink to="/terminos" className={({ isActive }) => navClass(isActive)}>Terminos</NavLink> : null}
            {canSeeCliente ? <NavLink to="/soporte" className={({ isActive }) => navClass(isActive)}>Mensajes</NavLink> : null}
            {canSeeVendedor ? <NavLink to="/staff/soporte" className={({ isActive }) => navClass(isActive)}>Mensajes</NavLink> : null}
            {canSeeVendedor ? <NavLink to="/vendedor" className={({ isActive }) => navClass(isActive)}>Cargar Puntos</NavLink> : null}
            {canSeeVendedor ? <NavLink to="/vendedor/pedidos" className={({ isActive }) => navClass(isActive)}>Pedidos</NavLink> : null}
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
                            Cargar Puntos
                          </Link>
                          <Link
                            to="/vendedor/pedidos"
                            className="navbar-user-dropdown-item"
                            onClick={() => setUserMenuOpen(false)}
                          >
                            Pedidos
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
          </button>
        </div>
      </nav>

      {menuOpen ? (
        <div className="navbar-mobile">
          <NavLink to="/tienda" className={({ isActive }) => navClass(isActive)} onClick={closeMenu}>Tienda Online</NavLink>
          <NavLink to="/catalogo" className={({ isActive }) => navClass(isActive)} onClick={closeMenu}>Canjes</NavLink>
          {!canSeeVendedor ? <NavLink to="/sobre-nosotros" className={({ isActive }) => navClass(isActive)} onClick={closeMenu}>Quienes Somos</NavLink> : null}
          {!canSeeVendedor ? <NavLink to="/terminos" className={({ isActive }) => navClass(isActive)} onClick={closeMenu}>Terminos</NavLink> : null}
          {canSeeCliente ? <NavLink to="/soporte" className={({ isActive }) => navClass(isActive)} onClick={closeMenu}>Mensajes</NavLink> : null}
          {canSeeVendedor ? <NavLink to="/staff/soporte" className={({ isActive }) => navClass(isActive)} onClick={closeMenu}>Mensajes</NavLink> : null}
          {canSeeCliente ? <NavLink to="/cliente" className={({ isActive }) => navClass(isActive)} onClick={closeMenu}>Puntos</NavLink> : null}
          {canSeeVendedor ? <NavLink to="/vendedor" className={({ isActive }) => navClass(isActive)} onClick={closeMenu}>Cargar Puntos</NavLink> : null}
          {canSeeVendedor ? <NavLink to="/vendedor/pedidos" className={({ isActive }) => navClass(isActive)} onClick={closeMenu}>Pedidos</NavLink> : null}
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
                    <Link to="/vendedor" className="navbar-link" onClick={closeMenu}>Cargar Puntos</Link>
                    <Link to="/vendedor/pedidos" className="navbar-link" onClick={closeMenu}>Pedidos</Link>
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
