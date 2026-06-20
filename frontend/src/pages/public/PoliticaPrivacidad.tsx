import { StaticMarkdownPage } from "../../components/StaticMarkdownPage";

export function PoliticaPrivacidad() {
  return (
    <StaticMarkdownPage
      slug="politica-privacidad"
      titleFallback="Politica de Privacidad"
      loadingMessage="Cargando politica de privacidad..."
      errorMessage="No pudimos cargar la politica de privacidad en este momento."
    />
  );
}
