import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import seoConfig from "../lib/seoConfig.json";

type MetaConfig = {
  title: string;
  description: string;
  canonicalPath: string;
  robots: string;
};

type PublicRouteConfig = Omit<MetaConfig, "robots"> & {
  changefreq?: string;
  priority?: string;
};

function setMeta(selector: string, attr: "content" | "href", value: string) {
  const element = document.head.querySelector(selector);
  if (!element) return;
  element.setAttribute(attr, value);
}

function getMetaForPath(pathname: string): MetaConfig {
  const publicRoutes = seoConfig.publicRoutes as Record<string, PublicRouteConfig>;
  const routeAliases = seoConfig.routeAliases as Record<string, string>;
  const normalizedPathname = routeAliases[pathname] ?? pathname;
  const directMatch = publicRoutes[normalizedPathname];

  if (directMatch) {
    return { ...directMatch, robots: seoConfig.publicRobots };
  }

  return {
    title: seoConfig.defaultTitle,
    description: seoConfig.defaultDescription,
    canonicalPath: pathname === "/" ? "/" : pathname,
    robots: seoConfig.defaultRobots,
  };
}

export function SeoRouteMeta() {
  const location = useLocation();

  useEffect(() => {
    const meta = getMetaForPath(location.pathname);
    document.title = meta.title;
    setMeta('meta[name="description"]', "content", meta.description);
    setMeta('meta[name="robots"]', "content", meta.robots);
    setMeta('link[rel="canonical"]', "href", `${seoConfig.siteOrigin}${meta.canonicalPath}`);
    setMeta('meta[property="og:url"]', "content", `${seoConfig.siteOrigin}${meta.canonicalPath}`);
    setMeta('meta[property="og:title"]', "content", meta.title);
    setMeta('meta[property="og:description"]', "content", meta.description);
    setMeta('meta[name="twitter:title"]', "content", meta.title);
    setMeta('meta[name="twitter:description"]', "content", meta.description);
  }, [location.pathname]);

  return null;
}
