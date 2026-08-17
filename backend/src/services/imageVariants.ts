import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";

/**
 * Pipeline de imágenes subidas desde el panel de admin.
 *
 * Toda subida validada se reencodea a WebP:
 *   - canónico:  tope 1600px de ancho (la URL que se guarda en la base)
 *   - -card:     600px de ancho (grillas de producto)
 *   - -thumb:    300px de ancho (miniaturas)
 *
 * Nunca se recorta: el CSS del frontend ya encuadra con object-fit y el
 * encuadre cambia por breakpoint (16/9 desktop, 1/1 mobile). Acá solo se
 * redimensiona por ancho máximo conservando la proporción, sin agrandar
 * imágenes chicas. El canal alfa se preserva (WebP lo soporta).
 */

export const IMAGE_VARIANTS = [
  { suffix: "-card", width: 600 },
  { suffix: "-thumb", width: 300 },
] as const;

const CANONICAL_MAX_WIDTH = 1600;
const WEBP_QUALITY = 82;

const SOURCE_IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

function stripExt(filename: string): string {
  return filename.slice(0, -path.extname(filename).length);
}

/** Nombre de una variante a partir del nombre canónico: base.webp -> base-card.webp */
export function variantFilename(filename: string, suffix: string): string {
  return `${stripExt(filename)}${suffix}.webp`;
}

/** True si el archivo es una variante generada (-card/-thumb), no un original. */
export function isVariantFilename(filename: string): boolean {
  const base = stripExt(filename);
  return IMAGE_VARIANTS.some((v) => base.endsWith(v.suffix));
}

async function encodeTo(input: Buffer, width: number, outputPath: string): Promise<void> {
  await sharp(input)
    .rotate() // aplica la orientación EXIF antes de que se pierda la metadata
    .resize({ width, fit: "inside", withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toFile(outputPath);
}

/**
 * Reencodea una subida YA VALIDADA (magic bytes) a WebP canónico + variantes.
 * Devuelve el nombre del archivo canónico y borra el original si quedó aparte.
 * Si algo falla, limpia todo lo que haya generado y borra el original.
 */
export async function processUploadedImage(uploadsDir: string, originalFilename: string): Promise<string> {
  const originalPath = path.join(uploadsDir, originalFilename);
  const canonicalFilename = `${stripExt(originalFilename)}.webp`;
  const generated: string[] = [];

  try {
    // Se lee a memoria primero: si el original ya era .webp, el canónico
    // sobreescribe el mismo path y no hay conflicto de lectura/escritura.
    const input = await fs.readFile(originalPath);

    const canonicalPath = path.join(uploadsDir, canonicalFilename);
    await encodeTo(input, CANONICAL_MAX_WIDTH, canonicalPath);
    generated.push(canonicalPath);

    for (const variant of IMAGE_VARIANTS) {
      const variantPath = path.join(uploadsDir, variantFilename(canonicalFilename, variant.suffix));
      await encodeTo(input, variant.width, variantPath);
      generated.push(variantPath);
    }
  } catch (error) {
    for (const file of generated) {
      await fs.unlink(file).catch(() => {});
    }
    await fs.unlink(originalPath).catch(() => {});
    throw error;
  }

  if (originalFilename !== canonicalFilename) {
    await fs.unlink(originalPath).catch(() => {});
  }
  return canonicalFilename;
}

/**
 * Genera las variantes que falten para un archivo ya existente, sin tocar
 * el original (hay URLs en la base apuntando a él). Idempotente.
 */
export async function ensureVariantsFor(uploadsDir: string, filename: string): Promise<number> {
  const ext = path.extname(filename).toLowerCase();
  if (!SOURCE_IMAGE_EXTS.has(ext) || isVariantFilename(filename)) return 0;

  let created = 0;
  let input: Buffer | null = null;
  for (const variant of IMAGE_VARIANTS) {
    const variantPath = path.join(uploadsDir, variantFilename(filename, variant.suffix));
    try {
      await fs.access(variantPath);
      continue; // ya existe
    } catch {
      // falta: generarla
    }
    if (!input) input = await fs.readFile(path.join(uploadsDir, filename));
    await encodeTo(input, variant.width, variantPath);
    created += 1;
  }
  return created;
}
