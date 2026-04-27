import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { api } from "../../api";
import { StaticPageGallery } from "../../components/StaticPageGallery";
import { MAX_STATIC_PAGE_IMAGES, extractPageImageUrls, renderSafeMarkdown, stripPageImages } from "../../lib/pageContent";

type Pagina = {
  slug: string;
  titulo: string;
  contenido: string;
};

export function SobreNosotros() {
  useEffect(() => {
    document.body.classList.add("catalogo-background");
    return () => {
      document.body.classList.remove("catalogo-background");
    };
  }, []);

  const paginaQuery = useQuery({
    queryKey: ["paginas", "sobre-nosotros"],
    queryFn: () => api.get<Pagina>("/paginas/sobre-nosotros"),
  });

  const contenido = paginaQuery.data?.contenido || "";
  const imagenes = useMemo(() => extractPageImageUrls(contenido).slice(0, MAX_STATIC_PAGE_IMAGES), [contenido]);
  const html = useMemo(() => renderSafeMarkdown(stripPageImages(contenido)), [contenido]);

  return (
    <section className="pagina-page">
      <div className="pagina-card">
        {paginaQuery.isLoading ? <div className="pagina-placeholder">Cargando...</div> : null}
        {paginaQuery.error ? <div className="pagina-error">No se pudo cargar el contenido.</div> : null}

        {!paginaQuery.isLoading && !paginaQuery.error && paginaQuery.data ? (
          <div>
            <h1 className="pagina-title">{paginaQuery.data.titulo}</h1>
            <div className="pagina-content markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
            <StaticPageGallery images={imagenes} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

