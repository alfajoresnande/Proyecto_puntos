export const MAX_STATIC_PAGE_IMAGES = 4;

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

  return urls.filter(Boolean);
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
  const uniqueImages = Array.from(new Set(imageUrls.map((url) => url.trim()).filter(Boolean))).slice(0, MAX_STATIC_PAGE_IMAGES);
  const imageBlock = uniqueImages.map((url) => `![imagen](${url})`).join("\n\n");

  if (cleanBody && imageBlock) return `${cleanBody}\n\n${imageBlock}\n`;
  if (cleanBody) return `${cleanBody}\n`;
  if (imageBlock) return `${imageBlock}\n`;
  return "";
}
