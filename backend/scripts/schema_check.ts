import { pool } from "../src/db";

async function run() {
  try {
    const [rows] = await pool.query("DESCRIBE movimientos_puntos");
    console.log("movimientos_puntos schema:");
    console.table(rows);
    
    const [idx] = await pool.query("SHOW INDEX FROM movimientos_puntos");
    console.log("movimientos_puntos indexes:");
    console.table(idx);

  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
run();
