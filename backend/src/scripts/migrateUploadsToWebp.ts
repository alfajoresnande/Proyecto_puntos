import { promises as fs } from "fs";
import path from "path";
import { pool, qAll, qRun } from "../db";
import { UPLOADS_DIR } from "../paths";
import { ensureVariantsFor, isVariantFilename, reencodeExistingUploadToWebp } from "../services/imageVariants";

/**
 * Migra las imagenes YA SUBIDAS (anteriores al pipeline) a WebP y actualiza
 * todas las referencias en la base.
 *
 * Uso:
 *   npx tsx src/scripts/migrateUploadsToWebp.ts --dry-run   (no escribe nada)
 *   npx tsx src/scripts/migrateUploadsToWebp.ts             (aplica)
 *   npx tsx src/scripts/migrateUploadsToWebp.ts --purge     (aplica y borra los originales)
 *
 * Seguridad:
 *  - Idempotente: lo que ya es .webp se saltea.
 *  - Por defecto NO borra el archivo viejo. Si quedara alguna referencia sin
 *    migrar, la imagen sigue funcionando en vez de romperse. Una vez que
 *    verificaste la app, volves a correr con --purge para liberar el espacio.
 *  - Primero escribe el .webp, DESPUES actualiza la base. Si algo falla en el
 *    medio, quedan los dos archivos y las referencias viejas siguen validas.
 */

type Rename = { from: string; to: string };

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const purge = args.includes("--purge");

/** Columnas que guardan una URL de upload como valor completo. */
const URL_COLUMNS: Array<{ table: string; column: string; idColumn: string }> = [
  { table: "productos", column: "imagen_url", idColumn: "id" },
  { table: "productos", column: "imagen_mobile_url", idColumn: "id" },
  { table: "producto_imagenes", column: "imagen_url", idColumn: "id" },
  { table: "categorias", column: "imagen_url", idColumn: "id" },
  { table: "layout_timeline_eventos", column: "imagen_url", idColumn: "id" },
];

/** Columnas de texto largo donde la URL aparece embebida (markdown). */
const TEXT_COLUMNS: Array<{ table: string; column: string; idColumn: string }> = [
  { table: "paginas_contenido", column: "contenido", idColumn: "slug" },
];

async function tableExists(table: string): Promise<boolean> {
  const rows = await qAll(
    pool,
    `SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [table],
  );
  return rows.length > 0;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await qAll(
    pool,
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column],
  );
  return rows.length > 0;
}

/** Actualiza las referencias exactas (…/archivo.png -> …/archivo.webp). */
async function updateUrlColumns(renames: Rename[]): Promise<number> {
  let updated = 0;
  for (const { table, column, idColumn } of URL_COLUMNS) {
    if (!(await tableExists(table)) || !(await columnExists(table, column))) {
      console.log(`[skip] ${table}.${column} no existe en esta base`);
      continue;
    }
    for (const { from, to } of renames) {
      // LIKE con el nombre de archivo: cubre '/uploads/x.png' y '/api/uploads/x.png'.
      const result = await qRun(
        pool,
        `UPDATE ${table} SET ${column} = REPLACE(${column}, ?, ?) WHERE ${column} LIKE ?`,
        [from, to, `%${from}%`],
      );
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
async function updateTextColumns(renames: Rename[]): Promise<number> {
  let updated = 0;
  for (const { table, column } of TEXT_COLUMNS) {
    if (!(await tableExists(table)) || !(await columnExists(table, column))) {
      console.log(`[skip] ${table}.${column} no existe en esta base`);
      continue;
    }
    for (const { from, to } of renames) {
      const result = await qRun(
        pool,
        `UPDATE ${table} SET ${column} = REPLACE(${column}, ?, ?) WHERE ${column} LIKE ?`,
        [from, to, `%${from}%`],
      );
      if (result.affectedRows > 0) {
        updated += result.affectedRows;
        console.log(`  ${table}.${column}: ${result.affectedRows} fila(s) -> ${to}`);
      }
    }
  }
  return updated;
}

async function main() {
  const entries = await fs.readdir(UPLOADS_DIR, { withFileTypes: true });
  const pending = entries
    .filter((e) => e.isFile() && !isVariantFilename(e.name))
    .filter((e) => /\.(png|jpe?g)$/i.test(e.name))
    .map((e) => e.name);

  const alreadyWebp = entries.filter((e) => e.isFile() && /\.webp$/i.test(e.name) && !isVariantFilename(e.name)).length;

  console.log(`${dryRun ? "[DRY RUN] " : ""}Uploads en ${UPLOADS_DIR}`);
  console.log(`  ya en WebP (se saltean): ${alreadyWebp}`);
  console.log(`  a migrar: ${pending.length}\n`);

  if (pending.length === 0) {
    console.log("Nada para migrar. Todo ya esta en WebP.");
    await pool.end();
    return;
  }

  const renames: Rename[] = [];
  let bytesBefore = 0;
  let bytesAfter = 0;

  for (const filename of pending) {
    const before = (await fs.stat(path.join(UPLOADS_DIR, filename))).size;
    bytesBefore += before;
    const webpName = `${filename.slice(0, -path.extname(filename).length)}.webp`;

    if (dryRun) {
      console.log(`  ${filename} -> ${webpName} (${Math.round(before / 1024)}KB)`);
      renames.push({ from: filename, to: webpName });
      continue;
    }

    // 1) Escribir el .webp y sus variantes ANTES de tocar la base.
    await reencodeExistingUploadToWebp(UPLOADS_DIR, filename);
    await ensureVariantsFor(UPLOADS_DIR, webpName);
    const after = (await fs.stat(path.join(UPLOADS_DIR, webpName))).size;
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
    await pool.end();
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
      await fs.unlink(path.join(UPLOADS_DIR, from)).catch(() => {});
      console.log(`  borrado ${from}`);
    }
  } else {
    console.log("\nLos archivos originales quedaron en disco como red de seguridad.");
    console.log("Verifica la app y despues corre de nuevo con --purge para borrarlos.");
  }

  console.log(
    `\nTotal: ${Math.round(bytesBefore / 1024)}KB -> ${Math.round(bytesAfter / 1024)}KB` +
      (bytesBefore > 0 ? ` (${Math.round((1 - bytesAfter / bytesBefore) * 100)}% menos)` : ""),
  );
  await pool.end();
}

/** En dry-run solo cuenta cuantas filas se tocarian, sin escribir. */
async function updateUrlColumnsDryRun(renames: Rename[]) {
  for (const { table, column } of [...URL_COLUMNS, ...TEXT_COLUMNS]) {
    if (!(await tableExists(table)) || !(await columnExists(table, column))) continue;
    for (const { from } of renames) {
      const rows = await qAll(pool, `SELECT COUNT(*) AS c FROM ${table} WHERE ${column} LIKE ?`, [`%${from}%`]);
      const count = Number((rows[0] as any)?.c ?? 0);
      if (count > 0) console.log(`  ${table}.${column}: ${count} fila(s) contienen ${from}`);
    }
  }
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => {});
  process.exit(1);
});
