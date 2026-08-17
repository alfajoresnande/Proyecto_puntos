import { promises as fs } from "fs";
import path from "path";
import type { NextFunction, Request, Response } from "express";
import { ensureVariantsFor, reencodeExistingUploadToWebp, IMAGE_VARIANTS } from "./imageVariants";

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

/** Pedido de un original que puede haber sido reemplazado por su .webp. */
const ORIGINAL_REQUEST = /^([A-Za-z0-9_-]+?)\.(png|jpe?g)$/i;

/**
 * El hosting es Linux: `foo.JPG` y `foo.jpg` son archivos distintos. Se
 * prueban ambas grafias porque no hay garantia de como quedaron nombrados
 * los archivos historicos.
 */
function withCaseVariants(exts: string[]): string[] {
  return exts.flatMap((ext) => [ext, ext.toUpperCase()]);
}

const CANONICAL_EXTS = withCaseVariants([".webp", ".png", ".jpg", ".jpeg"]);
const ORIGINAL_EXTS = withCaseVariants([".png", ".jpg", ".jpeg"]);

/** Evita que N pedidos simultaneos generen la misma variante N veces. */
const inFlight = new Map<string, Promise<void>>();

async function findExisting(uploadsDir: string, base: string, exts: string[]): Promise<string | null> {
  for (const ext of exts) {
    const candidate = path.join(uploadsDir, `${base}${ext}`);
    try {
      await fs.access(candidate);
      return `${base}${ext}`;
    } catch {
      // seguir probando
    }
  }
  return null;
}

export function createVariantOnDemandMiddleware(uploadsDir: string) {
  return async function variantOnDemand(req: Request, res: Response, next: NextFunction) {
    if (req.method !== "GET" && req.method !== "HEAD") return next();

    // req.path viene decodificado y normalizado por express; igual se valida
    // contra la regex, asi que no puede haber traversal ni subcarpetas.
    const filename = path.posix.basename(req.path);

    // Caso inverso: la base referencia un .png/.jpg que ya no esta porque en
    // disco quedo solo el .webp (backup posterior a una conversion). Se sirve
    // el .webp con su Content-Type real: mandarlo como image/png lo bloquearia
    // el nosniff que ponemos en las cabeceras.
    const originalMatch = ORIGINAL_REQUEST.exec(filename);
    if (originalMatch) {
      const originalPath = path.join(uploadsDir, filename);
      try {
        await fs.access(originalPath);
        return next(); // el original existe, lo sirve el static
      } catch {
        const webpName = `${originalMatch[1]}.webp`;
        try {
          await fs.access(path.join(uploadsDir, webpName));
          console.log(`[uploads] ${filename} no existe, se sirve ${webpName}`);
          res.type("image/webp");
          req.url = `/${webpName}`; // que el static resuelva el .webp
        } catch {
          // tampoco hay webp: que siga y devuelva 404
        }
      }
      return next();
    }

    const match = WEBP_REQUEST.exec(filename);
    if (!match) return next();

    const [, base, suffix] = match;
    const target = path.join(uploadsDir, filename);

    try {
      await fs.access(target);
      return next(); // ya existe: lo sirve express.static
    } catch {
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
          if (!original) return; // no hay nada de donde sacarlo: 404
          await reencodeExistingUploadToWebp(uploadsDir, original);
          console.log(`[uploads] canonico regenerado al vuelo desde ${original}`);
          return;
        }

        // Falta una variante -card/-thumb: se deriva del canonico que haya.
        const canonical = await findExisting(uploadsDir, base, CANONICAL_EXTS);
        if (!canonical) return;
        await ensureVariantsFor(uploadsDir, canonical);
        console.log(`[uploads] variante generada al vuelo: ${filename}`);
      })().finally(() => inFlight.delete(key));
      inFlight.set(key, job);
    }

    try {
      await job;
    } catch (error) {
      // sharp caido o imagen corrupta: no romper el pedido, seguir al static
      // (que devolvera 404 y el frontend caera al canonico via onError).
      console.error(
        `[uploads] no se pudo generar ${filename}:`,
        error instanceof Error ? error.message : error,
      );
    }
    return next();
  };
}

export const VARIANT_SUFFIXES = IMAGE_VARIANTS.map((v) => v.suffix);
