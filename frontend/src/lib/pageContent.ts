import DOMPurify from "dompurify";
import { marked } from "marked";

export const MAX_STATIC_PAGE_IMAGES = 4;
const SAFE_IMAGE_PROTOCOLS = new Set(["http:", "https:"]);

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
  const rawHtml = marked.parse(content, { async: false }) as string;
  return DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "script", "iframe", "object", "embed", "form"],
    FORBID_ATTR: ["style"],
  });
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
