import { pool, qAll } from "../db";
import { acreditarPuntosPorCompra } from "../services/points";

type CandidateOrderRow = {
  id: number;
  estado: string;
  total_dinero: number;
};

const PAID_ORDER_STATES = ["pagada", "preparandose", "preparada", "enviada", "entregando", "entregada"] as const;

function parseOrderIdArg(rawValue: string | undefined): number | null {
  if (!rawValue) return null;
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("Si indicas un ID de orden, debe ser un entero positivo.");
  }
  return parsed;
}

async function loadCandidateOrders(orderId: number | null): Promise<CandidateOrderRow[]> {
  const statePlaceholders = PAID_ORDER_STATES.map(() => "?").join(", ");
  const params: Array<string | number> = [...PAID_ORDER_STATES];
  let orderFilterSql = "";

  if (orderId) {
    orderFilterSql = "AND o.id = ?";
    params.push(orderId);
  }

  return qAll<CandidateOrderRow>(
    pool,
    `SELECT o.id, o.estado, o.total_dinero
     FROM ordenes o
     LEFT JOIN movimientos_puntos mp
       ON mp.referencia_tipo = 'ordenes'
      AND mp.referencia_id = o.id
      AND mp.tipo = 'acreditacion_compra'
     WHERE o.canal = 'web'
       AND o.total_dinero > 0
       AND o.estado IN (${statePlaceholders})
       AND mp.id IS NULL
       ${orderFilterSql}
     ORDER BY o.id ASC`,
    params,
  );
}

async function processOrder(orderId: number): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await acreditarPuntosPorCompra(conn, orderId);
    await conn.commit();
    console.log(`[backfill-puntos-web] OK orden #${orderId}`);
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function main() {
  const orderId = parseOrderIdArg(process.argv[2]);
  const candidates = await loadCandidateOrders(orderId);

  if (!candidates.length) {
    console.log(
      orderId
        ? `[backfill-puntos-web] No se encontro la orden web pagada #${orderId} con puntos faltantes.`
        : "[backfill-puntos-web] No hay ordenes web pagadas con puntos faltantes.",
    );
    return;
  }

  console.log(`[backfill-puntos-web] Ordenes a reparar: ${candidates.length}`);
  for (const order of candidates) {
    await processOrder(Number(order.id));
  }
  console.log("[backfill-puntos-web] Finalizado.");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[backfill-puntos-web] ERROR: ${message}`);
  process.exit(1);
});
