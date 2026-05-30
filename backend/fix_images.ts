import { pool } from "./src/db";

async function run() {
  console.log("Updating timeline images...");
  await pool.query("UPDATE layout_timeline_eventos SET imagen_url = '/rural-palermo.webp' WHERE titulo LIKE '%Palermo%'");
  await pool.query("UPDATE layout_timeline_eventos SET imagen_url = '/came.webp' WHERE titulo LIKE '%CAME%' OR titulo LIKE '%Corrientes en alfajores%'");
  await pool.query("UPDATE layout_timeline_eventos SET imagen_url = '/lafalta.webp' WHERE titulo LIKE '%La Falda%'");
  console.log("Done");
  process.exit(0);
}

run();
