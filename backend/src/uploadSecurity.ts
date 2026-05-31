import { promises as fs } from "fs";

const MAGIC_BYTES_READ = 16;
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const DOC_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const IMAGE_EXT_TO_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function hasPrefix(buffer: Buffer, signature: Buffer): boolean {
  if (buffer.length < signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (buffer[i] !== signature[i]) return false;
  }
  return true;
}

function detectMimeByMagic(buffer: Buffer): string | null {
  if (hasPrefix(buffer, JPEG_MAGIC)) return "image/jpeg";
  if (hasPrefix(buffer, PNG_MAGIC)) return "image/png";

  // WEBP: RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

async function safeDelete(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // no-op
  }
}

export async function verifyUploadedImageFile(
  file: Express.Multer.File
): Promise<{ ok: boolean; detectedMime: string | null; errorMessage?: string }> {
  try {
    const fd = await fs.open(file.path, "r");
    try {
      const probe = Buffer.alloc(MAGIC_BYTES_READ);
      await fd.read(probe, 0, MAGIC_BYTES_READ, 0);
      const detectedMime = detectMimeByMagic(probe);
      const originalExt = file.originalname.toLowerCase().match(/\.(jpe?g|png|webp)$/)?.[0] ?? "";
      const expectedMime = IMAGE_EXT_TO_MIME[originalExt] ?? null;
      
      const declaredMimeMatches = Boolean(detectedMime && detectedMime === file.mimetype);
      const extensionMatches = Boolean(detectedMime && expectedMime && detectedMime === expectedMime);
      const ok = declaredMimeMatches || extensionMatches;
      
      let errorMessage: string | undefined;
      if (!ok) {
        await safeDelete(file.path);
        if (!detectedMime) {
          errorMessage = "El archivo no parece ser una imagen válida.";
        } else if (expectedMime && detectedMime !== expectedMime) {
          const formatNames: Record<string, string> = { "image/jpeg": "JPG", "image/png": "PNG", "image/webp": "WEBP" };
          const originalName = formatNames[detectedMime] || detectedMime;
          const attemptedName = formatNames[expectedMime] || expectedMime;
          errorMessage = `El archivo está en formato original ${originalName}, y usted está intentando subirlo como ${attemptedName} (extensión ${originalExt.toUpperCase()}). Como protección, el sistema rechaza este tipo de archivos por comprobar que no vengan archivos maliciosos renombrados. Debe realizar una conversión al formato correcto.`;
        } else {
          errorMessage = "El formato interno del archivo no coincide con su extensión. Como protección de seguridad, fue rechazado.";
        }
      }
      return { ok, detectedMime, errorMessage };
    } finally {
      await fd.close();
    }
  } catch {
    await safeDelete(file.path);
    return { ok: false, detectedMime: null };
  }
}

function detectCvTypeByMagic(buffer: Buffer): "pdf" | "doc" | "docx" | null {
  if (hasPrefix(buffer, PDF_MAGIC)) return "pdf";
  if (hasPrefix(buffer, DOC_MAGIC)) return "doc";
  if (hasPrefix(buffer, ZIP_MAGIC)) return "docx";
  return null;
}

export async function verifyUploadedCvFile(
  file: Express.Multer.File
): Promise<{ ok: boolean; detectedType: "pdf" | "doc" | "docx" | null }> {
  try {
    const ext = file.originalname.toLowerCase().match(/\.(pdf|doc|docx)$/)?.[1] as "pdf" | "doc" | "docx" | undefined;
    const fd = await fs.open(file.path, "r");
    try {
      const probe = Buffer.alloc(MAGIC_BYTES_READ);
      await fd.read(probe, 0, MAGIC_BYTES_READ, 0);
      const detectedType = detectCvTypeByMagic(probe);
      const ok = Boolean(ext && detectedType && ext === detectedType);
      if (!ok) await safeDelete(file.path);
      return { ok, detectedType };
    } finally {
      await fd.close();
    }
  } catch {
    await safeDelete(file.path);
    return { ok: false, detectedType: null };
  }
}
