"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UPLOADS_DIR = exports.BACKEND_ROOT = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
/**
 * Calcula la raíz del directorio backend subiendo desde __dirname
 * hasta encontrar package.json.
 *
 * Funciona tanto en desarrollo (tsx watch src/server.ts)
 * como en producción (node dist/src/server.js).
 */
function findBackendRoot(startDir) {
    let dir = startDir;
    for (let i = 0; i < 5; i++) {
        if (fs_1.default.existsSync(path_1.default.join(dir, "package.json")))
            return dir;
        const parent = path_1.default.dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    // Fallback: asumir que estamos en dist/src/ → subir 2 niveles
    return path_1.default.resolve(startDir, "../..");
}
/** Directorio raíz del backend (donde está package.json) */
exports.BACKEND_ROOT = findBackendRoot(__dirname);
/** Directorio donde se guardan las imágenes subidas */
exports.UPLOADS_DIR = path_1.default.join(exports.BACKEND_ROOT, "uploads");
