import { Link } from "react-router-dom";
import { WHATSAPP_COMPANY_URL } from "../lib/contact";
import { useAuthStore } from "../store/authStore";

export function Footer() {
  const user = useAuthStore((state) => state.user);

  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-col footer-col-left">
          <Link to="/" className="footer-logo">
            <img src="/logo.png" alt="Nande" />
          </Link>
          <p className="footer-tagline">Casa de Alfajores, Dulces y Chocolates</p>
        </div>

        <div className="footer-col footer-col-center">
          <nav className="footer-nav-inline">
            <Link to="/" className="footer-link">Inicio</Link>
            <Link to="/tienda" className="footer-link">Tienda Online</Link>
            <Link to="/catalogo" className="footer-link">Canjes</Link>
            {!user ? <Link to="/login" className="footer-link">Iniciar Sesión</Link> : null}
            {!user ? <Link to="/registro" className="footer-link">Registrarse</Link> : null}
            {user?.rol === "cliente" ? <Link to="/cliente" className="footer-link">Mis Puntos</Link> : null}
            {user?.rol === "admin" ? <Link to="/admin" className="footer-link">Panel Admin</Link> : null}
            <Link to="/sobre-nosotros" className="footer-link">Quiénes Somos</Link>
            <Link to="/terminos" className="footer-link">Términos</Link>
            <a href={WHATSAPP_COMPANY_URL} target="_blank" rel="noreferrer" className="footer-link" aria-label="WhatsApp">
              WhatsApp
            </a>
            <a href="https://www.instagram.com/alfajorescorrentinos/" target="_blank" rel="noreferrer" className="footer-link" aria-label="Instagram">
              Instagram
            </a>
          </nav>
        </div>

        <div className="footer-col footer-col-right">
          <div className="footer-badges">
            <a
              href="https://www.pedidosya.com.ar/restaurantes/corrientes/alfajores-correntinos-nande-a5ba66b1-7378-415c-a059-dcfd2b0d15d2-menu"
              target="_blank"
              rel="noreferrer"
              className="footer-pedidosya-link"
              aria-label="Pedí por PedidosYa"
              title="Pedí por PedidosYa"
            >
              <svg className="footer-pedidosya-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />
              </svg>
              <span className="footer-pedidosya-text">Pedí por PedidosYa</span>
            </a>
            <img src="/orgullosamente_footer.png" alt="Orgullosamente Correntinos" className="footer-badge footer-badge-orgullo" />
            <img src="/hecho_en_corrientes.png" alt="Hecho en Corrientes" className="footer-badge footer-badge-hecho" />
          </div>
        </div>
      </div>
    </footer>
  );
}
