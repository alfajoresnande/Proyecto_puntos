import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <section style={{ maxWidth: 760, margin: "4rem auto", padding: "0 1rem", textAlign: "center" }}>
      <h1 style={{ marginBottom: "0.75rem" }}>404 - Pagina no encontrada</h1>
      <p style={{ marginBottom: "1.25rem" }}>
        La ruta que abriste no existe en el frontend.
      </p>
      <Link to="/" style={{ textDecoration: "underline" }}>
        Volver al inicio
      </Link>
    </section>
  );
}
