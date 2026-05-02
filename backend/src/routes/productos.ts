import { Router } from "express";
import { pool } from "../db";
import { normalizeSafeImageUrl } from "../urlSafety";

const router = Router();

// Catálogo público — no requiere autenticación
// Query params opcionales:
//   ?categoria=alfajores   → filtra por categoría (exacto, case-insensitive)
//   ?max_puntos=500        → filtra productos con puntos_requeridos <= N
router.get("/", async (req, res) => {
  const { categoria, max_puntos, modo } = req.query;

  const conditions: string[] = ["activo = 1"];
  const params: (string | number)[] = [];

  if (categoria && typeof categoria === "string") {
    conditions.push("LOWER(categoria) = LOWER(?)");
    params.push(categoria.trim());
  }

  const modoParam = typeof modo === "string" ? modo.trim().toLowerCase() : "canje";
  if (modoParam === "canje") {
    conditions.push("tipo_producto IN ('canje','mixto')");
  } else if (modoParam === "venta") {
    conditions.push("tipo_producto IN ('venta','mixto')");
  } else if (modoParam === "mixto") {
    conditions.push("tipo_producto = 'mixto'");
  }

  if (max_puntos) {
    const pts = parseInt(String(max_puntos), 10);
    if (!isNaN(pts) && pts > 0) {
      conditions.push("COALESCE(puntos_para_canjear, precio_puntos, puntos_requeridos) <= ?");
      params.push(pts);
    }
  }

  const where = conditions.join(" AND ");
  const [rowsRaw] = await pool.query(
    `SELECT id, nombre, descripcion, imagen_url, categoria,
            puntos_requeridos, puntos_acumulables, puntaje_al_comprar, tipo_producto,
            precio_dinero, precio_puntos, puntos_para_canjear, stock_disponible, stock_reservado,
            track_stock, permite_envio, permite_retiro_local
     FROM productos
     WHERE ${where}
     ORDER BY nombre ASC`,
    params
  );
  const rows = rowsRaw as Array<{
    id: number;
    nombre: string;
    descripcion: string | null;
    imagen_url: string | null;
    categoria: string | null;
    puntos_requeridos: number;
    puntos_acumulables: number | null;
    puntaje_al_comprar: number | null;
    tipo_producto: "canje" | "venta" | "mixto";
    precio_dinero: number | null;
    precio_puntos: number | null;
    puntos_para_canjear: number | null;
    stock_disponible: number;
    stock_reservado: number;
    track_stock: number;
    permite_envio: number;
    permite_retiro_local: number;
  }>;

  if (!rows.length) {
    res.json([]);
    return;
  }

  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => "?").join(", ");
  const [imgRowsRaw] = await pool.query(
    `SELECT producto_id, imagen_url, orden
     FROM producto_imagenes
     WHERE producto_id IN (${placeholders})
     ORDER BY producto_id ASC, orden ASC`,
    ids
  );
  const imgRows = imgRowsRaw as Array<{ producto_id: number; imagen_url: string; orden: number }>;

  const imageMap = new Map<number, string[]>();
  for (const image of imgRows) {
    const current = imageMap.get(image.producto_id) ?? [];
    current.push(image.imagen_url);
    imageMap.set(image.producto_id, current);
  }

  res.json(
    rows.map((row) => {
      const imagenesRaw = imageMap.get(row.id) ?? [];
      const imagenes = (imagenesRaw.length > 0 ? imagenesRaw : (row.imagen_url ? [row.imagen_url] : []))
        .map((url) => normalizeSafeImageUrl(url))
        .filter((url): url is string => Boolean(url))
        .slice(0, 3);
      return {
        ...row,
        imagenes,
        imagen_url: imagenes[0] ?? null,
        track_stock: Boolean(row.track_stock),
        permite_envio: Boolean(row.permite_envio),
        permite_retiro_local: Boolean(row.permite_retiro_local),
      };
    })
  );
});

// GET /productos/categorias — lista las categorías disponibles
router.get("/categorias", async (_req, res) => {
  const [rows] = await pool.query(
    "SELECT DISTINCT categoria FROM productos WHERE activo = 1 AND categoria IS NOT NULL ORDER BY categoria ASC"
  );
  const categorias = (rows as { categoria: string }[]).map(r => r.categoria);
  res.json(categorias);
});

export default router;
