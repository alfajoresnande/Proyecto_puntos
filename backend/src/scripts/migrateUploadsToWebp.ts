import { pool } from "../db";
import { UPLOADS_DIR } from "../paths";
import {
  countReferences,
  countWebpUploads,
  listPendingUploads,
  migrateUploadsToWebp,
  purgeOriginals,
} from "../services/uploadsWebpMigration";

/**
 * Version manual de la migracion de uploads a WebP.
 *
 * NO hace falta correr esto en produccion: la migracion se ejecuta sola al
 * arrancar el servidor (ver runOneTimeUploadsWebpMigration en
 * services/startupBackfills.ts). Este script existe para dos casos:
 *   - inspeccionar antes de tiempo con --dry-run
 *   - borrar los originales con --purge, que la version automatica no hace
 *
 * Uso:
 *   npx tsx src/scripts/migrateUploadsToWebp.ts --dry-run
 *   npx tsx src/scripts/migrateUploadsToWebp.ts
 *   npx tsx src/scripts/migrateUploadsToWebp.ts --purge
 */

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const purge = args.includes("--purge");

const kb = (bytes: number) => `${Math.round(bytes / 1024)}KB`;

async function main() {
  const pending = await listPendingUploads();
  const alreadyWebp = await countWebpUploads();

  console.log(`${dryRun ? "[DRY RUN] " : ""}Uploads en ${UPLOADS_DIR}`);
  console.log(`  ya en WebP (se saltean): ${alreadyWebp}`);
  console.log(`  a migrar: ${pending.length}\n`);

  if (pending.length === 0) {
    console.log("Nada para migrar.");
    return;
  }

  if (dryRun) {
    for (const filename of pending) console.log(`  ${filename}`);
    console.log("\nReferencias que se actualizarian:");
    const refs = await countReferences(pool, pending);
    if (refs.length === 0) {
      console.log("  (ninguna: los archivos no estan referenciados en la base)");
    } else {
      for (const r of refs) console.log(`  ${r.table}.${r.column}: ${r.rows} fila(s) contienen ${r.filename}`);
    }
    console.log("\n[DRY RUN] No se escribio nada.");
    return;
  }

  const result = await migrateUploadsToWebp(pool, {
    onFile: ({ from, to, bytesBefore, bytesAfter }) => {
      const nota =
        bytesAfter > bytesBefore
          ? `(OJO: crecio ${kb(bytesAfter - bytesBefore)}, imagen ya optimizada)`
          : `(${Math.round((1 - bytesAfter / bytesBefore) * 100)}% menos)`;
      console.log(`  ${from} -> ${to}  ${kb(bytesBefore)} -> ${kb(bytesAfter)} ${nota}`);
    },
    onReference: (table, column, to, rows) => {
      console.log(`  ${table}.${column}: ${rows} fila(s) -> ${to}`);
    },
  });

  const before = result.converted.reduce((acc, r) => acc + r.bytesBefore, 0);
  const after = result.converted.reduce((acc, r) => acc + r.bytesAfter, 0);
  console.log(`\n${result.referencesUpdated} referencia(s) actualizada(s).`);

  if (purge) {
    // renames, no converted: hay que borrar tambien los originales de
    // corridas anteriores que ya tenian su .webp.
    const removed = await purgeOriginals(result.renames);
    console.log(`Originales borrados: ${removed}`);
  } else {
    console.log("Los originales quedaron en disco. Corre con --purge para borrarlos.");
  }

  console.log(`\nTotal: ${kb(before)} -> ${kb(after)}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
