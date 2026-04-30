import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { useCartStore } from "../store/cartStore";

function navClass(isActive: boolean): string {
  return `navbar-link${isActive ? " active" : ""}`;
}

export function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const location = useLocation();

  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const cartItems = useCartStore((state) => state.items);

  const canSeeCliente = user?.rol === "cliente";
  const canSeeVendedor = user?.rol === "vendedor" || user?.rol === "admin";
  const canSeeAdmin = user?.rol === "admin";

  const cartCount = useMemo(
    () => Object.values(cartItems).reduce((acc, qty) => acc + qty, 0),
    [cartItems],
  );

  const closeMenu = () => setMenuOpen(false);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (userMenuRef.current?.contains(target)) return;
      setUserMenuOpen(false);
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

  return (
    <>
      {menuOpen ? <div className="navbar-backdrop" onClick={closeMenu} /> : null}

      <nav className="navbar">
        <div className="navbar-inner">
          <Link to="/catalogo" className="navbar-logo" onClick={closeMenu}>
            <img src="/logo.png" alt="Nande" />
          </Link>

          <div className="navbar-links">
            <NavLink to="/catalogo" className={({ isActive }) => navClass(isActive)}>Catalogo</NavLink>
            {!canSeeVendedor ? <NavLink to="/sobre-nosotros" className={({ isActive }) => navClass(isActive)}>Quienes Somos</NavLink> : null}
            {!canSeeVendedor ? <NavLink to="/terminos" className={({ isActive }) => navClass(isActive)}>Terminos</NavLink> : null}
            {canSeeCliente ? <NavLink to="/cliente" className={({ isActive }) => navClass(isActive)}>Puntos</NavLink> : null}
            {canSeeVendedor ? <NavLink to="/vendedor" className={({ isActive }) => navClass(isActive)}>Cargar Puntos</NavLink> : null}
            {canSeeAdmin ? <NavLink to="/admin" className={({ isActive }) => navClass(isActive)}>Panel Admin</NavLink> : null}
          </div>

          <div className="navbar-auth">
            {user ? (
              <div className="navbar-user">
                {canSeeCliente ? (
                  <Link
                    to="/catalogo#carrito"
                    className="navbar-cart-btn"
                    aria-label={`Carrito de canje${cartCount > 0 ? ` (${cartCount} producto${cartCount === 1 ? "" : "s"})` : ""}`}
                    title="Carrito de canje"
                    style={{
                      position: "relative",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: "38px",
                      height: "38px",
                      borderRadius: "10px",
                      color: "#6B3E26",
                      textDecoration: "none",
                    }}
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
                      <line x1="3" y1="6" x2="21" y2="6" />
                      <path d="M16 10a4 4 0 0 1-8 0" />
                    </svg>
                    {cartCount > 0 ? (
                      <span
                        aria-hidden="true"
                        style={{
                          position: "absolute",
                          top: "-2px",
                          right: "-2px",
                          minWidth: "18px",
                          height: "18px",
                          padding: "0 5px",
                          borderRadius: "999px",
                          background: "#D4621A",
                          color: "#fff",
                          fontSize: "0.7rem",
                          fontWeight: 700,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          lineHeight: 1,
                        }}
                      >
                        {cartCount > 99 ? "99+" : cartCount}
                      </span>
                    ) : null}
                  </Link>
                ) : null}
                {user.rol === "cliente" ? <span className="navbar-points">{user.puntos_saldo ?? 0} pts</span> : null}
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

          <button className="navbar-hamburger" onClick={() => setMenuOpen((prev) => !prev)} aria-label="Menu">
            <span />
            <span />
            <span />
          </button>
        </div>
      </nav>

      {menuOpen ? (
        <div className="navbar-mobile">
          <NavLink to="/catalogo" className={({ isActive }) => navClass(isActive)} onClick={closeMenu}>Catalogo</NavLink>
          {!canSeeVendedor ? <NavLink to="/sobre-nosotros" className={({ isActive }) => navClass(isActive)} onClick={closeMenu}>Quienes Somos</NavLink> : null}
          {!canSeeVendedor ? <NavLink to="/terminos" className={({ isActive }) => navClass(isActive)} onClick={closeMenu}>Terminos</NavLink> : null}
          {canSeeCliente ? <NavLink to="/cliente" className={({ isActive }) => navClass(isActive)} onClick={closeMenu}>Puntos</NavLink> : null}
          {canSeeCliente ? (
            <Link to="/catalogo#carrito" className="navbar-link" onClick={closeMenu}>
              Carrito{cartCount > 0 ? ` (${cartCount})` : ""}
            </Link>
          ) : null}
          {canSeeVendedor ? <NavLink to="/vendedor" className={({ isActive }) => navClass(isActive)} onClick={closeMenu}>Cargar Puntos</NavLink> : null}
          {canSeeAdmin ? <NavLink to="/admin" className={({ isActive }) => navClass(isActive)} onClick={closeMenu}>Panel Admin</NavLink> : null}

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
