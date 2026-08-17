"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const db_1 = require("../db");
const paths_1 = require("../paths");
const imageVariants_1 = require("../services/imageVariants");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const purge = args.includes("--purge");
/** Columnas que guardan una URL de upload como valor completo. */
const URL_COLUMNS = [
    { table: "productos", column: "imagen_url", idColumn: "id" },
    { table: "productos", column: "imagen_mobile_url", idColumn: "id" },
    { table: "producto_imagenes", column: "imagen_url", idColumn: "id" },
    { table: "categorias", column: "imagen_url", idColumn: "id" },
    { table: "layout_timeline_eventos", column: "imagen_url", idColumn: "id" },
];
/** Columnas de texto largo donde la URL aparece embebida (markdown). */
const TEXT_COLUMNS = [
    { table: "paginas_contenido", column: "contenido", idColumn: "slug" },
];
async function tableExists(table) {
    const rows = await (0, db_1.qAll)(db_1.pool, `SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`, [table]);
    return rows.length > 0;
}
async function columnExists(table, column) {
    const rows = await (0, db_1.qAll)(db_1.pool, `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`, [table, column]);
    return rows.length > 0;
}
/** Actualiza las referencias exactas (…/archivo.png -> …/archivo.webp). */
async function updateUrlColumns(renames) {
    let updated = 0;
    for (const { table, column, idColumn } of URL_COLUMNS) {
        if (!(await tableExists(table)) || !(await columnExists(table, column))) {
            console.log(`[skip] ${table}.${column} no existe en esta base`);
            continue;
        }
        for (const { from, to } of renames) {
            // LIKE con el nombre de archivo: cubre '/uploads/x.png' y '/api/uploads/x.png'.
            const result = await (0, db_1.qRun)(db_1.pool, `UPDATE ${table} SET ${column} = REPLACE(${column}, ?, ?) WHERE ${column} LIKE ?`, [from, to, `%${from}%`]);
            if (result.affectedRows > 0) {
                updated += result.affectedRows;
                console.log(`  ${table}.${column}: ${result.affectedRows} fila(s) -> ${to}`);
            }
            void idColumn;
        }
    }
    return updated;
}
/** Reemplaza la URL dentro de campos de texto largo (markdown de paginas). */
async function updateTextColumns(renames) {
    let updated = 0;
    for (const { table, column } of TEXT_COLUMNS) {
        if (!(await tableExists(table)) || !(await columnExists(table, column))) {
            console.log(`[skip] ${table}.${column} no existe en esta base`);
            continue;
        }
        for (const { from, to } of renames) {
            const result = await (0, db_1.qRun)(db_1.pool, `UPDATE ${table} SET ${column} = REPLACE(${column}, ?, ?) WHERE ${column} LIKE ?`, [from, to, `%${from}%`]);
            if (result.affectedRows > 0) {
                updated += result.affectedRows;
                console.log(`  ${table}.${column}: ${result.affectedRows} fila(s) -> ${to}`);
            }
        }
    }
    return updated;
}
async function main() {
    const entries = await fs_1.promises.readdir(paths_1.UPLOADS_DIR, { withFileTypes: true });
    const pending = entries
        .filter((e) => e.isFile() && !(0, imageVariants_1.isVariantFilename)(e.name))
        .filter((e) => /\.(png|jpe?g)$/i.test(e.name))
        .map((e) => e.name);
    const alreadyWebp = entries.filter((e) => e.isFile() && /\.webp$/i.test(e.name) && !(0, imageVariants_1.isVariantFilename)(e.name)).length;
    console.log(`${dryRun ? "[DRY RUN] " : ""}Uploads en ${paths_1.UPLOADS_DIR}`);
    console.log(`  ya en WebP (se saltean): ${alreadyWebp}`);
    console.log(`  a migrar: ${pending.length}\n`);
    if (pending.length === 0) {
        console.log("Nada para migrar. Todo ya esta en WebP.");
        await db_1.pool.end();
        return;
    }
    const renames = [];
    let bytesBefore = 0;
    let bytesAfter = 0;
    for (const filename of pending) {
        const before = (await fs_1.promises.stat(path_1.default.join(paths_1.UPLOADS_DIR, filename))).size;
        bytesBefore += before;
        const webpName = `${filename.slice(0, -path_1.default.extname(filename).length)}.webp`;
        if (dryRun) {
            console.log(`  ${filename} -> ${webpName} (${Math.round(before / 1024)}KB)`);
            renames.push({ from: filename, to: webpName });
            continue;
        }
        // 1) Escribir el .webp y sus variantes ANTES de tocar la base.
        await (0, imageVariants_1.reencodeExistingUploadToWebp)(paths_1.UPLOADS_DIR, filename);
        await (0, imageVariants_1.ensureVariantsFor)(paths_1.UPLOADS_DIR, webpName);
        const after = (await fs_1.promises.stat(path_1.default.join(paths_1.UPLOADS_DIR, webpName))).size;
        bytesAfter += after;
        const pct = Math.round((1 - after / before) * 100);
        // Se convierte igual aunque crezca: el objetivo es que uploads quede todo
        // en WebP, igual que las subidas nuevas. Pasa en imagenes muy chicas que
        // ya venian bien comprimidas; la diferencia es de algunos KB.
        const nota = after > before ? ` (OJO: crecio ${Math.round((after - before) / 1024)}KB, imagen ya optimizada)` : ` (${pct}% menos)`;
        console.log(`  ${filename} -> ${webpName}  ${Math.round(before / 1024)}KB -> ${Math.round(after / 1024)}KB${nota}`);
        renames.push({ from: filename, to: webpName });
    }
    if (dryRun) {
        console.log("\n[DRY RUN] No se escribio nada. Referencias que se actualizarian:");
        await updateUrlColumnsDryRun(renames);
        await db_1.pool.end();
        return;
    }
    // 2) Recien ahora, actualizar las referencias en la base.
    console.log("\nActualizando referencias en la base:");
    const urlUpdates = await updateUrlColumns(renames);
    const textUpdates = await updateTextColumns(renames);
    console.log(`  total: ${urlUpdates + textUpdates} referencia(s) actualizada(s)`);
    // 3) Opcional: borrar los originales, solo si se pidio explicitamente.
    if (purge) {
        console.log("\nBorrando originales (--purge):");
        for (const { from } of renames) {
            await fs_1.promises.unlink(path_1.default.join(paths_1.UPLOADS_DIR, from)).catch(() => { });
            console.log(`  borrado ${from}`);
        }
    }
    else {
        console.log("\nLos archivos originales quedaron en disco como red de seguridad.");
        console.log("Verifica la app y despues corre de nuevo con --purge para borrarlos.");
    }
    console.log(`\nTotal: ${Math.round(bytesBefore / 1024)}KB -> ${Math.round(bytesAfter / 1024)}KB` +
        (bytesBefore > 0 ? ` (${Math.round((1 - bytesAfter / bytesBefore) * 100)}% menos)` : ""));
    await db_1.pool.end();
}
/** En dry-run solo cuenta cuantas filas se tocarian, sin escribir. */
async function updateUrlColumnsDryRun(renames) {
    for (const { table, column } of [...URL_COLUMNS, ...TEXT_COLUMNS]) {
        if (!(await tableExists(table)) || !(await columnExists(table, column)))
            continue;
        for (const { from } of renames) {
            const rows = await (0, db_1.qAll)(db_1.pool, `SELECT COUNT(*) AS c FROM ${table} WHERE ${column} LIKE ?`, [`%${from}%`]);
            const count = Number(rows[0]?.c ?? 0);
            if (count > 0)
                console.log(`  ${table}.${column}: ${count} fila(s) contienen ${from}`);
        }
    }
}
main().catch(async (err) => {
    console.error(err);
    await db_1.pool.end().catch(() => { });
    process.exit(1);
});
