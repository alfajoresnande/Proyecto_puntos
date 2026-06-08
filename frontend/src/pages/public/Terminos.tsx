import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api";
import { StaticPageGallery } from "../../components/StaticPageGallery";
import { extractPageImageUrls, renderSafeMarkdown, stripPageImages } from "../../lib/pageContent";

type PaginaContenido = {
  slug: string;
  titulo: string;
  contenido: string;
  updated_at?: string;
};

export function Terminos() {
  const terminosQuery = useQuery({
    queryKey: ["paginas", "terminos"],
    queryFn: () => api.get<PaginaContenido>("/paginas/terminos"),
  });

  useEffect(() => {
    document.body.classList.add("catalogo-background");
    return () => {
      document.body.classList.remove("catalogo-background");
    };
  }, []);

  const contenido = terminosQuery.data?.contenido ?? "";
  const imagenes = useMemo(() => extractPageImageUrls(contenido), [contenido]);
  const html = useMemo(() => renderSafeMarkdown(stripPageImages(contenido)), [contenido]);

  return (
    <section className="pagina-page">
      <div className="pagina-card">
        <h1 className="pagina-title">{terminosQuery.data?.titulo || "Terminos y Condiciones"}</h1>
        {terminosQuery.isLoading ? (
          <p className="pagina-content">Cargando terminos...</p>
        ) : terminosQuery.isError ? (
          <p className="pagina-content">No pudimos cargar los terminos en este momento.</p>
        ) : (
          <>
            <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
            <StaticPageGallery images={imagenes} />
          </>
        )}
      </div>
    </section>
  );
}
