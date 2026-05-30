import { Router } from "express";
import { pool } from "../db";
import { getAuthPayload } from "../auth";
import { createPricingResolver, getActiveClientePricingProfile } from "../services/customerPricing";
import { getPurchaseQuantityLimit } from "../services/purchaseLimits";
import { normalizeSafeImageUrl, normalizeSafeNavigationUrl } from "../urlSafety";

const router = Router();
const HOME_LOCATION_LINK_KEYS = [
  "home_ubicacion_imagen_1_link",
  "home_ubicacion_imagen_2_link",
  "home_ubicacion_imagen_3_link",
] as const;

const HOME_LOCATION_SRC_KEYS = [
  "home_ubicacion_imagen_1_src",
  "home_ubicacion_imagen_2_src",
  "home_ubicacion_imagen_3_src",
] as const;

function hasOwnProductImage(imagenUrl: string | null, imagenes: string[]): boolean {
  const image = imagenes.find(Boolean) || imagenUrl || "";
  return Boolean(image && !image.endsWith("/logo.png") && image !== "logo.png");
}

router.get("/home-layout-config", async (_req, res) => {
  try {
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    const allKeys = [...HOME_LOCATION_LINK_KEYS, ...HOME_LOCATION_SRC_KEYS];
    const placeholders = allKeys.map(() => "?").join(", ");
    const [rowsRaw] = await pool.query(
      `SELECT clave, valor
       FROM configuracion
       WHERE clave IN (${placeholders})`,
      allKeys,
    );
    const rows = rowsRaw as Array<{ clave: string; valor: string | null }>;
    
    // Normalize links, but do not normalize safe src if it's just a raw URL or path
    const byKey = new Map(rows.map((row) => [row.clave, row.valor]));

    res.json({
      location_image_links: HOME_LOCATION_LINK_KEYS.map((key) => normalizeSafeNavigationUrl(byKey.get(key) ?? null)),
      location_image_srcs: HOME_LOCATION_SRC_KEYS.map((key) => byKey.get(key) ?? null),
    });
  } catch (error) {
    console.error("Home layout config:", error);
    res.status(500).json({ error: "No se pudo cargar la configuracion del home." });
  }
});

router.get("/destacados", async (req, res) => {
  try {
    const rawLimit = Number(req.query.limit ?? 12);
    const limit = Number.isFinite(rawLimit) ? Math.min(24, Math.max(1, Math.floor(rawLimit))) : 12;
    const fetchLimit = Math.min(60, Math.max(limit * 3, limit));

    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");

    const [rowsRaw] = await pool.query(
      `SELECT id, nombre, descripcion, imagen_url, categoria,
            puntos_requeridos, puntos_acumulables, puntaje_al_comprar, tipo_producto,
            precio_dinero, precio_puntos, puntos_para_canjear, destacado_home, permite_envio, envio_gratis
     FROM productos
     WHERE activo = 1
       AND destacado_home = 1
       AND tipo_producto IN ('venta','mixto')
       AND (track_stock = 0 OR stock_disponible > 0)
     ORDER BY nombre ASC
     LIMIT ?`,
      [fetchLimit],
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
      tipo_producto: "venta" | "mixto";
      precio_dinero: number | null;
      precio_puntos: number | null;
      puntos_para_canjear: number | null;
      destacado_home: number;
      permite_envio: number;
      envio_gratis: number;
    }>;

    if (!rows.length) {
      res.json([]);
      return;
    }

    const auth = getAuthPayload(req);
    const pricingProfile = auth?.rol === "cliente"
      ? await getActiveClientePricingProfile(pool, auth.id)
      : null;
    const resolvePrice = await createPricingResolver(pool, { source: "web", profile: pricingProfile });
    const purchaseLimit = await getPurchaseQuantityLimit(pool, pricingProfile?.tipoCliente ?? "cliente");

    const ids = rows.map((row) => row.id);
    const placeholders = ids.map(() => "?").join(", ");
    const [imgRowsRaw] = await pool.query(
      `SELECT producto_id, imagen_url, orden
     FROM producto_imagenes
     WHERE producto_id IN (${placeholders})
     ORDER BY producto_id ASC, orden ASC`,
      ids,
    );
    const imgRows = imgRowsRaw as Array<{ producto_id: number; imagen_url: string; orden: number }>;

    const imageMap = new Map<number, string[]>();
    for (const image of imgRows) {
      const current = imageMap.get(image.producto_id) ?? [];
      current.push(image.imagen_url);
      imageMap.set(image.producto_id, current);
    }

    const destacados = rows
      .map((row) => {
        const imagenesRaw = imageMap.get(row.id) ?? [];
        const imagenes = (imagenesRaw.length > 0 ? imagenesRaw : (row.imagen_url ? [row.imagen_url] : []))
          .map((url) => normalizeSafeImageUrl(url))
          .filter((url): url is string => Boolean(url))
          .slice(0, 3);
        const pricing = resolvePrice({ precio_dinero: row.precio_dinero, categoria: row.categoria });

        return {
          id: row.id,
          nombre: row.nombre,
          descripcion: row.descripcion,
          imagen_url: imagenes[0] ?? null,
          imagenes,
          categoria: row.categoria,
          puntos_requeridos: row.puntos_requeridos,
          puntos_acumulables: row.puntos_acumulables,
          puntaje_al_comprar: row.puntaje_al_comprar,
          destacado_home: Boolean(row.destacado_home),
          tipo_producto: row.tipo_producto,
          precio_dinero: pricing.precioFinal,
          precio_dinero_original: pricing.precioLista,
          precio_dinero_lista: pricing.precioLista,
          descuento_porcentaje_aplicado: pricing.descuentoPorcentajeAplicado,
          tipo_cliente_precio: pricing.tipoCliente,
          precio_puntos: row.precio_puntos,
          puntos_para_canjear: row.puntos_para_canjear,
          permite_envio: Boolean(row.permite_envio),
          envio_gratis: Boolean(row.permite_envio) && Boolean(row.envio_gratis),
          limite_compra: purchaseLimit,
        };
      })
      .filter((producto) => hasOwnProductImage(producto.imagen_url, producto.imagenes))
      .slice(0, limit);

    res.json(destacados);
  } catch (error) {
    console.error("Productos destacados:", error);
    res.status(500).json({ error: "No se pudieron cargar los productos destacados." });
  }
});

// Catálogo público — no requiere autenticación
// Query params opcionales:
//   ?categoria=alfajores   → filtra por categoría (exacto, case-insensitive)
//   ?max_puntos=500        → filtra productos con puntos_requeridos <= N
router.get("/", async (req, res) => {
  const { categoria, max_puntos, modo } = req.query;
  const sucursalId = Number(req.query.sucursal_id ?? 0);
  const hasSucursalFilter = Number.isFinite(sucursalId) && sucursalId > 0;

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
            configuracion_tipo, capacidad_sabores,
            precio_dinero, precio_puntos, puntos_para_canjear, stock_disponible, stock_reservado,
            destacado_home,
            ${
              hasSucursalFilter
                ? "COALESCE((SELECT i.stock_disponible FROM inventario_sucursal i WHERE i.producto_id = productos.id AND i.sucursal_id = ? LIMIT 1), 0)"
                : "stock_disponible"
            } AS stock_disponible_sucursal,
            ${
              hasSucursalFilter
                ? "COALESCE((SELECT i.stock_reservado FROM inventario_sucursal i WHERE i.producto_id = productos.id AND i.sucursal_id = ? LIMIT 1), 0)"
                : "stock_reservado"
            } AS stock_reservado_sucursal,
            track_stock, permite_envio, envio_gratis, permite_retiro_local
     FROM productos
     WHERE ${where}
     ORDER BY nombre ASC`,
    hasSucursalFilter ? [sucursalId, sucursalId, ...params] : params
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
    destacado_home: number;
    tipo_producto: "canje" | "venta" | "mixto";
    configuracion_tipo: "simple" | "caja_sabores";
    capacidad_sabores: number | null;
    precio_dinero: number | null;
    precio_puntos: number | null;
    puntos_para_canjear: number | null;
    stock_disponible: number;
    stock_reservado: number;
    stock_disponible_sucursal: number;
    stock_reservado_sucursal: number;
    track_stock: number;
    permite_envio: number;
    envio_gratis: number;
    permite_retiro_local: number;
  }>;

  if (!rows.length) {
    res.json([]);
    return;
  }

  const auth = getAuthPayload(req);
  const pricingProfile = auth?.rol === "cliente"
    ? await getActiveClientePricingProfile(pool, auth.id)
    : null;
  const resolvePrice = await createPricingResolver(pool, { source: "web", profile: pricingProfile });
  const purchaseLimit = await getPurchaseQuantityLimit(pool, pricingProfile?.tipoCliente ?? "cliente");

  const allIds = rows.map((row) => row.id);
  const allPlaceholders = allIds.map(() => "?").join(", ");
  const [flavorRowsRaw] = await pool.query(
    `SELECT ps.producto_id, s.id, s.nombre, s.descripcion, s.activo,
            ${
              hasSucursalFilter
                ? "COALESCE((SELECT i.stock_disponible FROM inventario_sabor_sucursal i WHERE i.sabor_id = s.id AND i.sucursal_id = ? LIMIT 1), 0)"
                : "COALESCE((SELECT SUM(i.stock_disponible) FROM inventario_sabor_sucursal i JOIN sucursales suc ON suc.id = i.sucursal_id AND suc.activo = 1 WHERE i.sabor_id = s.id), 0)"
            } AS stock_disponible,
            ${
              hasSucursalFilter
                ? "COALESCE((SELECT i.stock_reservado FROM inventario_sabor_sucursal i WHERE i.sabor_id = s.id AND i.sucursal_id = ? LIMIT 1), 0)"
                : "COALESCE((SELECT SUM(i.stock_reservado) FROM inventario_sabor_sucursal i JOIN sucursales suc ON suc.id = i.sucursal_id AND suc.activo = 1 WHERE i.sabor_id = s.id), 0)"
            } AS stock_reservado
     FROM producto_sabores ps
     JOIN sabores s ON s.id = ps.sabor_id
     WHERE ps.producto_id IN (${allPlaceholders}) AND ps.activo = 1 AND s.activo = 1
     ORDER BY ps.producto_id ASC, ps.orden ASC, s.nombre ASC`,
    hasSucursalFilter ? [sucursalId, sucursalId, ...allIds] : allIds
  );
  const flavorRows = flavorRowsRaw as Array<{
    producto_id: number;
    id: number;
    nombre: string;
    descripcion: string | null;
    activo: number;
    stock_disponible: number;
    stock_reservado: number;
  }>;

  const flavorMap = new Map<number, typeof flavorRows>();
  for (const flavor of flavorRows) {
    const current = flavorMap.get(flavor.producto_id) ?? [];
    current.push(flavor);
    flavorMap.set(flavor.producto_id, current);
  }

  const visibleRows = rows.filter((row) => {
    if (row.configuracion_tipo === "caja_sabores") {
      const capacity = Number(row.capacidad_sabores ?? 0);
      const available = (flavorMap.get(row.id) ?? []).reduce(
        (acc, item) => acc + Math.max(0, Number(item.stock_disponible ?? 0)),
        0,
      );
      return capacity > 0 && available >= capacity;
    }
    const stockSucursal = Number(row.stock_disponible_sucursal ?? row.stock_disponible ?? 0);
    return !Boolean(row.track_stock) || stockSucursal > 0;
  });

  if (!visibleRows.length) {
    res.json([]);
    return;
  }

  const ids = visibleRows.map((row) => row.id);
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

  const [inventoryRowsRaw] = await pool.query(
    `SELECT i.producto_id, i.sucursal_id, s.nombre AS sucursal_nombre,
            i.stock_disponible, i.stock_reservado
     FROM inventario_sucursal i
     JOIN sucursales s ON s.id = i.sucursal_id
     WHERE i.producto_id IN (${placeholders}) AND s.activo = 1
     ORDER BY i.producto_id ASC, s.nombre ASC, s.id ASC`,
    ids
  );
  const inventoryRows = inventoryRowsRaw as Array<{
    producto_id: number;
    sucursal_id: number;
    sucursal_nombre: string;
    stock_disponible: number;
    stock_reservado: number;
  }>;

  const inventoryMap = new Map<number, typeof inventoryRows>();
  for (const inventory of inventoryRows) {
    const current = inventoryMap.get(inventory.producto_id) ?? [];
    current.push(inventory);
    inventoryMap.set(inventory.producto_id, current);
  }

  res.json(
    visibleRows.map((row) => {
      const imagenesRaw = imageMap.get(row.id) ?? [];
      const imagenes = (imagenesRaw.length > 0 ? imagenesRaw : (row.imagen_url ? [row.imagen_url] : []))
        .map((url) => normalizeSafeImageUrl(url))
        .filter((url): url is string => Boolean(url))
        .slice(0, 3);
      const stockSucursal = Number(row.stock_disponible_sucursal ?? row.stock_disponible ?? 0);
      const stockReservadoSucursal = Number(row.stock_reservado_sucursal ?? row.stock_reservado ?? 0);
      const hasStock = !Boolean(row.track_stock) || stockSucursal > 0;
      const pricing = resolvePrice({ precio_dinero: row.precio_dinero, categoria: row.categoria });
      return {
        id: row.id,
        nombre: row.nombre,
        descripcion: row.descripcion,
        imagen_url: imagenes[0] ?? null,
        categoria: row.categoria,
        puntos_requeridos: row.puntos_requeridos,
        puntos_acumulables: row.puntos_acumulables,
        puntaje_al_comprar: row.puntaje_al_comprar,
        destacado_home: Boolean(row.destacado_home),
        tipo_producto: row.tipo_producto,
        configuracion_tipo: row.configuracion_tipo,
        capacidad_sabores: row.capacidad_sabores === null ? null : Number(row.capacidad_sabores),
        precio_dinero: pricing.precioFinal,
        precio_dinero_original: pricing.precioLista,
        precio_dinero_lista: pricing.precioLista,
        descuento_porcentaje_aplicado: pricing.descuentoPorcentajeAplicado,
        tipo_cliente_precio: pricing.tipoCliente,
        precio_puntos: row.precio_puntos,
        puntos_para_canjear: row.puntos_para_canjear,
        stock_disponible: stockSucursal,
        stock_reservado: stockReservadoSucursal,
        stock_total_disponible: Number(row.stock_disponible ?? 0),
        stock_total_reservado: Number(row.stock_reservado ?? 0),
        stock_sucursal_id: hasSucursalFilter ? sucursalId : null,
        inventario_sucursales: (inventoryMap.get(row.id) ?? []).map((item) => ({
          sucursal_id: Number(item.sucursal_id),
          sucursal_nombre: item.sucursal_nombre,
          stock_disponible: Number(item.stock_disponible ?? 0),
          stock_reservado: Number(item.stock_reservado ?? 0),
        })),
        sabores_disponibles: (flavorMap.get(row.id) ?? []).map((item) => ({
          id: Number(item.id),
          nombre: item.nombre,
          descripcion: item.descripcion ?? null,
          activo: Boolean(item.activo),
          stock_disponible: Number(item.stock_disponible ?? 0),
          stock_reservado: Number(item.stock_reservado ?? 0),
        })),
        imagenes,
        track_stock: Boolean(row.track_stock),
        permite_envio: Boolean(row.permite_envio),
        envio_gratis: Boolean(row.permite_envio) && Boolean(row.envio_gratis),
        permite_retiro_local: Boolean(row.permite_retiro_local),
        limite_compra: purchaseLimit,
      };
    })
  );
});

// GET /productos/categorias — lista las categorías disponibles
router.get("/sucursales", async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT id, nombre, direccion, piso, localidad, provincia
     FROM sucursales
     WHERE activo = 1
     ORDER BY nombre ASC, id ASC`
  );
  res.json(rows);
});

router.get("/categorias", async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT DISTINCT p.categoria
     FROM productos p
     LEFT JOIN categorias c ON LOWER(c.nombre) = LOWER(p.categoria)
     WHERE p.activo = 1
       AND p.categoria IS NOT NULL
       AND (c.id IS NULL OR c.activo = 1)
     ORDER BY p.categoria ASC`
  );
  const categorias = (rows as { categoria: string }[]).map(r => r.categoria);
  res.json(categorias);
});

export default router;
