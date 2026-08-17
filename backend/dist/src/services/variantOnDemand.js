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
// Solo nombres generados por el pipeline: uuid-timestamp[-card|-thumb].webp
const VARIANT_REQUEST = /^([A-Za-z0-9_-]+)-(card|thumb)\.webp$/;
const CANONICAL_EXTS = [".webp", ".png", ".jpg", ".jpeg"];
/** Evita que N pedidos simultaneos generen la misma variante N veces. */
const inFlight = new Map();
async function findCanonical(uploadsDir, base) {
    for (const ext of CANONICAL_EXTS) {
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
        const match = VARIANT_REQUEST.exec(filename);
        if (!match)
            return next();
        const [, base] = match;
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
                const canonical = await findCanonical(uploadsDir, base);
                if (!canonical)
                    return; // no hay original: que siga y devuelva 404
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
