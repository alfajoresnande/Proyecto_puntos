"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const backup_1 = require("../services/backup");
async function main() {
    const result = await (0, backup_1.createFullBackupArchive)();
    const sizeMb = (result.sizeBytes / (1024 * 1024)).toFixed(2);
    console.log(`[backup] OK`);
    console.log(`[backup] Archivo: ${result.archivePath}`);
    console.log(`[backup] Tamano: ${sizeMb} MB`);
    console.log(`[backup] Fecha: ${result.createdAt}`);
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[backup] ERROR: ${message}`);
    process.exit(1);
});
