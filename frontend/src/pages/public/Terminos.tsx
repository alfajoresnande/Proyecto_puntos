import { StaticMarkdownPage } from "../../components/StaticMarkdownPage";

export function Terminos() {
  return (
    <StaticMarkdownPage
      slug="terminos"
      titleFallback="Terminos y Condiciones"
      loadingMessage="Cargando terminos..."
      errorMessage="No pudimos cargar los terminos en este momento."
    />
  );
}
