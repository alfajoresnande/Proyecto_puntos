"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UPLOADS_DIR_SOURCE = exports.UPLOADS_DIR = exports.UPLOADS_DIR_AMBIGUOUS = exports.BACKEND_ROOT = void 0;
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
/**
 * Busca una carpeta `uploads` existente fuera del proyecto, subiendo desde la
 * raíz del backend. En hostings donde el deploy borra y vuelve a clonar el
 * repo, la carpeta suele guardarse en la raíz de la cuenta (hermana de
 * `public_html/`) justamente para que no se pierda.
 */
function findExternalUploadsDir(startDir) {
    let dir = path_1.default.dirname(startDir);
    for (let i = 0; i < 4; i++) {
        const candidate = path_1.default.join(dir, "uploads");
        if (fs_1.default.existsSync(candidate) && fs_1.default.statSync(candidate).isDirectory())
            return candidate;
        const parent = path_1.default.dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return null;
}
function resolveUploadsDir() {
    // 1) Override explícito por entorno: es lo que manda si está definido.
    const fromEnv = process.env.UPLOADS_DIR?.trim();
    if (fromEnv)
        return { dir: path_1.default.resolve(fromEnv), source: "variable de entorno UPLOADS_DIR" };
    // 2) La carpeta dentro del backend, si ya existe.
    const inBackend = path_1.default.join(exports.BACKEND_ROOT, "uploads");
    if (fs_1.default.existsSync(inBackend))
        return { dir: inBackend, source: "carpeta del backend" };
    // 3) Una carpeta uploads/ mas arriba (raíz de la cuenta en el hosting).
    const external = findExternalUploadsDir(exports.BACKEND_ROOT);
    if (external)
        return { dir: external, source: "carpeta externa detectada automaticamente" };
    // 4) Nada existe todavía: se usa la del backend y se crea al vuelo.
    return { dir: inBackend, source: "carpeta del backend (se creara)" };
}
const resolvedUploads = resolveUploadsDir();
/**
 * Si hay dos carpetas `uploads` candidatas (la del repo y una externa), la
 * eleccion automatica puede no ser la correcta: en hostings donde el deploy
 * reclona el repo, la del repo se recrea vacia en cada push y las subidas
 * nuevas se perderian. Se avisa para que se defina UPLOADS_DIR a mano.
 */
exports.UPLOADS_DIR_AMBIGUOUS = (() => {
    if (process.env.UPLOADS_DIR?.trim())
        return null; // ya es explicito
    const inBackend = path_1.default.join(exports.BACKEND_ROOT, "uploads");
    const external = findExternalUploadsDir(exports.BACKEND_ROOT);
    if (external && fs_1.default.existsSync(inBackend) && external !== resolvedUploads.dir)
        return external;
    return null;
})();
/** Directorio donde se guardan las imágenes subidas */
exports.UPLOADS_DIR = resolvedUploads.dir;
/** De dónde salió UPLOADS_DIR. Solo para logging de diagnóstico. */
exports.UPLOADS_DIR_SOURCE = resolvedUploads.source;
