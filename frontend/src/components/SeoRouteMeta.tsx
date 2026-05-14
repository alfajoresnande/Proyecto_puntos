import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const SITE_ORIGIN = "https://alfajorescorrentinos.com";
const DEFAULT_TITLE = "Ñandé Alfajores Correntinos | Tienda Online y Programa de Puntos";
const DEFAULT_DESCRIPTION =
  "Comprá alfajores correntinos artesanales online. Compra web con retiro en sucursal y programa de puntos para canjear productos.";

type MetaConfig = {
  title: string;
  description: string;
  canonicalPath: string;
  robots: string;
};

function setMeta(selector: string, attr: "content" | "href", value: string) {
  const element = document.head.querySelector(selector);
  if (!element) return;
  element.setAttribute(attr, value);
}

function getMetaForPath(pathname: string): MetaConfig {
  const publicRoutes: Record<string, Omit<MetaConfig, "robots">> = {
    "/": {
      title: "Ñandé Alfajores Correntinos | Alfajores artesanales, puntos y canjes",
      description:
        "Descubrí Ñandé Alfajores Correntinos: compra online, retiro en sucursal, programa de puntos y catálogo de canjes.",
      canonicalPath: "/",
    },
    "/tienda": {
      title: "Tienda Online | Ñandé Alfajores Correntinos",
      description:
        "Comprá alfajores correntinos y productos de Ñandé online con retiro en sucursal. Catálogo actualizado y compra simple.",
      canonicalPath: "/tienda",
    },
    "/catalogo": {
      title: "Canjes y Programa de Puntos | Ñandé Alfajores Correntinos",
      description:
        "Canjeá tus puntos por productos de Ñandé. Descubrí el catálogo de canjes y elegí tu sucursal de retiro.",
      canonicalPath: "/catalogo",
    },
    "/sobre-nosotros": {
      title: "Quiénes Somos | Ñandé Alfajores Correntinos",
      description:
        "Conocé la historia de Ñandé Alfajores Correntinos, nuestra propuesta artesanal y el origen de nuestros productos.",
      canonicalPath: "/sobre-nosotros",
    },
    "/terminos": {
      title: "Términos y Condiciones | Ñandé Alfajores Correntinos",
      description:
        "Consultá los términos y condiciones de uso, compras, canjes y programa de puntos de Ñandé Alfajores Correntinos.",
      canonicalPath: "/terminos",
    },
  };

  const directMatch = publicRoutes[pathname];
  if (directMatch) {
    return { ...directMatch, robots: "index, follow" };
  }

  return {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    canonicalPath: pathname === "/" ? "/" : pathname,
    robots: "noindex, nofollow",
  };
}

export function SeoRouteMeta() {
  const location = useLocation();

  useEffect(() => {
    const meta = getMetaForPath(location.pathname);
    document.title = meta.title;
    setMeta('meta[name="description"]', "content", meta.description);
    setMeta('meta[name="robots"]', "content", meta.robots);
    setMeta('link[rel="canonical"]', "href", `${SITE_ORIGIN}${meta.canonicalPath}`);
    setMeta('meta[property="og:url"]', "content", `${SITE_ORIGIN}${meta.canonicalPath}`);
    setMeta('meta[property="og:title"]', "content", meta.title);
    setMeta('meta[property="og:description"]', "content", meta.description);
    setMeta('meta[name="twitter:title"]', "content", meta.title);
    setMeta('meta[name="twitter:description"]', "content", meta.description);
  }, [location.pathname]);

  return null;
}
