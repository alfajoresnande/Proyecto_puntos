import { Link } from "react-router-dom";
import { INSTAGRAM_PROFILE_URL, WHATSAPP_COMPANY_URL } from "../lib/contact";

const PAGE_LINKS = [
  { to: "/tienda", label: "Tienda Online" },
  { to: "/catalogo", label: "Canjes" },
  { to: "/sobre-nosotros", label: "Quienes Somos" },
  { to: "/terminos", label: "Terminos y condiciones" },
  { to: "/politica-privacidad", label: "Politica de privacidad" },
  { to: "/boton-arrepentimiento", label: "Boton de arrepentimiento" },
] as const;

const SOCIAL_LINKS = [
  { href: INSTAGRAM_PROFILE_URL, label: "Instagram" },
  { href: WHATSAPP_COMPANY_URL, label: "WhatsApp" },
] as const;

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-shell">
        <div className="footer-brand">
          <Link to="/" className="footer-logo" aria-label="Ir al inicio de Nande">
            <img src="/logo.png" alt="Nande" />
          </Link>
          <p className="footer-tagline">Casa de Alfajores, Dulces y Chocolates</p>
        </div>

        <div className="footer-sections">
          <section className="footer-section" aria-labelledby="footer-pages-title">
            <h3 id="footer-pages-title" className="footer-title">Paginas</h3>
            <nav className="footer-links" aria-label="Paginas del sitio">
              {PAGE_LINKS.map((item) => (
                <Link key={item.to} to={item.to} className="footer-link">
                  {item.label}
                </Link>
              ))}
            </nav>
          </section>

          <section className="footer-section" aria-labelledby="footer-social-title">
            <h3 id="footer-social-title" className="footer-title">Seguinos en</h3>
            <div className="footer-links footer-links-social">
              {SOCIAL_LINKS.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  target="_blank"
                  rel="noreferrer"
                  className="footer-link footer-social-link"
                >
                  {item.label}
                </a>
              ))}
            </div>
          </section>
        </div>
      </div>
    </footer>
  );
}
