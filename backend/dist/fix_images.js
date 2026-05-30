"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = require("./src/db");
async function run() {
    console.log("Updating timeline images...");
    await db_1.pool.query("UPDATE layout_timeline_eventos SET imagen_url = '/rural-palermo.webp' WHERE titulo LIKE '%Palermo%'");
    await db_1.pool.query("UPDATE layout_timeline_eventos SET imagen_url = '/came.webp' WHERE titulo LIKE '%CAME%' OR titulo LIKE '%Corrientes en alfajores%'");
    await db_1.pool.query("UPDATE layout_timeline_eventos SET imagen_url = '/lafalta.webp' WHERE titulo LIKE '%La Falda%'");
    console.log("Done");
    process.exit(0);
}
run();
