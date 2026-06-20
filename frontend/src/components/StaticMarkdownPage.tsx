import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { extractPageImageUrls, renderSafeMarkdown, stripPageImages } from "../lib/pageContent";
import { StaticPageGallery } from "./StaticPageGallery";

type PaginaContenido = {
  slug: string;
  titulo: string;
  contenido: string;
  updated_at?: string;
};

type StaticMarkdownPageProps = {
  slug: string;
  titleFallback: string;
  loadingMessage: string;
  errorMessage: string;
  bodyClassName?: string;
};

export function StaticMarkdownPage({
  slug,
  titleFallback,
  loadingMessage,
  errorMessage,
  bodyClassName = "catalogo-background",
}: StaticMarkdownPageProps) {
  const pageQuery = useQuery({
    queryKey: ["paginas", slug],
    queryFn: () => api.get<PaginaContenido>(`/paginas/${slug}`),
  });

  useEffect(() => {
    document.body.classList.add(bodyClassName);
    return () => {
      document.body.classList.remove(bodyClassName);
    };
  }, [bodyClassName]);

  const contenido = pageQuery.data?.contenido ?? "";
  const imagenes = useMemo(() => extractPageImageUrls(contenido), [contenido]);
  const html = useMemo(() => renderSafeMarkdown(stripPageImages(contenido)), [contenido]);

  return (
    <section className="pagina-page">
      <div className="pagina-card">
        <h1 className="pagina-title">{pageQuery.data?.titulo || titleFallback}</h1>
        {pageQuery.isLoading ? (
          <p className="pagina-content">{loadingMessage}</p>
        ) : pageQuery.isError ? (
          <p className="pagina-content">{errorMessage}</p>
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
