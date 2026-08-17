import { promises as fs } from "fs";
import path from "path";
import { Queryable, qAll, qRun } from "../db";
import { UPLOADS_DIR } from "../paths";
import { ensureVariantsFor, isVariantFilename, reencodeExistingUploadToWebp } from "./imageVariants";

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
const URL_COLUMNS: Array<{ table: string; column: string }> = [
  { table: "productos", column: "imagen_url" },
  { table: "productos", column: "imagen_mobile_url" },
  { table: "producto_imagenes", column: "imagen_url" },
  { table: "categorias", column: "imagen_url" },
  { table: "layout_timeline_eventos", column: "imagen_url" },
];

/** Columnas de texto largo donde la URL aparece embebida (markdown de páginas). */
const TEXT_COLUMNS: Array<{ table: string; column: string }> = [
  { table: "paginas_contenido", column: "contenido" },
];

const ALL_COLUMNS = [...URL_COLUMNS, ...TEXT_COLUMNS];

export type UploadRename = { from: string; to: string; bytesBefore: number; bytesAfter: number; created: boolean };

export type UploadsWebpMigrationResult = {
  /** Archivos efectivamente reencodeados en esta corrida. */
  converted: UploadRename[];
  /**
   * Todos los originales con contraparte .webp. Es un superconjunto de
   * `converted`: incluye los que ya se habían convertido antes pero cuyas
   * referencias en la base podrían haber quedado sin reescribir (por ejemplo
   * si una corrida anterior murió entre el paso de archivos y el de base).
   */
  renames: UploadRename[];
  alreadyWebp: number;
  referencesUpdated: number;
};

async function tableExists(conn: Queryable, table: string): Promise<boolean> {
  const rows = await qAll(
    conn,
    `SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [table],
  );
  return rows.length > 0;
}

async function columnExists(conn: Queryable, table: string, column: string): Promise<boolean> {
  const rows = await qAll(
    conn,
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column],
  );
  return rows.length > 0;
}

/** Nombres de archivo (sin variantes) que todavía no están en WebP. */
export async function listPendingUploads(uploadsDir: string = UPLOADS_DIR): Promise<string[]> {
  const entries = await fs.readdir(uploadsDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && !isVariantFilename(e.name) && /\.(png|jpe?g)$/i.test(e.name))
    .map((e) => e.name);
}

export async function countWebpUploads(uploadsDir: string = UPLOADS_DIR): Promise<number> {
  const entries = await fs.readdir(uploadsDir, { withFileTypes: true });
  return entries.filter((e) => e.isFile() && /\.webp$/i.test(e.name) && !isVariantFilename(e.name)).length;
}

/** Cuenta las filas que contienen cada archivo, sin escribir nada. */
export async function countReferences(conn: Queryable, filenames: string[]): Promise<Array<{ table: string; column: string; filename: string; rows: number }>> {
  const found: Array<{ table: string; column: string; filename: string; rows: number }> = [];
  for (const { table, column } of ALL_COLUMNS) {
    if (!(await tableExists(conn, table)) || !(await columnExists(conn, table, column))) continue;
    for (const filename of filenames) {
      const rows = await qAll<{ c: number }>(
        conn,
        `SELECT COUNT(*) AS c FROM \`${table}\` WHERE \`${column}\` LIKE ?`,
        [`%${filename}%`],
      );
      const count = Number(rows[0]?.c ?? 0);
      if (count > 0) found.push({ table, column, filename, rows: count });
    }
  }
  return found;
}

/**
 * Reescribe las referencias .png/.jpg -> .webp en todas las columnas.
 * Usa REPLACE sobre el nombre de archivo, así cubre tanto '/uploads/x.png'
 * como '/api/uploads/x.png' y las URLs embebidas en markdown.
 */
export async function rewriteReferences(
  conn: Queryable,
  renames: Array<{ from: string; to: string }>,
  onUpdate?: (table: string, column: string, to: string, rows: number) => void,
): Promise<number> {
  let updated = 0;
  for (const { table, column } of ALL_COLUMNS) {
    if (!(await tableExists(conn, table)) || !(await columnExists(conn, table, column))) continue;
    for (const { from, to } of renames) {
      const result = await qRun(
        conn,
        `UPDATE \`${table}\` SET \`${column}\` = REPLACE(\`${column}\`, ?, ?) WHERE \`${column}\` LIKE ?`,
        [from, to, `%${from}%`],
      );
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
export async function migrateUploadsToWebp(
  conn: Queryable,
  options: {
    uploadsDir?: string;
    onFile?: (rename: UploadRename) => void;
    onReference?: (table: string, column: string, to: string, rows: number) => void;
  } = {},
): Promise<UploadsWebpMigrationResult> {
  const uploadsDir = options.uploadsDir ?? UPLOADS_DIR;
  const pending = await listPendingUploads(uploadsDir);
  const alreadyWebp = await countWebpUploads(uploadsDir);

  if (pending.length === 0) {
    return { converted: [], renames: [], alreadyWebp, referencesUpdated: 0 };
  }

  // 1) Archivos primero: si algo falla acá, la base queda intacta.
  const renames: UploadRename[] = [];
  for (const filename of pending) {
    const bytesBefore = (await fs.stat(path.join(uploadsDir, filename))).size;
    const { webpName, created } = await reencodeExistingUploadToWebp(uploadsDir, filename);
    await ensureVariantsFor(uploadsDir, webpName);
    const bytesAfter = (await fs.stat(path.join(uploadsDir, webpName))).size;
    const rename = { from: filename, to: webpName, bytesBefore, bytesAfter, created };
    renames.push(rename);
    // Solo se reporta lo que realmente se convirtió en esta corrida.
    if (created) options.onFile?.(rename);
  }

  // 2) Recién ahora, las referencias. Se reescriben para TODOS los renames,
  //    no solo los recién creados: una corrida anterior pudo haber escrito el
  //    archivo y morir antes de actualizar la base. Si ya están migradas, el
  //    UPDATE no matchea nada y no hace daño.
  const referencesUpdated = await rewriteReferences(conn, renames, options.onReference);

  return { converted: renames.filter((r) => r.created), renames, alreadyWebp, referencesUpdated };
}

/** Borra los archivos originales ya migrados. Se llama aparte, a propósito. */
export async function purgeOriginals(
  renames: Array<{ from: string }>,
  uploadsDir: string = UPLOADS_DIR,
): Promise<number> {
  let removed = 0;
  for (const { from } of renames) {
    try {
      await fs.unlink(path.join(uploadsDir, from));
      removed += 1;
    } catch {
      // ya no estaba
    }
  }
  return removed;
}
