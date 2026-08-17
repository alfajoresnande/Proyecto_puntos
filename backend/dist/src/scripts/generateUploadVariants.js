"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const paths_1 = require("../paths");
const imageVariants_1 = require("../services/imageVariants");
/**
 * Backfill: genera las variantes -card y -thumb para las imágenes que ya
 * estaban en backend/uploads antes del pipeline de subida.
 *
 * - Idempotente: si la variante ya existe, no la regenera.
 * - NO borra ni renombra los originales: hay URLs guardadas en la base
 *   (productos, categorías, páginas) apuntando a ellos.
 *
 * Uso: npx tsx src/scripts/generateUploadVariants.ts
 */
async function main() {
    const entries = await fs_1.promises.readdir(paths_1.UPLOADS_DIR, { withFileTypes: true });
    let created = 0;
    let skipped = 0;
    let failed = 0;
    for (const entry of entries) {
        if (!entry.isFile() || (0, imageVariants_1.isVariantFilename)(entry.name))
            continue;
        try {
            const generated = await (0, imageVariants_1.ensureVariantsFor)(paths_1.UPLOADS_DIR, entry.name);
            if (generated > 0) {
                created += generated;
                console.log(`[variants] ${entry.name}: ${generated} variante(s) generada(s)`);
            }
            else {
                skipped += 1;
            }
        }
        catch (error) {
            failed += 1;
            console.error(`[variants] ERROR con ${entry.name}:`, error instanceof Error ? error.message : error);
        }
    }
    console.log(`[variants] Listo. Variantes creadas: ${created}. Sin cambios: ${skipped}. Errores: ${failed}.`);
    if (failed > 0)
        process.exitCode = 1;
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
