"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IMAGE_VARIANTS = void 0;
exports.variantFilename = variantFilename;
exports.isVariantFilename = isVariantFilename;
exports.processUploadedImage = processUploadedImage;
exports.ensureVariantsFor = ensureVariantsFor;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const sharp_1 = __importDefault(require("sharp"));
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
exports.IMAGE_VARIANTS = [
    { suffix: "-card", width: 600 },
    { suffix: "-thumb", width: 300 },
];
const CANONICAL_MAX_WIDTH = 1600;
const WEBP_QUALITY = 82;
const SOURCE_IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
function stripExt(filename) {
    return filename.slice(0, -path_1.default.extname(filename).length);
}
/** Nombre de una variante a partir del nombre canónico: base.webp -> base-card.webp */
function variantFilename(filename, suffix) {
    return `${stripExt(filename)}${suffix}.webp`;
}
/** True si el archivo es una variante generada (-card/-thumb), no un original. */
function isVariantFilename(filename) {
    const base = stripExt(filename);
    return exports.IMAGE_VARIANTS.some((v) => base.endsWith(v.suffix));
}
async function encodeTo(input, width, outputPath) {
    await (0, sharp_1.default)(input)
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
async function processUploadedImage(uploadsDir, originalFilename) {
    const originalPath = path_1.default.join(uploadsDir, originalFilename);
    const canonicalFilename = `${stripExt(originalFilename)}.webp`;
    const generated = [];
    try {
        // Se lee a memoria primero: si el original ya era .webp, el canónico
        // sobreescribe el mismo path y no hay conflicto de lectura/escritura.
        const input = await fs_1.promises.readFile(originalPath);
        const canonicalPath = path_1.default.join(uploadsDir, canonicalFilename);
        await encodeTo(input, CANONICAL_MAX_WIDTH, canonicalPath);
        generated.push(canonicalPath);
        for (const variant of exports.IMAGE_VARIANTS) {
            const variantPath = path_1.default.join(uploadsDir, variantFilename(canonicalFilename, variant.suffix));
            await encodeTo(input, variant.width, variantPath);
            generated.push(variantPath);
        }
    }
    catch (error) {
        for (const file of generated) {
            await fs_1.promises.unlink(file).catch(() => { });
        }
        await fs_1.promises.unlink(originalPath).catch(() => { });
        throw error;
    }
    if (originalFilename !== canonicalFilename) {
        await fs_1.promises.unlink(originalPath).catch(() => { });
    }
    return canonicalFilename;
}
/**
 * Genera las variantes que falten para un archivo ya existente, sin tocar
 * el original (hay URLs en la base apuntando a él). Idempotente.
 */
async function ensureVariantsFor(uploadsDir, filename) {
    const ext = path_1.default.extname(filename).toLowerCase();
    if (!SOURCE_IMAGE_EXTS.has(ext) || isVariantFilename(filename))
        return 0;
    let created = 0;
    let input = null;
    for (const variant of exports.IMAGE_VARIANTS) {
        const variantPath = path_1.default.join(uploadsDir, variantFilename(filename, variant.suffix));
        try {
            await fs_1.promises.access(variantPath);
            continue; // ya existe
        }
        catch {
            // falta: generarla
        }
        if (!input)
            input = await fs_1.promises.readFile(path_1.default.join(uploadsDir, filename));
        await encodeTo(input, variant.width, variantPath);
        created += 1;
    }
    return created;
}
