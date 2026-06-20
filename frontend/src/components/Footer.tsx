import { Link } from "react-router-dom";
import { INSTAGRAM_PROFILE_URL, WHATSAPP_COMPANY_URL } from "../lib/contact";

const PAGE_LINKS = [
  { to: "/tienda", label: "Tienda Online" },
  { to: "/catalogo", label: "Canjes" },
  { to: "/sobre-nosotros", label: "Quienes Somos" },
  { to: "/terminos", label: "Terminos y condiciones" },
  { to: "/politica-privacidad", label: "Politicas de privacidad" },
  { to: "/boton-arrepentimiento", label: "Boton de arrepentimiento" },
] as const;

const SOCIAL_LINKS = [
  { href: INSTAGRAM_PROFILE_URL, label: "Instagram" },
  { href: WHATSAPP_COMPANY_URL, label: "WhatsApp" },
] as const;

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-col footer-col-left">
          <Link to="/" className="footer-logo" aria-label="Ir al inicio de Nande">
            <img src="/logo.png" alt="Nande" />
          </Link>
          <p className="footer-tagline">Casa de Alfajores, Dulces y Chocolates</p>
        </div>

        <div className="footer-col footer-col-center">
          <section className="footer-group" aria-labelledby="footer-pages-title">
            <h3 id="footer-pages-title" className="footer-group-title">Paginas</h3>
            <nav className="footer-list" aria-label="Paginas del sitio">
              {PAGE_LINKS.map((item) => (
                <Link key={item.to} to={item.to} className="footer-link">
                  {item.label}
                </Link>
              ))}
            </nav>
          </section>

          <section className="footer-group" aria-labelledby="footer-social-title">
            <h3 id="footer-social-title" className="footer-group-title">Seguinos en</h3>
            <div className="footer-list" aria-label="Redes sociales">
              {SOCIAL_LINKS.map((item) => (
                <a key={item.href} href={item.href} target="_blank" rel="noreferrer" className="footer-link">
                  {item.label}
                </a>
              ))}
            </div>
          </section>
        </div>

        <div className="footer-col footer-col-right">
          <div className="footer-badges">
            <img
              src="/orgullosamente_footer.png"
              alt="Orgullosamente Correntinos"
              className="footer-badge footer-badge-orgullo"
            />
            <img
              src="/hecho_en_corrientes.png"
              alt="Hecho en Corrientes"
              className="footer-badge footer-badge-hecho"
            />
          </div>
        </div>
      </div>
    </footer>
  );
}
