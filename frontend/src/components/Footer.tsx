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
            <Link to="/" className="footer-link">Catalogo</Link>
            {!user ? <Link to="/login" className="footer-link">Iniciar Sesion</Link> : null}
            {!user ? <Link to="/registro" className="footer-link">Registrarse</Link> : null}
            {user?.rol === "cliente" ? <Link to="/cliente" className="footer-link">Mis Puntos</Link> : null}
            {user?.rol === "admin" ? <Link to="/admin" className="footer-link">Panel Admin</Link> : null}
            <Link to="/sobre-nosotros" className="footer-link">Sobre Nosotros</Link>
            <Link to="/terminos" className="footer-link">Terminos</Link>
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
            <img src="/orgullosamente_footer.png" alt="Orgullosamente Correntinos" className="footer-badge footer-badge-orgullo" />
            <img src="/hecho_en_corrientes.png" alt="Hecho en Corrientes" className="footer-badge footer-badge-hecho" />
          </div>
        </div>
      </div>
    </footer>
  );
}
