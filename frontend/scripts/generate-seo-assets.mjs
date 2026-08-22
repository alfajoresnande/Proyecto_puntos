import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, "..");
const distDir = path.join(frontendRoot, "dist");
const configPath = path.join(frontendRoot, "src", "lib", "seoConfig.json");
const indexPath = path.join(distDir, "index.html");

const seoConfig = JSON.parse(await readFile(configPath, "utf8"));
const baseHtml = await readFile(indexPath, "utf8");
const publicRoutes = seoConfig.publicRoutes;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceOrInsertHeadTag(html, pattern, tag) {
  if (pattern.test(html)) {
    return html.replace(pattern, tag);
  }

  return html.replace("</head>", `    ${tag}\n  </head>`);
}

function setTitle(html, title) {
  return replaceOrInsertHeadTag(
    html,
    /<title>[\s\S]*?<\/title>/i,
    `<title>${escapeHtml(title)}</title>`,
  );
}

function setMetaName(html, name, content) {
  const pattern = new RegExp(`<meta\\s+[^>]*name=["']${escapeRegExp(name)}["'][^>]*>`, "i");
  const tag = `<meta name="${escapeAttribute(name)}" content="${escapeAttribute(content)}" />`;
  return replaceOrInsertHeadTag(html, pattern, tag);
}

function setMetaProperty(html, property, content) {
  const pattern = new RegExp(`<meta\\s+[^>]*property=["']${escapeRegExp(property)}["'][^>]*>`, "i");
  const tag = `<meta property="${escapeAttribute(property)}" content="${escapeAttribute(content)}" />`;
  return replaceOrInsertHeadTag(html, pattern, tag);
}

function setCanonical(html, href) {
  const pattern = /<link\s+[^>]*rel=["']canonical["'][^>]*>/i;
  const tag = `<link rel="canonical" href="${escapeAttribute(href)}" />`;
  return replaceOrInsertHeadTag(html, pattern, tag);
}

function canonicalUrl(routeConfig) {
  return `${seoConfig.siteOrigin}${routeConfig.canonicalPath}`;
}

function routeOutputPath(routePath) {
  if (routePath === "/") return indexPath;

  const fileName = routePath.replace(/^\/+/, "").replace(/\/+$/, "").replaceAll("/", path.sep);
  return path.join(distDir, `${fileName}.html`);
}

// El preload del hero vive en index.html, que es de donde estas rutas clonan
// el <head>. Pero hero.webp (226KB) solo lo usa Home.tsx: en /tienda,
// /catalogo o /terminos se descarga entero para nunca mostrarse, y el
// navegador lo avisa por consola ("preloaded but not used"). Se saca de todas
// las rutas menos "/", que es la unica donde el hero es el LCP.
const HERO_PRELOAD_PATTERN =
  /[ \t]*(?:<!--[^>]*?-->\s*\n)?[ \t]*<link\s+rel="preload"[^>]*href="\/hero\.webp"[^>]*>[ \t]*\n?/i;

function stripHeroPreload(html) {
  return html.replace(HERO_PRELOAD_PATTERN, "");
}

function renderRouteHtml(routePath, routeConfig) {
  const url = canonicalUrl(routeConfig);
  let html = routePath === "/" ? baseHtml : stripHeroPreload(baseHtml);

  html = setTitle(html, routeConfig.title);
  html = setMetaName(html, "description", routeConfig.description);
  html = setMetaName(html, "robots", seoConfig.publicRobots);
  html = setCanonical(html, url);
  html = setMetaProperty(html, "og:url", url);
  html = setMetaProperty(html, "og:title", routeConfig.title);
  html = setMetaProperty(html, "og:description", routeConfig.description);
  html = setMetaName(html, "twitter:title", routeConfig.title);
  html = setMetaName(html, "twitter:description", routeConfig.description);

  return html;
}

function renderSitemap() {
  const urls = Object.entries(publicRoutes)
    .map(([routePath, routeConfig]) => {
      const loc = canonicalUrl(routeConfig);
      const changefreq = routeConfig.changefreq ? `\n    <changefreq>${escapeHtml(routeConfig.changefreq)}</changefreq>` : "";
      const priority = routeConfig.priority ? `\n    <priority>${escapeHtml(routeConfig.priority)}</priority>` : "";

      return `  <url>\n    <loc>${escapeHtml(loc)}</loc>${changefreq}${priority}\n  </url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function renderRobots() {
  return `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${seoConfig.siteOrigin}/sitemap.xml\n`;
}

for (const [routePath, routeConfig] of Object.entries(publicRoutes)) {
  const outputPath = routeOutputPath(routePath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, renderRouteHtml(routePath, routeConfig), "utf8");
}

// Shell para las rutas que NO son publicas (/login, /carrito, /mis-pedidos,
// /admin...). Las sirve el rewrite comodin de vercel.json, que antes apuntaba
// a index.html y por eso arrastraba el preload del hero a paginas que nunca lo
// muestran. Ademas lleva el noindex que SeoRouteMeta ya aplica del lado del
// cliente para esas rutas: aca queda en el HTML, antes de que corra el JS.
// Si renombras este archivo, actualiza el rewrite "/(.*)"  de vercel.json o
// toda la navegacion profunda del sitio devuelve 404.
const appShellHtml = setMetaName(stripHeroPreload(baseHtml), "robots", seoConfig.defaultRobots);
await writeFile(path.join(distDir, "app.html"), appShellHtml, "utf8");

await writeFile(path.join(distDir, "sitemap.xml"), renderSitemap(), "utf8");
await writeFile(path.join(distDir, "robots.txt"), renderRobots(), "utf8");

console.log(`Generated SEO HTML for ${Object.keys(publicRoutes).length} public routes.`);
