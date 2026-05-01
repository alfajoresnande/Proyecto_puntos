import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { useCartStore } from "../store/cartStore";

function navClass(isActive: boolean): string {
  return `navbar-link${isActive ? " active" : ""}`;
}

export function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [cartMenuOpen, setCartMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const cartMenuRef = useRef<HTMLDivElement | null>(null);
  const location = useLocation();
  const navigate = useNavigate();

  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const cartItems = useCartStore((state) => state.items);
  const cartIncrement = useCartStore((state) => state.increment);
  const cartDecrement = useCartStore((state) => state.decrement);
  const cartClear = useCartStore((state) => state.clear);
  const requestCanje = useCartStore((state) => state.requestCanje);

  const canSeeCliente = user?.rol === "cliente";
  const canSeeVendedor = user?.rol === "vendedor" || user?.rol === "admin";
  const canSeeAdmin = user?.rol === "admin";

  const cartList = useMemo(() => Object.values(cartItems), [cartItems]);
  const cartCount = useMemo(
    () => cartList.reduce((acc, item) => acc + item.cantidad, 0),
    [cartList],
  );
  const cartTotalPuntos = useMemo(
    () => cartList.reduce((acc, item) => acc + item.puntos_requeridos * item.cantidad, 0),
    [cartList],
  );

  const closeMenu = () => setMenuOpen(false);

  function handleCanjearDesdeNavbar() {
    setCartMenuOpen(false);
    closeMenu();
    requestCanje();
    if (location.pathname !== "/catalogo") {
      navigate("/catalogo");
    }
  }

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (!userMenuRef.current?.contains(target)) setUserMenuOpen(false);
      if (!cartMenuRef.current?.contains(target)) setCartMenuOpen(false);
    }

    function onEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setUserMenuOpen(false);
        setCartMenuOpen(false);
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
    setCartMenuOpen(false);
  }, [location.pathname, location.hash]);

  const cartButton = canSeeCliente ? (
    <div ref={cartMenuRef} style={{ position: "relative", marginRight: "0.4rem" }}>
      <button
        type="button"
        onClick={() => setCartMenuOpen((prev) => !prev)}
        aria-label={`Carrito de canje${cartCount > 0 ? ` (${cartCount} producto${cartCount === 1 ? "" : "s"})` : ""}`}
        aria-expanded={cartMenuOpen}
        aria-haspopup="menu"
        title="Carrito de canje"
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "42px",
          height: "42px",
          borderRadius: "50%",
          color: "#ffffff",
          background: cartMenuOpen ? "#B5521A" : "#D4621A",
          border: "none",
          cursor: "pointer",
          padding: 0,
          boxShadow: "0 2px 8px rgba(212, 98, 26, 0.45)",
          transition: "background 0.15s ease, transform 0.15s ease",
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="9" cy="21" r="1.6" />
          <circle cx="18" cy="21" r="1.6" />
          <path d="M2.5 3h2.4l2.7 12.3a2 2 0 0 0 2 1.7h8.5a2 2 0 0 0 2-1.6L21.5 7H6" />
        </svg>
        {cartCount > 0 ? (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              top: "-3px",
              right: "-3px",
              minWidth: "20px",
              height: "20px",
              padding: "0 5px",
              borderRadius: "999px",
              background: "#ffffff",
              color: "#D4621A",
              fontSize: "0.72rem",
              fontWeight: 800,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              lineHeight: 1,
              boxShadow: "0 0 0 2px #D4621A",
            }}
          >
            {cartCount > 99 ? "99+" : cartCount}
          </span>
        ) : null}
      </button>

      {cartMenuOpen ? (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width: "min(340px, calc(100vw - 24px))",
            maxHeight: "min(70vh, 480px)",
            overflowY: "auto",
            background: "#fff",
            borderRadius: "14px",
            boxShadow: "0 10px 30px rgba(74, 44, 26, 0.18)",
            border: "1px solid #E6D3B8",
            padding: "0.85rem",
            zIndex: 1100,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.6rem" }}>
            <p style={{ margin: 0, fontWeight: 700, color: "#4A2C1A" }}>
              Carrito ({cartCount})
            </p>
            <p style={{ margin: 0, fontWeight: 700, color: "#6B3E26" }}>
              {cartTotalPuntos} pts
            </p>
          </div>

          {cartList.length === 0 ? (
            <p style={{ margin: "0.5rem 0", color: "#8B5A30", fontSize: "0.85rem" }}>
              Tu carrito esta vacio. Agrega productos desde el catalogo.
            </p>
          ) : (
            <div style={{ display: "grid", gap: "0.4rem" }}>
              {cartList.map((item) => (
                <div
                  key={item.producto_id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "0.5rem",
                    border: "1px solid #E6D3B8",
                    borderRadius: "10px",
                    padding: "0.4rem 0.5rem",
                    background: "#FFFDF8",
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p style={{ margin: 0, color: "#4A2C1A", fontWeight: 600, fontSize: "0.85rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.nombre}
                    </p>
                    <p style={{ margin: "0.1rem 0 0", color: "#8B5A30", fontSize: "0.74rem" }}>
                      {item.puntos_requeridos * item.cantidad} pts
                    </p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={() => cartDecrement(item.producto_id)}
                      style={{
                        width: "26px", height: "26px", borderRadius: "50%",
                        border: "1px solid #E6D3B8", background: "#fff",
                        color: "#4A2C1A", fontWeight: 700, cursor: "pointer",
                      }}
                    >−</button>
                    <span style={{ minWidth: "20px", textAlign: "center", fontWeight: 700, color: "#4A2C1A" }}>
                      {item.cantidad}
                    </span>
                    <button
                      type="button"
                      onClick={() => cartIncrement(item.producto_id)}
                      style={{
                        width: "26px", height: "26px", borderRadius: "50%",
                        border: "1px solid #E6D3B8", background: "#fff",
                        color: "#4A2C1A", fontWeight: 700, cursor: "pointer",
                      }}
                    >+</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
            <button
              type="button"
              disabled={cartList.length === 0}
              onClick={handleCanjearDesdeNavbar}
              style={{
                flex: 1,
                padding: "0.55rem 0.75rem",
                borderRadius: "10px",
                border: "none",
                background: cartList.length === 0 ? "#E6D3B8" : "#D4621A",
                color: "#fff",
                fontWeight: 700,
                cursor: cartList.length === 0 ? "not-allowed" : "pointer",
              }}
            >
              Canjear carrito
            </button>
            <button
              type="button"
              disabled={cartList.length === 0}
              onClick={() => cartClear()}
              style={{
                padding: "0.55rem 0.75rem",
                borderRadius: "10px",
                border: "1px solid #E6D3B8",
                background: "#fff",
                color: "#4A2C1A",
                fontWeight: 600,
                cursor: cartList.length === 0 ? "not-allowed" : "pointer",
              }}
            >
              Vaciar
            </button>
          </div>
        </div>
      ) : null}
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

          {/* Cart icon — siempre visible (desktop y mobile) cuando es cliente */}
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
          <NavLink to="/catalogo" className={({ isActive }) => navClass(isActive)} onClick={closeMenu}>Catalogo</NavLink>
          {!canSeeVendedor ? <NavLink to="/sobre-nosotros" className={({ isActive }) => navClass(isActive)} onClick={closeMenu}>Quienes Somos</NavLink> : null}
          {!canSeeVendedor ? <NavLink to="/terminos" className={({ isActive }) => navClass(isActive)} onClick={closeMenu}>Terminos</NavLink> : null}
          {canSeeCliente ? <NavLink to="/cliente" className={({ isActive }) => navClass(isActive)} onClick={closeMenu}>Puntos</NavLink> : null}
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
