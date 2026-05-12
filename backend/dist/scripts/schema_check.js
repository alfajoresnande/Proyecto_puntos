"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = require("../src/db");
async function run() {
    try {
        const [rows] = await db_1.pool.query("DESCRIBE movimientos_puntos");
        console.log("movimientos_puntos schema:");
        console.table(rows);
        const [idx] = await db_1.pool.query("SHOW INDEX FROM movimientos_puntos");
        console.log("movimientos_puntos indexes:");
        console.table(idx);
    }
    catch (err) {
        console.error(err);
    }
    finally {
        await db_1.pool.end();
    }
}
run();
