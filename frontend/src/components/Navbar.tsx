import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useAuthStore } from "../store/authStore";

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

  const canSeeCliente = user?.rol === "cliente";
  const canSeeVendedor = user?.rol === "vendedor" || user?.rol === "admin";
  const canSeeAdmin = user?.rol === "admin";

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
          <Link to="/" className="navbar-logo" onClick={closeMenu}>
            <img src="/logo.png" alt="Nande" />
          </Link>

          <div className="navbar-links">
            <NavLink to="/" className={({ isActive }) => navClass(isActive)}>Catalogo</NavLink>
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

          <button className="navbar-hamburger" onClick={() => setMenuOpen((prev) => !prev)} aria-label="Menu">
            <span />
            <span />
            <span />
          </button>
        </div>
      </nav>

      {menuOpen ? (
        <div className="navbar-mobile">
          <NavLink to="/" className={({ isActive }) => navClass(isActive)} onClick={closeMenu}>Catalogo</NavLink>
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
