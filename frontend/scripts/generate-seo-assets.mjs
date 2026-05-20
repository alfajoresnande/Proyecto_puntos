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

function renderRouteHtml(routeConfig) {
  const url = canonicalUrl(routeConfig);
  let html = baseHtml;

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
  await writeFile(outputPath, renderRouteHtml(routeConfig), "utf8");
}

await writeFile(path.join(distDir, "sitemap.xml"), renderSitemap(), "utf8");
await writeFile(path.join(distDir, "robots.txt"), renderRobots(), "utf8");

console.log(`Generated SEO HTML for ${Object.keys(publicRoutes).length} public routes.`);
