import fs from "fs";
import path from "path";
import { Router } from "express";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth";
import { pool, qAll, qOne, qRun } from "../db";
import { verifyUploadedCvFile } from "../uploadSecurity";
import { BACKEND_ROOT } from "../paths";

const router = Router();
const CV_UPLOAD_DIR = path.join(BACKEND_ROOT, "private_uploads/postulaciones");
const CV_MAX_BYTES = 5 * 1024 * 1024;
const CV_EXTENSIONS = new Set([".pdf", ".doc", ".docx"]);
const CV_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/octet-stream",
]);

function ensureCvUploadDir() {
  fs.mkdirSync(CV_UPLOAD_DIR, { recursive: true });
}

function sanitizeDownloadName(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, "_").trim() || "cv";
}

const cvStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    try {
      ensureCvUploadDir();
      cb(null, CV_UPLOAD_DIR);
    } catch (error) {
      cb(error as Error, CV_UPLOAD_DIR);
    }
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!CV_EXTENSIONS.has(ext)) {
      cb(new Error("Formato de CV no permitido"), "");
      return;
    }
    cb(null, `${uuidv4()}-${Date.now()}${ext}`);
  },
});

const cvUpload = multer({
  storage: cvStorage,
  limits: { fileSize: CV_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (CV_EXTENSIONS.has(ext) && CV_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error("Adjunta tu CV en formato PDF, DOC o DOCX."));
  },
});

const postulacionSchema = z.object({
  nombre: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(160),
  telefono: z.string().trim().max(40).optional().nullable(),
  mensaje: z.string().trim().min(5).max(1500),
});

router.post("/", cvUpload.single("cv"), async (req, res) => {
  const parsed = postulacionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    if (req.file?.path) fs.promises.unlink(req.file.path).catch(() => undefined);
    res.status(400).json({ error: parsed.error.errors[0]?.message || "Datos invalidos." });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "Adjunta tu CV en formato PDF, DOC o DOCX." });
    return;
  }

  const verification = await verifyUploadedCvFile(req.file);
  if (!verification.ok) {
    res.status(400).json({ error: "El archivo no coincide con un PDF, DOC o DOCX valido." });
    return;
  }

  const { nombre, email, telefono, mensaje } = parsed.data;
  const { insertId } = await qRun(
    pool,
    `INSERT INTO postulaciones_cv
       (nombre, email, telefono, mensaje, archivo_original, archivo_guardado, mime_type, size_bytes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nombre,
      email.toLowerCase(),
      telefono?.trim() || null,
      mensaje,
      req.file.originalname,
      req.file.filename,
      req.file.mimetype,
      req.file.size,
    ],
  );

  res.status(201).json({ ok: true, id: insertId });
});

router.get("/admin", requireAuth, requireRole("admin", "superAdmin"), async (_req, res) => {
  const rows = await qAll(
    pool,
    `SELECT id, nombre, email, telefono, mensaje, archivo_original, mime_type, size_bytes, estado, created_at
     FROM postulaciones_cv
     ORDER BY created_at DESC, id DESC
     LIMIT 300`,
  );
  res.json(rows);
});

router.get("/admin/:id/cv", requireAuth, requireRole("admin", "superAdmin"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "ID de postulacion invalido." });
    return;
  }

  const row = await qOne<{
    archivo_original: string;
    archivo_guardado: string;
    mime_type: string | null;
  }>(pool, "SELECT archivo_original, archivo_guardado, mime_type FROM postulaciones_cv WHERE id = ? LIMIT 1", [id]);
  if (!row) {
    res.status(404).json({ error: "Postulacion no encontrada." });
    return;
  }

  const resolvedPath = path.resolve(CV_UPLOAD_DIR, row.archivo_guardado);
  const uploadRoot = path.resolve(CV_UPLOAD_DIR);
  if (!resolvedPath.startsWith(uploadRoot + path.sep)) {
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

export default router;
