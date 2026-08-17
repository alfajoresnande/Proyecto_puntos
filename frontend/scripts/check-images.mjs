// Guardia de peso de imágenes en frontend/public/.
//
// Falla (exit 1) si algún archivo supera MAX_IMAGE_KB. Corre como parte
// de `npm run build`, así una imagen sin optimizar no llega a producción.
//
// Umbral: 900KB. El archivo más pesado ya optimizado es parallax/11.png
// (857KB, foto convertida a paleta PNG que no comprime más sin degradarse).
// Una imagen sin optimizar (export directo de cámara/diseño) pesa 1-2MB+,
// así que 900KB deja pasar todo lo actual y atrapa cualquier regresión real.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_IMAGE_KB = 900;

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

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

const offenders = [];
for (const file of await walk(PUBLIC_DIR)) {
  const { size } = await fs.stat(file);
  if (size > MAX_IMAGE_KB * 1024) {
    offenders.push({ rel: path.relative(PUBLIC_DIR, file).replaceAll("\\", "/"), kb: Math.round(size / 1024) });
  }
}

if (offenders.length > 0) {
  console.error(`\n[check-images] Imágenes de más de ${MAX_IMAGE_KB}KB en frontend/public/:\n`);
  for (const o of offenders.sort((a, b) => b.kb - a.kb)) {
    console.error(`  ${String(o.kb).padStart(6)}KB  ${o.rel}`);
  }
  console.error(`\nCorré: node scripts/optimize-images.mjs\n`);
  process.exit(1);
}

console.log(`[check-images] OK: ninguna imagen supera ${MAX_IMAGE_KB}KB.`);
