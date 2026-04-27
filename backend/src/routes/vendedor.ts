import { Router } from "express";
import { z } from "zod";
import { pool, qOne, qAll, qRun } from "../db";
import { requireAuth, requireRole } from "../auth";

const router = Router();
router.use(requireAuth, requireRole("vendedor", "admin"));

type CanjeItemDetalle = {
  producto_id: number;
  producto_nombre: string;
  producto_imagen: string | null;
  cantidad: number;
  puntos_unitarios: number;
  puntos_total: number;
};

async function getCanjeItemsByCanjeIds(canjeIds: number[]): Promise<Map<number, CanjeItemDetalle[]>> {
  const map = new Map<number, CanjeItemDetalle[]>();
  if (!canjeIds.length) return map;

  const placeholders = canjeIds.map(() => "?").join(", ");
  const rows = await qAll<{
    canje_id: number;
    producto_id: number;
    producto_nombre: string;
    producto_imagen: string | null;
    cantidad: number;
    puntos_unitarios: number;
    puntos_total: number;
  }>(
    pool,
    `SELECT ci.canje_id, ci.producto_id, p.nombre AS producto_nombre, p.imagen_url AS producto_imagen,
            ci.cantidad, ci.puntos_unitarios, ci.puntos_total
     FROM canje_items ci
     JOIN productos p ON p.id = ci.producto_id
     WHERE ci.canje_id IN (${placeholders})
     ORDER BY ci.canje_id ASC, ci.id ASC`,
    canjeIds,
  );

  for (const row of rows) {
    const current = map.get(Number(row.canje_id)) ?? [];
    current.push({
      producto_id: Number(row.producto_id),
      producto_nombre: row.producto_nombre,
      producto_imagen: row.producto_imagen ?? null,
      cantidad: Number(row.cantidad),
      puntos_unitarios: Number(row.puntos_unitarios),
      puntos_total: Number(row.puntos_total),
    });
    map.set(Number(row.canje_id), current);
  }

  return map;
}

// Buscar cliente por DNI (legacy / individual)
router.get("/cliente/:dni", async (req, res, next) => {
  try {
    const cliente = await qOne(pool,
      "SELECT id, nombre, dni, email, puntos_saldo AS puntos FROM usuarios WHERE dni = ? AND rol = 'cliente'",
      [req.params.dni]
    );
    if (!cliente) { res.status(404).json({ error: "Cliente no encontrado" }); return; }
    res.json(cliente);
  } catch (err) {
    next(err);
  }
});

// Buscar clientes por nombre o DNI (real-time search)
router.get("/clientes/buscar", async (req, res, next) => {
  try {
    const q = req.query.q;
    if (!q || typeof q !== "string") { return res.json([]); }
    
    const cleanQ = q.trim();
    if (cleanQ.length < 2) { return res.json([]); }

    const term = `%${cleanQ}%`;
    const rows = await qAll(pool,
      `SELECT id, nombre, dni, email, puntos_saldo AS puntos 
       FROM usuarios 
       WHERE rol = 'cliente' 
         AND (nombre LIKE ? OR dni LIKE ?)
       LIMIT 10`,
      [term, term]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Cargar puntos usando productos del catálogo como referencia
const cargarSchema = z.object({
  dni: z.string().min(6),
  items: z.array(z.object({
    producto_id: z.number().int().positive(),
    cantidad:    z.number().int().positive(),
  })).min(1),
  descripcion: z.string().optional(),
});

router.post("/cargar", async (req, res, next) => {
  const parsed = cargarSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }
  const { dni, items, descripcion } = parsed.data;

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const cliente = await qOne(conn,
      "SELECT id, puntos_saldo FROM usuarios WHERE dni = ? AND rol = 'cliente'",
      [dni]
    );
    if (!cliente) { res.status(404).json({ error: "Cliente no encontrado" }); await conn.rollback(); return; }

    let totalPuntos = 0;
    for (const item of items) {
      const prod = await qOne(conn,
        "SELECT id, puntos_acumulables FROM productos WHERE id = ? AND activo = 1",
        [item.producto_id]
      );
      if (!prod) {
        res.status(400).json({ error: `Producto ${item.producto_id} no existe o está inactivo` });
        await conn.rollback();
        return;
      }
      totalPuntos += (prod.puntos_acumulables ?? 0) * item.cantidad;
    }

    if (totalPuntos === 0) {
      res.status(400).json({ error: "Los productos seleccionados no tienen puntos acumulables" });
      await conn.rollback();
      return;
    }

    await qRun(conn,
      `INSERT INTO movimientos_puntos (usuario_id, tipo, puntos, descripcion, creado_por)
       VALUES (?, 'asignacion_manual', ?, ?, ?)`,
      [cliente.id, totalPuntos, descripcion ?? `Carga de puntos — ${items.length} producto(s)`, req.user!.id]
    );
    await qRun(conn, "UPDATE usuarios SET puntos_saldo = puntos_saldo + ? WHERE id = ?", [totalPuntos, cliente.id]);

    await conn.commit();

    res.status(201).json({
      ok: true,
      cliente_id: cliente.id,
      puntos_acreditados: totalPuntos,
      nuevo_saldo: cliente.puntos_saldo + totalPuntos,
    });
  } catch (err) {
    if (conn) await conn.rollback();
    next(err);
  } finally {
    if (conn) conn.release();
  }
});

// Buscar canje por código de retiro
router.get("/canje/:codigo", async (req, res, next) => {
  try {
    const codigo = req.params.codigo.trim().toUpperCase();
    const canje = await qOne(pool,
      `SELECT c.id, c.codigo_retiro, c.puntos_usados, c.estado, c.fecha_limite_retiro, c.notas,
              u.nombre AS cliente_nombre, u.dni AS cliente_dni,
              p.nombre AS producto_nombre,
              s.id AS sucursal_id, s.nombre AS sucursal_nombre, s.direccion AS sucursal_direccion,
              s.piso AS sucursal_piso, s.localidad AS sucursal_localidad, s.provincia AS sucursal_provincia
       FROM canjes c
       JOIN usuarios u ON u.id = c.usuario_id
       JOIN productos p ON p.id = c.producto_id
       LEFT JOIN sucursales s ON s.id = c.sucursal_id
       WHERE c.codigo_retiro = ?`,
      [codigo]
    );
    if (!canje) { res.status(404).json({ error: "Código de retiro no encontrado" }); return; }
    const itemsMap = await getCanjeItemsByCanjeIds([Number(canje.id)]);
    const fallbackItem: CanjeItemDetalle = {
      producto_id: 0,
      producto_nombre: String(canje.producto_nombre),
      producto_imagen: null,
      cantidad: 1,
      puntos_unitarios: Number(canje.puntos_usados),
      puntos_total: Number(canje.puntos_usados),
    };
    const items = itemsMap.get(Number(canje.id)) ?? [fallbackItem];
    const totalUnidades = items.reduce((acc, item) => acc + Number(item.cantidad), 0);

    res.json({
      ...canje,
      items,
      total_items: items.length,
      total_unidades: totalUnidades,
      productos_detalle: items.map((item) => `${item.producto_nombre} x${item.cantidad}`).join(" | "),
    });
  } catch (err) {
    next(err);
  }
});

// Actualizar estado de un canje (entregado / no_disponible / cancelado)
router.patch("/canje/:codigo", async (req, res, next) => {
  const codigo = req.params.codigo.trim().toUpperCase();
  const schema = z.object({
    estado: z.enum(["entregado", "no_disponible", "cancelado"]),
    notas: z.string().max(500).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }
  const { estado, notas } = parsed.data;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const canje = await qOne(conn,
      "SELECT id, usuario_id, puntos_usados, estado FROM canjes WHERE codigo_retiro = ? FOR UPDATE",
      [codigo]
    );
    if (!canje) { await conn.rollback(); res.status(404).json({ error: "Código de retiro no encontrado" }); return; }
    if (canje.estado === "entregado" || canje.estado === "cancelado") {
      await conn.rollback();
      res.status(400).json({ error: `El canje ya está en estado '${canje.estado}'` });
      return;
    }

    await qRun(conn, "UPDATE canjes SET estado = ?, notas = ? WHERE id = ?", [estado, notas ?? null, canje.id]);

    if (estado === "no_disponible" || estado === "cancelado") {
      const motivo = estado === "cancelado" ? "cancelado" : "no disponible";
      await qRun(conn,
        `INSERT INTO movimientos_puntos
           (usuario_id, tipo, puntos, descripcion, referencia_id, referencia_tipo, creado_por)
         VALUES (?, 'devolucion_canje', ?, ?, ?, 'canjes', ?)`,
        [canje.usuario_id, canje.puntos_usados, `Devolución por canje ${motivo}`, canje.id, req.user!.id]
      );
      await qRun(conn, "UPDATE usuarios SET puntos_saldo = puntos_saldo + ? WHERE id = ?",
        [canje.puntos_usados, canje.usuario_id]);
    }

    await conn.commit();
    res.json({ ok: true, estado });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

export default router;
