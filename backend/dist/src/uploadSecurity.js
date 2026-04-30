"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyUploadedImageFile = verifyUploadedImageFile;
const fs_1 = require("fs");
const MAGIC_BYTES_READ = 16;
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function hasPrefix(buffer, signature) {
    if (buffer.length < signature.length)
        return false;
    for (let i = 0; i < signature.length; i += 1) {
        if (buffer[i] !== signature[i])
            return false;
    }
    return true;
}
function detectMimeByMagic(buffer) {
    if (hasPrefix(buffer, JPEG_MAGIC))
        return "image/jpeg";
    if (hasPrefix(buffer, PNG_MAGIC))
        return "image/png";
    // WEBP: RIFF....WEBP
    if (buffer.length >= 12 &&
        buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
        buffer.subarray(8, 12).toString("ascii") === "WEBP") {
        return "image/webp";
    }
    return null;
}
async function safeDelete(filePath) {
    try {
        await fs_1.promises.unlink(filePath);
    }
    catch {
        // no-op
    }
}
async function verifyUploadedImageFile(file) {
    try {
        const fd = await fs_1.promises.open(file.path, "r");
        try {
            const probe = Buffer.alloc(MAGIC_BYTES_READ);
            await fd.read(probe, 0, MAGIC_BYTES_READ, 0);
            const detectedMime = detectMimeByMagic(probe);
            const ok = Boolean(detectedMime && detectedMime === file.mimetype);
            if (!ok)
                await safeDelete(file.path);
            return { ok, detectedMime };
        }
        finally {
            await fd.close();
        }
    }
    catch {
        await safeDelete(file.path);
        return { ok: false, detectedMime: null };
    }
}
