import fs from "fs";
import path from "path";

/**
 * Calcula la raíz del directorio backend subiendo desde __dirname
 * hasta encontrar package.json.
 *
 * Funciona tanto en desarrollo (tsx watch src/server.ts)
 * como en producción (node dist/src/server.js).
 */
function findBackendRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: asumir que estamos en dist/src/ → subir 2 niveles
  return path.resolve(startDir, "../..");
}

/** Directorio raíz del backend (donde está package.json) */
export const BACKEND_ROOT = findBackendRoot(__dirname);

/** Directorio donde se guardan las imágenes subidas */
export const UPLOADS_DIR = path.join(BACKEND_ROOT, "uploads");
