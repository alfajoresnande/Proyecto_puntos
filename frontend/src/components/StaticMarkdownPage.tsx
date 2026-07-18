import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { extractPageImageUrls, renderStaticPageMarkdown } from "../lib/pageContent";
import { StaticPageGallery } from "./StaticPageGallery";
import { StaticPageTableOfContents } from "./StaticPageTableOfContents";

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
  const renderedPage = useMemo(() => renderStaticPageMarkdown(contenido), [contenido]);
  const html = renderedPage.html;

  useEffect(() => {
    if (!html || pageQuery.isLoading || pageQuery.isError) return;

    const rawHash = window.location.hash.slice(1).trim();
    if (!rawHash) return;

    let targetId = rawHash;
    try {
      targetId = decodeURIComponent(rawHash);
    } catch {
      targetId = rawHash;
    }

    const frameId = window.requestAnimationFrame(() => {
      const target = document.getElementById(targetId);
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [html, pageQuery.isError, pageQuery.isLoading]);

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
            <StaticPageTableOfContents headings={renderedPage.headings} />
            <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
            <StaticPageGallery images={imagenes} />
          </>
        )}
      </div>
    </section>
  );
}
