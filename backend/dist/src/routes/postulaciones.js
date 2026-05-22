"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const uuid_1 = require("uuid");
const zod_1 = require("zod");
const auth_1 = require("../auth");
const db_1 = require("../db");
const uploadSecurity_1 = require("../uploadSecurity");
const paths_1 = require("../paths");
const router = (0, express_1.Router)();
const CV_UPLOAD_DIR = path_1.default.join(paths_1.BACKEND_ROOT, "private_uploads/postulaciones");
const CV_MAX_BYTES = 5 * 1024 * 1024;
const CV_EXTENSIONS = new Set([".pdf", ".doc", ".docx"]);
const CV_MIME_TYPES = new Set([
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/octet-stream",
]);
function ensureCvUploadDir() {
    fs_1.default.mkdirSync(CV_UPLOAD_DIR, { recursive: true });
}
function sanitizeDownloadName(name) {
    return name.replace(/[/\\?%*:|"<>]/g, "_").trim() || "cv";
}
const cvStorage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => {
        try {
            ensureCvUploadDir();
            cb(null, CV_UPLOAD_DIR);
        }
        catch (error) {
            cb(error, CV_UPLOAD_DIR);
        }
    },
    filename: (_req, file, cb) => {
        const ext = path_1.default.extname(file.originalname).toLowerCase();
        if (!CV_EXTENSIONS.has(ext)) {
            cb(new Error("Formato de CV no permitido"), "");
            return;
        }
        cb(null, `${(0, uuid_1.v4)()}-${Date.now()}${ext}`);
    },
});
const cvUpload = (0, multer_1.default)({
    storage: cvStorage,
    limits: { fileSize: CV_MAX_BYTES },
    fileFilter: (_req, file, cb) => {
        const ext = path_1.default.extname(file.originalname).toLowerCase();
        if (CV_EXTENSIONS.has(ext) && CV_MIME_TYPES.has(file.mimetype)) {
            cb(null, true);
            return;
        }
        cb(new Error("Adjunta tu CV en formato PDF, DOC o DOCX."));
    },
});
const postulacionSchema = zod_1.z.object({
    nombre: zod_1.z.string().trim().min(2).max(160),
    email: zod_1.z.string().trim().email().max(160),
    telefono: zod_1.z.string().trim().max(40).optional().nullable(),
    mensaje: zod_1.z.string().trim().min(5).max(1500),
});
router.post("/", cvUpload.single("cv"), async (req, res) => {
    const parsed = postulacionSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
        if (req.file?.path)
            fs_1.default.promises.unlink(req.file.path).catch(() => undefined);
        res.status(400).json({ error: parsed.error.errors[0]?.message || "Datos invalidos." });
        return;
    }
    if (!req.file) {
        res.status(400).json({ error: "Adjunta tu CV en formato PDF, DOC o DOCX." });
        return;
    }
    const verification = await (0, uploadSecurity_1.verifyUploadedCvFile)(req.file);
    if (!verification.ok) {
        res.status(400).json({ error: "El archivo no coincide con un PDF, DOC o DOCX valido." });
        return;
    }
    const { nombre, email, telefono, mensaje } = parsed.data;
    const { insertId } = await (0, db_1.qRun)(db_1.pool, `INSERT INTO postulaciones_cv
       (nombre, email, telefono, mensaje, archivo_original, archivo_guardado, mime_type, size_bytes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
        nombre,
        email.toLowerCase(),
        telefono?.trim() || null,
        mensaje,
        req.file.originalname,
        req.file.filename,
        req.file.mimetype,
        req.file.size,
    ]);
    res.status(201).json({ ok: true, id: insertId });
});
router.get("/admin", auth_1.requireAuth, (0, auth_1.requireRole)("admin", "superAdmin"), async (_req, res) => {
    const rows = await (0, db_1.qAll)(db_1.pool, `SELECT id, nombre, email, telefono, mensaje, archivo_original, mime_type, size_bytes, estado, created_at
     FROM postulaciones_cv
     ORDER BY created_at DESC, id DESC
     LIMIT 300`);
    res.json(rows);
});
router.get("/admin/:id/cv", auth_1.requireAuth, (0, auth_1.requireRole)("admin", "superAdmin"), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: "ID de postulacion invalido." });
        return;
    }
    const row = await (0, db_1.qOne)(db_1.pool, "SELECT archivo_original, archivo_guardado, mime_type FROM postulaciones_cv WHERE id = ? LIMIT 1", [id]);
    if (!row) {
        res.status(404).json({ error: "Postulacion no encontrada." });
        return;
    }
    const resolvedPath = path_1.default.resolve(CV_UPLOAD_DIR, row.archivo_guardado);
    const uploadRoot = path_1.default.resolve(CV_UPLOAD_DIR);
    if (!resolvedPath.startsWith(uploadRoot + path_1.default.sep)) {
        res.status(400).json({ error: "Ruta de archivo invalida." });
        return;
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.download(resolvedPath, sanitizeDownloadName(row.archivo_original), (error) => {
        if (error && !res.headersSent) {
            res.status(404).json({ error: "No se pudo descargar el CV." });
        }
    });
});
exports.default = router;
