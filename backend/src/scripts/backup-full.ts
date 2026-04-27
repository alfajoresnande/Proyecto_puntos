import { createFullBackupArchive } from "../services/backup";

async function main() {
  const result = await createFullBackupArchive();
  const sizeMb = (result.sizeBytes / (1024 * 1024)).toFixed(2);
  console.log(`[backup] OK`);
  console.log(`[backup] Archivo: ${result.archivePath}`);
  console.log(`[backup] Tamano: ${sizeMb} MB`);
  console.log(`[backup] Fecha: ${result.createdAt}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[backup] ERROR: ${message}`);
  process.exit(1);
});
