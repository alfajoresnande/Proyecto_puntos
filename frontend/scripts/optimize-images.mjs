// Recomprime in-place las imágenes de frontend/public/ sin cambiar
// dimensiones, nombre ni extensión.
//
// Uso:
//   node scripts/optimize-images.mjs            # optimiza
//   node scripts/optimize-images.mjs --dry-run  # solo muestra qué haría
//   node scripts/optimize-images.mjs --backup <dir>  # copia originales antes de sobrescribir
//
// Idempotencia: solo se sobrescribe un archivo si la versión recomprimida
// ahorra al menos MIN_SAVING (15%). Una imagen ya optimizada no alcanza ese
// umbral en una segunda pasada, así que queda intacta y no se degrada más.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

const MIN_SAVING = 0.15; // ahorro mínimo para sobrescribir (clave de la idempotencia)
const MIN_SIZE_BYTES = 10 * 1024; // no tocar archivos chicos (favicons, etc.)

// Calidades base. Ajustes puntuales por archivo (ruta relativa a public/, con "/")
// para imágenes que muestren banding o artefactos con la calidad global.
const QUALITY = { jpeg: 82, webp: 82, pngPalette: 90 };
const PER_FILE_QUALITY = {
  // "parallax/13.png": { pngPalette: 100 },
};

const EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// colorType 3 (byte 25 del IHDR) = PNG con paleta. Volver a cuantizar un PNG ya
// paletizado degrada acumulativamente, así que a esos solo se les permite
// recompresión sin pérdida (clave para la idempotencia).
function isPalettePng(buffer) {
  return buffer.subarray(0, 8).equals(PNG_MAGIC) && buffer[25] === 3;
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const backupIdx = args.indexOf("--backup");
const backupDir = backupIdx !== -1 ? args[backupIdx + 1] : null;

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (EXTS.has(path.extname(entry.name).toLowerCase())) files.push(full);
  }
  return files;
}

function fmtKB(bytes) {
  return `${Math.round(bytes / 1024)}KB`;
}

async function encodeCandidates(input, meta, quality) {
  const ext = path.extname(input.path).toLowerCase();
  const candidates = [];

  if (ext === ".jpg" || ext === ".jpeg") {
    candidates.push({
      label: `jpeg q${quality.jpeg}`,
      buffer: await sharp(input.buffer)
        .jpeg({ quality: quality.jpeg, mozjpeg: true })
        .toBuffer(),
    });
  } else if (ext === ".webp") {
    // Lossy WebP conserva el canal alfa (VP8X + ALPH), no hace falta rama aparte.
    candidates.push({
      label: `webp q${quality.webp}`,
      buffer: await sharp(input.buffer)
        .webp({ quality: quality.webp, effort: 6, alphaQuality: 90 })
        .toBuffer(),
    });
  } else if (ext === ".png") {
    // Candidato 1: PNG sin pérdida, recompresión máxima.
    candidates.push({
      label: "png lossless",
      buffer: await sharp(input.buffer)
        .png({ compressionLevel: 9, adaptiveFiltering: true, effort: 10 })
        .toBuffer(),
    });
    // Candidato 2: paleta (con pérdida conservadora). Preserva alfa (paleta RGBA).
    // Solo para PNGs que todavía no están paletizados (ver isPalettePng).
    if (!isPalettePng(input.buffer)) {
      candidates.push({
        label: `png palette q${quality.pngPalette}`,
        buffer: await sharp(input.buffer)
          .png({ palette: true, quality: quality.pngPalette, effort: 10, dither: 1.0 })
          .toBuffer(),
      });
    }
  }

  return candidates;
}

async function main() {
  const files = await walk(PUBLIC_DIR);
  const results = [];
  let totalBefore = 0;
  let totalAfter = 0;

  for (const file of files) {
    const rel = path.relative(PUBLIC_DIR, file).replaceAll("\\", "/");
    const buffer = await fs.readFile(file);
    totalBefore += buffer.length;

    if (buffer.length < MIN_SIZE_BYTES) {
      totalAfter += buffer.length;
      results.push({ rel, before: buffer.length, after: buffer.length, note: "skip (chico)" });
      continue;
    }

    const meta = await sharp(buffer).metadata();
    const quality = { ...QUALITY, ...(PER_FILE_QUALITY[rel] ?? {}) };

    let best = null;
    try {
      const candidates = await encodeCandidates({ path: file, buffer }, meta, quality);
      for (const cand of candidates) {
        if (!best || cand.buffer.length < best.buffer.length) best = cand;
      }
    } catch (err) {
      totalAfter += buffer.length;
      results.push({ rel, before: buffer.length, after: buffer.length, note: `ERROR: ${err.message}` });
      continue;
    }

    const saving = best ? 1 - best.buffer.length / buffer.length : 0;
    if (!best || saving < MIN_SAVING) {
      totalAfter += buffer.length;
      results.push({ rel, before: buffer.length, after: buffer.length, note: "ya óptimo" });
      continue;
    }

    // Verificación dura: dimensiones y alfa idénticos, o no se escribe.
    const outMeta = await sharp(best.buffer).metadata();
    if (outMeta.width !== meta.width || outMeta.height !== meta.height) {
      totalAfter += buffer.length;
      results.push({ rel, before: buffer.length, after: buffer.length, note: "ABORT: dimensiones cambiaron" });
      continue;
    }
    if (meta.hasAlpha && !outMeta.hasAlpha) {
      totalAfter += buffer.length;
      results.push({ rel, before: buffer.length, after: buffer.length, note: "ABORT: se perdía el alfa" });
      continue;
    }

    if (!dryRun) {
      if (backupDir) {
        const backupPath = path.join(backupDir, rel);
        await fs.mkdir(path.dirname(backupPath), { recursive: true });
        try {
          await fs.access(backupPath); // ya hay backup de una corrida anterior: no pisarlo
        } catch {
          await fs.writeFile(backupPath, buffer);
        }
      }
      await fs.writeFile(file, best.buffer);
    }
    totalAfter += best.buffer.length;
    results.push({
      rel,
      before: buffer.length,
      after: best.buffer.length,
      note: `${best.label}${meta.hasAlpha ? " +alfa" : ""}`,
      dims: `${meta.width}x${meta.height}`,
    });
  }

  results.sort((a, b) => b.before - a.before);
  const pad = (s, n) => String(s).padStart(n);
  console.log(`${dryRun ? "[DRY RUN] " : ""}archivo`.padEnd(42) + pad("antes", 8) + pad("después", 9) + pad("ahorro", 8) + "  detalle");
  for (const r of results) {
    const pct = r.before > 0 ? Math.round((1 - r.after / r.before) * 100) : 0;
    console.log(
      r.rel.padEnd(42) + pad(fmtKB(r.before), 8) + pad(fmtKB(r.after), 9) + pad(`${pct}%`, 8) + `  ${r.dims ?? ""} ${r.note}`
    );
  }
  console.log("-".repeat(80));
  console.log(
    `TOTAL: ${fmtKB(totalBefore)} -> ${fmtKB(totalAfter)} (${Math.round((1 - totalAfter / totalBefore) * 100)}% menos)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
