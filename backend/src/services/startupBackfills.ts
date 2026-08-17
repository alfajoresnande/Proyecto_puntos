import { pool, qAll, qOne, qRun } from "../db";
import { acreditarPuntosPorCompra } from "./points";
import { migrateUploadsToWebp } from "./uploadsWebpMigration";

// Version 2: la v1 solo generaba variantes para los archivos que convertia,
// asi que los uploads que ya venian en WebP quedaron sin -card/-thumb y el
// frontend comia un 404 por imagen. Clave nueva para que vuelva a correr.
const UPLOADS_WEBP_MIGRATION_KEY = "migracion_uploads_webp_v2";
const UPLOADS_WEBP_MIGRATION_DESCRIPTION =
  "Marca si ya se ejecuto la migracion de imagenes subidas a WebP y la generacion de variantes -card/-thumb.";

const WEB_CHECKOUT_POINTS_BACKFILL_KEY = "backfill_puntos_checkout_web_20260606";
const WEB_CHECKOUT_POINTS_BACKFILL_DESCRIPTION =
  "Marca si ya se ejecuto el backfill unico para acreditar puntos faltantes en compras web pagadas.";

type CandidateOrderRow = {
  id: number;
};

const PAID_ORDER_STATES = ["pagada", "preparandose", "preparada", "enviada", "entregando", "entregada"] as const;

async function ensureBackfillFlagRow() {
  await qRun(
    pool,
    `INSERT INTO configuracion (clave, valor, descripcion)
     VALUES (?, '0', ?)
     ON DUPLICATE KEY UPDATE
       descripcion = COALESCE(NULLIF(VALUES(descripcion), ''), configuracion.descripcion)`,
    [WEB_CHECKOUT_POINTS_BACKFILL_KEY, WEB_CHECKOUT_POINTS_BACKFILL_DESCRIPTION],
  );
}

async function loadMissingWebCheckoutPointOrders() {
  const placeholders = PAID_ORDER_STATES.map(() => "?").join(", ");
  return qAll<CandidateOrderRow>(
    pool,
    `SELECT o.id
     FROM ordenes o
     LEFT JOIN movimientos_puntos mp
       ON mp.referencia_tipo = 'ordenes'
      AND mp.referencia_id = o.id
      AND mp.tipo = 'acreditacion_compra'
     WHERE o.canal = 'web'
       AND o.total_dinero > 0
       AND o.estado IN (${placeholders})
       AND mp.id IS NULL
     ORDER BY o.id ASC`,
    [...PAID_ORDER_STATES],
  );
}

export async function runOneTimeWebCheckoutPointsBackfill(): Promise<void> {
  await ensureBackfillFlagRow();

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const flag = await qOne<{ valor: string }>(
      conn,
      `SELECT valor
       FROM configuracion
       WHERE clave = ?
       LIMIT 1
       FOR UPDATE`,
      [WEB_CHECKOUT_POINTS_BACKFILL_KEY],
    );

    if ((flag?.valor || "").trim() === "1") {
      await conn.rollback();
      console.log("[startup-backfill] backfill de puntos web ya ejecutado anteriormente.");
      return;
    }

    const placeholders = PAID_ORDER_STATES.map(() => "?").join(", ");
    const orders = await qAll<CandidateOrderRow>(
      conn,
      `SELECT o.id
       FROM ordenes o
       LEFT JOIN movimientos_puntos mp
         ON mp.referencia_tipo = 'ordenes'
        AND mp.referencia_id = o.id
        AND mp.tipo = 'acreditacion_compra'
       WHERE o.canal = 'web'
         AND o.total_dinero > 0
         AND o.estado IN (${placeholders})
         AND mp.id IS NULL
       ORDER BY o.id ASC
       FOR UPDATE`,
      [...PAID_ORDER_STATES],
    );

    console.log(`[startup-backfill] ordenes web con puntos faltantes detectadas: ${orders.length}`);
    for (const order of orders) {
      await acreditarPuntosPorCompra(conn, Number(order.id));
    }

    await qRun(
      conn,
      "UPDATE configuracion SET valor = '1' WHERE clave = ?",
      [WEB_CHECKOUT_POINTS_BACKFILL_KEY],
    );

    await conn.commit();
    console.log("[startup-backfill] backfill unico de puntos web completado.");
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export async function previewMissingWebCheckoutPointOrders(): Promise<number[]> {
  const rows = await loadMissingWebCheckoutPointOrders();
  return rows.map((row) => Number(row.id));
}

/**
 * Migra a WebP las imagenes subidas antes del pipeline y reescribe sus
 * referencias en la base. Corre sola al arrancar el servidor, una unica vez
 * (bandera en `configuracion`), porque en el hosting no hay consola para
 * ejecutar scripts a mano.
 *
 * Los archivos originales NO se borran: si alguna referencia quedara sin
 * migrar, la imagen sigue funcionando. Ocupan poco y son un conjunto fijo:
 * las subidas nuevas ya nacen en WebP.
 */
export async function runOneTimeUploadsWebpMigration(): Promise<void> {
  await qRun(
    pool,
    `INSERT INTO configuracion (clave, valor, descripcion)
     VALUES (?, '0', ?)
     ON DUPLICATE KEY UPDATE
       descripcion = COALESCE(NULLIF(VALUES(descripcion), ''), configuracion.descripcion)`,
    [UPLOADS_WEBP_MIGRATION_KEY, UPLOADS_WEBP_MIGRATION_DESCRIPTION],
  );

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // FOR UPDATE: si el hosting levanta dos procesos a la vez, solo uno migra.
    const flag = await qOne<{ valor: string }>(
      conn,
      "SELECT valor FROM configuracion WHERE clave = ? LIMIT 1 FOR UPDATE",
      [UPLOADS_WEBP_MIGRATION_KEY],
    );

    if ((flag?.valor || "").trim() === "1") {
      await conn.rollback();
      return;
    }

    const result = await migrateUploadsToWebp(conn, {
      onFile: ({ from, to, bytesBefore, bytesAfter }) => {
        console.log(
          `[uploads-webp] ${from} -> ${to} (${Math.round(bytesBefore / 1024)}KB -> ${Math.round(bytesAfter / 1024)}KB)`,
        );
      },
      onReference: (table, column, to, rows) => {
        console.log(`[uploads-webp] ${table}.${column}: ${rows} fila(s) -> ${to}`);
      },
      onVariants: (filename, created) => {
        console.log(`[uploads-webp] variantes generadas para ${filename}: ${created}`);
      },
      onVariantError: (filename, message) => {
        console.error(`[uploads-webp] no se pudieron generar variantes de ${filename}: ${message}`);
      },
    });

    await qRun(conn, "UPDATE configuracion SET valor = '1' WHERE clave = ?", [UPLOADS_WEBP_MIGRATION_KEY]);
    await conn.commit();

    if (result.converted.length === 0) {
      console.log(
        `[uploads-webp] nada nuevo para convertir (${result.alreadyWebp} imagen/es ya en WebP` +
          `${result.variantsCreated > 0 ? `, ${result.variantsCreated} variante(s) generada(s)` : ""}` +
          `${result.referencesUpdated > 0 ? `, ${result.referencesUpdated} referencia(s) puestas al dia` : ""}).`,
      );
    } else {
      const before = result.converted.reduce((acc, r) => acc + r.bytesBefore, 0);
      const after = result.converted.reduce((acc, r) => acc + r.bytesAfter, 0);
      console.log(
        `[uploads-webp] migracion completada: ${result.converted.length} imagen/es, ` +
          `${Math.round(before / 1024)}KB -> ${Math.round(after / 1024)}KB, ` +
          `${result.referencesUpdated} referencia(s) actualizada(s).`,
      );
      console.log("[uploads-webp] los archivos originales quedaron en disco como respaldo.");
    }
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
