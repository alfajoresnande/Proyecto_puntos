"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listPendingUploads = listPendingUploads;
exports.countWebpUploads = countWebpUploads;
exports.countReferences = countReferences;
exports.rewriteReferences = rewriteReferences;
exports.migrateUploadsToWebp = migrateUploadsToWebp;
exports.purgeOriginals = purgeOriginals;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const db_1 = require("../db");
const paths_1 = require("../paths");
const imageVariants_1 = require("./imageVariants");
/**
 * Migración de las imágenes subidas ANTES del pipeline de WebP.
 *
 * Las subidas nuevas ya salen en WebP desde processUploadedImage(). Este
 * módulo se ocupa de las viejas: las reencodea y reescribe todas las
 * referencias guardadas en la base.
 *
 * Lo usan dos entradas:
 *   - scripts/migrateUploadsToWebp.ts  (manual, con --dry-run y --purge)
 *   - services/startupBackfills.ts     (automático al arrancar el servidor)
 *
 * Orden a prueba de fallos: primero se escribe el .webp, después se
 * actualiza la base. El original NO se borra salvo que se pida explícito,
 * así una referencia que se haya escapado degrada al archivo viejo en vez
 * de quedar rota. Todo es idempotente: correrlo de nuevo no hace nada.
 */
/** Columnas que guardan una URL de upload como valor completo. */
const URL_COLUMNS = [
    { table: "productos", column: "imagen_url" },
    { table: "productos", column: "imagen_mobile_url" },
    { table: "producto_imagenes", column: "imagen_url" },
    { table: "categorias", column: "imagen_url" },
    { table: "layout_timeline_eventos", column: "imagen_url" },
];
/** Columnas de texto largo donde la URL aparece embebida (markdown de páginas). */
const TEXT_COLUMNS = [
    { table: "paginas_contenido", column: "contenido" },
];
const ALL_COLUMNS = [...URL_COLUMNS, ...TEXT_COLUMNS];
async function tableExists(conn, table) {
    const rows = await (0, db_1.qAll)(conn, `SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`, [table]);
    return rows.length > 0;
}
async function columnExists(conn, table, column) {
    const rows = await (0, db_1.qAll)(conn, `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`, [table, column]);
    return rows.length > 0;
}
/** Nombres de archivo (sin variantes) que todavía no están en WebP. */
async function listPendingUploads(uploadsDir = paths_1.UPLOADS_DIR) {
    const entries = await fs_1.promises.readdir(uploadsDir, { withFileTypes: true });
    return entries
        .filter((e) => e.isFile() && !(0, imageVariants_1.isVariantFilename)(e.name) && /\.(png|jpe?g)$/i.test(e.name))
        .map((e) => e.name);
}
async function countWebpUploads(uploadsDir = paths_1.UPLOADS_DIR) {
    const entries = await fs_1.promises.readdir(uploadsDir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && /\.webp$/i.test(e.name) && !(0, imageVariants_1.isVariantFilename)(e.name)).length;
}
/** Cuenta las filas que contienen cada archivo, sin escribir nada. */
async function countReferences(conn, filenames) {
    const found = [];
    for (const { table, column } of ALL_COLUMNS) {
        if (!(await tableExists(conn, table)) || !(await columnExists(conn, table, column)))
            continue;
        for (const filename of filenames) {
            const rows = await (0, db_1.qAll)(conn, `SELECT COUNT(*) AS c FROM \`${table}\` WHERE \`${column}\` LIKE ?`, [`%${filename}%`]);
            const count = Number(rows[0]?.c ?? 0);
            if (count > 0)
                found.push({ table, column, filename, rows: count });
        }
    }
    return found;
}
/**
 * Reescribe las referencias .png/.jpg -> .webp en todas las columnas.
 * Usa REPLACE sobre el nombre de archivo, así cubre tanto '/uploads/x.png'
 * como '/api/uploads/x.png' y las URLs embebidas en markdown.
 */
async function rewriteReferences(conn, renames, onUpdate) {
    let updated = 0;
    for (const { table, column } of ALL_COLUMNS) {
        if (!(await tableExists(conn, table)) || !(await columnExists(conn, table, column)))
            continue;
        for (const { from, to } of renames) {
            const result = await (0, db_1.qRun)(conn, `UPDATE \`${table}\` SET \`${column}\` = REPLACE(\`${column}\`, ?, ?) WHERE \`${column}\` LIKE ?`, [from, to, `%${from}%`]);
            if (result.affectedRows > 0) {
                updated += result.affectedRows;
                onUpdate?.(table, column, to, result.affectedRows);
            }
        }
    }
    return updated;
}
/**
 * Ejecuta la migración completa: convierte los archivos y reescribe las
 * referencias. No borra los originales (ver purgeOriginals).
 */
async function migrateUploadsToWebp(conn, options = {}) {
    const uploadsDir = options.uploadsDir ?? paths_1.UPLOADS_DIR;
    const pending = await listPendingUploads(uploadsDir);
    const alreadyWebp = await countWebpUploads(uploadsDir);
    if (pending.length === 0) {
        return { converted: [], renames: [], alreadyWebp, referencesUpdated: 0 };
    }
    // 1) Archivos primero: si algo falla acá, la base queda intacta.
    const renames = [];
    for (const filename of pending) {
        const bytesBefore = (await fs_1.promises.stat(path_1.default.join(uploadsDir, filename))).size;
        const { webpName, created } = await (0, imageVariants_1.reencodeExistingUploadToWebp)(uploadsDir, filename);
        await (0, imageVariants_1.ensureVariantsFor)(uploadsDir, webpName);
        const bytesAfter = (await fs_1.promises.stat(path_1.default.join(uploadsDir, webpName))).size;
        const rename = { from: filename, to: webpName, bytesBefore, bytesAfter, created };
        renames.push(rename);
        // Solo se reporta lo que realmente se convirtió en esta corrida.
        if (created)
            options.onFile?.(rename);
    }
    // 2) Recién ahora, las referencias. Se reescriben para TODOS los renames,
    //    no solo los recién creados: una corrida anterior pudo haber escrito el
    //    archivo y morir antes de actualizar la base. Si ya están migradas, el
    //    UPDATE no matchea nada y no hace daño.
    const referencesUpdated = await rewriteReferences(conn, renames, options.onReference);
    return { converted: renames.filter((r) => r.created), renames, alreadyWebp, referencesUpdated };
}
/** Borra los archivos originales ya migrados. Se llama aparte, a propósito. */
async function purgeOriginals(renames, uploadsDir = paths_1.UPLOADS_DIR) {
    let removed = 0;
    for (const { from } of renames) {
        try {
            await fs_1.promises.unlink(path_1.default.join(uploadsDir, from));
            removed += 1;
        }
        catch {
            // ya no estaba
        }
    }
    return removed;
}
