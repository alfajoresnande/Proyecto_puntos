"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IMAGE_VARIANTS = exports.ImageProcessingUnavailableError = void 0;
exports.checkImageProcessingAvailable = checkImageProcessingAvailable;
exports.variantFilename = variantFilename;
exports.isVariantFilename = isVariantFilename;
exports.processUploadedImage = processUploadedImage;
exports.reencodeExistingUploadToWebp = reencodeExistingUploadToWebp;
exports.ensureVariantsFor = ensureVariantsFor;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
let sharpModule = null;
let sharpLoadError = null;
class ImageProcessingUnavailableError extends Error {
    constructor(cause) {
        super(`El procesamiento de imagenes no esta disponible en este servidor: ${cause}`);
        this.name = "ImageProcessingUnavailableError";
    }
}
exports.ImageProcessingUnavailableError = ImageProcessingUnavailableError;
function getSharp() {
    if (sharpModule)
        return sharpModule;
    if (sharpLoadError !== null)
        throw new ImageProcessingUnavailableError(sharpLoadError);
    try {
        // require diferido a proposito: ver el comentario de arriba.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const loaded = require("sharp");
        // Segun como se resuelva el paquete, el callable puede venir en .default.
        sharpModule = (loaded?.default ?? loaded);
        return sharpModule;
    }
    catch (error) {
        sharpLoadError = error instanceof Error ? error.message : String(error);
        throw new ImageProcessingUnavailableError(sharpLoadError);
    }
}
/**
 * Chequeo no destructivo para logear al arrancar. Nunca tira: devuelve el
 * motivo del fallo para que quede visible en los logs del servidor.
 */
function checkImageProcessingAvailable() {
    try {
        getSharp();
        return { ok: true };
    }
    catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
}
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
    const sharp = getSharp();
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
 * Reencodea a WebP un upload preexistente (anterior al pipeline) SIN borrar
 * el original: lo usa migrateUploadsToWebp, que primero escribe el .webp y
 * recién después actualiza las referencias en la base. Dejar el archivo
 * viejo evita que una referencia no migrada quede rota.
 *
 * Idempotente: si el .webp ya existe, no lo regenera.
 * Devuelve el nombre del archivo WebP.
 */
async function reencodeExistingUploadToWebp(uploadsDir, filename) {
    const webpName = `${stripExt(filename)}.webp`;
    const webpPath = path_1.default.join(uploadsDir, webpName);
    try {
        await fs_1.promises.access(webpPath);
        return webpName; // ya existe
    }
    catch {
        // falta: generarlo
    }
    const input = await fs_1.promises.readFile(path_1.default.join(uploadsDir, filename));
    try {
        await encodeTo(input, CANONICAL_MAX_WIDTH, webpPath);
    }
    catch (error) {
        await fs_1.promises.unlink(webpPath).catch(() => { });
        throw error;
    }
    return webpName;
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
