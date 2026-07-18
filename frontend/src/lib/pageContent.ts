import DOMPurify from "dompurify";
import { marked } from "marked";

export const MAX_STATIC_PAGE_IMAGES = 4;
const SAFE_IMAGE_PROTOCOLS = new Set(["http:", "https:"]);
const TOC_HEADING_SLUGS = new Set(["indice", "indice-del-documento"]);
const MARKDOWN_HEADING_LINE_REGEX = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;

export type StaticPageHeading = {
  id: string;
  text: string;
  depth: number;
};

function slugifyHeading(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " y ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function buildUniqueHeadingId(text: string, usedIds: Map<string, number>): string {
  const baseId = slugifyHeading(text) || "seccion";
  const currentCount = usedIds.get(baseId) ?? 0;
  usedIds.set(baseId, currentCount + 1);
  return currentCount === 0 ? baseId : `${baseId}-${currentCount + 1}`;
}

function renderMarkdownDocument(content: string): { html: string; headings: StaticPageHeading[] } {
  const rawHtml = marked.parse(content, { async: false }) as string;
  let htmlWithHeadingIds = rawHtml;
  const headings: StaticPageHeading[] = [];

  if (typeof DOMParser !== "undefined") {
    const documentWithAnchors = new DOMParser().parseFromString(rawHtml, "text/html");
    const usedHeadingIds = new Map<string, number>();

    documentWithAnchors.querySelectorAll<HTMLHeadingElement>("h1, h2, h3, h4, h5, h6").forEach((heading) => {
      const text = heading.textContent?.trim() || "";
      if (!text) return;

      let id = heading.id.trim();
      if (!id) {
        id = buildUniqueHeadingId(text, usedHeadingIds);
        heading.id = id;
      } else {
        usedHeadingIds.set(id, (usedHeadingIds.get(id) ?? 0) + 1);
      }

      headings.push({
        id,
        text,
        depth: Number(heading.tagName.slice(1)),
      });
    });

    htmlWithHeadingIds = documentWithAnchors.body.innerHTML;
  }

  return {
    html: DOMPurify.sanitize(htmlWithHeadingIds, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["style", "script", "iframe", "object", "embed", "form"],
      FORBID_ATTR: ["style"],
    }),
    headings,
  };
}

function stripMarkdownTableOfContents(content: string): string {
  const lines = content.replace(/\r/g, "").trimEnd().split("\n");
  const result: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const headingMatch = lines[index]?.match(MARKDOWN_HEADING_LINE_REGEX);
    if (!headingMatch) {
      result.push(lines[index] || "");
      index += 1;
      continue;
    }

    const headingDepth = headingMatch[1]?.length ?? 0;
    const headingText = headingMatch[2]?.trim() || "";

    if (!TOC_HEADING_SLUGS.has(slugifyHeading(headingText))) {
      result.push(lines[index] || "");
      index += 1;
      continue;
    }

    index += 1;
    while (index < lines.length) {
      const nextHeadingMatch = lines[index]?.match(MARKDOWN_HEADING_LINE_REGEX);
      if (nextHeadingMatch && (nextHeadingMatch[1]?.length ?? 0) <= headingDepth) {
        break;
      }

      index += 1;
    }
  }

  return result.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function normalizeSafeImageUrl(input: string): string | null {
  const value = input.trim();
  if (!value) return null;

  if (value.startsWith("/")) {
    if (value.startsWith("//")) return null;
    return value;
  }

  if (value.startsWith("uploads/")) return `/${value}`;
  if (value.startsWith("api/uploads/")) return `/${value}`;

  try {
    const parsed = new URL(value);
    if (!SAFE_IMAGE_PROTOCOLS.has(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

// Parsea markdown y sanitiza el HTML resultante antes de renderizarlo.
// Uso obligatorio donde se haga dangerouslySetInnerHTML con contenido
// editable por admins: si el admin es comprometido, sin esto = XSS.
export function renderSafeMarkdown(content: string): string {
  return renderMarkdownDocument(content).html;
}

const MARKDOWN_IMAGE_LINE_REGEX = /^!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)$/;

export function extractPageImageUrls(content: string): string[] {
  const lines = content.replace(/\r/g, "").trimEnd().split("\n");
  const urls: string[] = [];

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line) continue;

    const match = line.match(MARKDOWN_IMAGE_LINE_REGEX);
    if (!match) break;
    urls.unshift(match[1]?.trim() || "");
  }

  return urls
    .map((url) => normalizeSafeImageUrl(url))
    .filter((url): url is string => Boolean(url));
}

export function stripPageImages(content: string): string {
  const lines = content.replace(/\r/g, "").trimEnd().split("\n");
  let startRemoveAt = lines.length;
  let foundGallery = false;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line) {
      if (foundGallery) startRemoveAt = index;
      continue;
    }

    if (MARKDOWN_IMAGE_LINE_REGEX.test(line)) {
      foundGallery = true;
      startRemoveAt = index;
      continue;
    }

    break;
  }

  if (!foundGallery) return content.trim();

  return lines
    .slice(0, startRemoveAt)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function prepareStaticPageBody(content: string): string {
  return stripMarkdownTableOfContents(stripPageImages(content));
}

export function renderStaticPageMarkdown(content: string): { html: string; headings: StaticPageHeading[] } {
  const preparedContent = prepareStaticPageBody(content);
  const rendered = renderMarkdownDocument(preparedContent);

  return {
    html: rendered.html,
    headings: rendered.headings.filter((heading) => heading.depth >= 2),
  };
}

export function rebuildPageContent(body: string, imageUrls: string[]): string {
  const cleanBody = body.trim();
  const uniqueImages = Array.from(
    new Set(
      imageUrls
        .map((url) => normalizeSafeImageUrl(url))
        .filter((url): url is string => Boolean(url))
    )
  ).slice(0, MAX_STATIC_PAGE_IMAGES);
  const imageBlock = uniqueImages.map((url) => `![imagen](${url})`).join("\n\n");

  if (cleanBody && imageBlock) return `${cleanBody}\n\n${imageBlock}\n`;
  if (cleanBody) return `${cleanBody}\n`;
  if (imageBlock) return `${imageBlock}\n`;
  return "";
}
