"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VARIANT_SUFFIXES = void 0;
exports.createVariantOnDemandMiddleware = createVariantOnDemandMiddleware;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const imageVariants_1 = require("./imageVariants");
/**
 * Genera al vuelo la variante -card/-thumb que falte, la guarda en disco y
 * deja que express.static la sirva.
 *
 * Por que hace falta, y no alcanza con generarlas al arrancar: en el hosting
 * la carpeta uploads se copia a mano DESPUES del deploy, asi que cuando el
 * servidor arranca todavia no estan las imagenes reales. Cualquier proceso
 * que dependa del momento del arranque se pierde esos archivos.
 *
 * Se genera UNA sola vez: a partir del segundo pedido el archivo ya existe y
 * lo sirve el static normal, sin pasar por sharp.
 */
// Cualquier .webp del pipeline: el canonico y sus variantes.
// Se cubren los dos casos porque la base puede apuntar a un .webp que todavia
// no existe en disco (por ejemplo si la carpeta uploads se restauro desde un
// backup anterior a la conversion). En ese caso se regenera desde el original.
const WEBP_REQUEST = /^([A-Za-z0-9_-]+?)(-card|-thumb)?\.webp$/;
const CANONICAL_EXTS = [".webp", ".png", ".jpg", ".jpeg"];
const ORIGINAL_EXTS = [".png", ".jpg", ".jpeg"];
/** Evita que N pedidos simultaneos generen la misma variante N veces. */
const inFlight = new Map();
async function findExisting(uploadsDir, base, exts) {
    for (const ext of exts) {
        const candidate = path_1.default.join(uploadsDir, `${base}${ext}`);
        try {
            await fs_1.promises.access(candidate);
            return `${base}${ext}`;
        }
        catch {
            // seguir probando
        }
    }
    return null;
}
function createVariantOnDemandMiddleware(uploadsDir) {
    return async function variantOnDemand(req, res, next) {
        if (req.method !== "GET" && req.method !== "HEAD")
            return next();
        // req.path viene decodificado y normalizado por express; igual se valida
        // contra la regex, asi que no puede haber traversal ni subcarpetas.
        const filename = path_1.default.posix.basename(req.path);
        const match = WEBP_REQUEST.exec(filename);
        if (!match)
            return next();
        const [, base, suffix] = match;
        const target = path_1.default.join(uploadsDir, filename);
        try {
            await fs_1.promises.access(target);
            return next(); // ya existe: lo sirve express.static
        }
        catch {
            // falta: intentar generarla
        }
        const key = target;
        let job = inFlight.get(key);
        if (!job) {
            job = (async () => {
                if (!suffix) {
                    // Falta el CANONICO .webp. Pasa cuando la base ya fue migrada a
                    // .webp pero en disco quedo el original (carpeta restaurada desde
                    // un backup previo a la conversion). Se reencodea desde el original.
                    const original = await findExisting(uploadsDir, base, ORIGINAL_EXTS);
                    if (!original)
                        return; // no hay nada de donde sacarlo: 404
                    await (0, imageVariants_1.reencodeExistingUploadToWebp)(uploadsDir, original);
                    console.log(`[uploads] canonico regenerado al vuelo desde ${original}`);
                    return;
                }
                // Falta una variante -card/-thumb: se deriva del canonico que haya.
                const canonical = await findExisting(uploadsDir, base, CANONICAL_EXTS);
                if (!canonical)
                    return;
                await (0, imageVariants_1.ensureVariantsFor)(uploadsDir, canonical);
                console.log(`[uploads] variante generada al vuelo: ${filename}`);
            })().finally(() => inFlight.delete(key));
            inFlight.set(key, job);
        }
        try {
            await job;
        }
        catch (error) {
            // sharp caido o imagen corrupta: no romper el pedido, seguir al static
            // (que devolvera 404 y el frontend caera al canonico via onError).
            console.error(`[uploads] no se pudo generar ${filename}:`, error instanceof Error ? error.message : error);
        }
        return next();
    };
}
exports.VARIANT_SUFFIXES = imageVariants_1.IMAGE_VARIANTS.map((v) => v.suffix);
