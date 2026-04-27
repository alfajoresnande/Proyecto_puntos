import crypto from "crypto";
import { Router } from "express";
import { z } from "zod";
import { pool, qOne, qAll, qRun, type Queryable } from "../db";
import { requireAuth, requireRole } from "../auth";

const router = Router();
router.use(requireAuth, requireRole("cliente"));

type PerfilCanje = {
  id: number;
  nombre: string | null;
  email: string | null;
  dni: string | null;
  telefono?: string | null;
  codigo_invitacion?: string | null;
  referido_por?: number | null;
  puntos_saldo?: number;
};

type ReferralConfig = {
  inv: number | null;
  nuev: number | null;
};

type SucursalRetiro = {
  id: number;
  nombre: string;
  direccion: string;
  piso: string | null;
  localidad: string;
  provincia: string;
};

type CanjeItemInput = {
  producto_id: number;
  cantidad: number;
};

type CanjeItemDetalle = {
  producto_id: number;
  producto_nombre: string;
  producto_imagen: string | null;
  cantidad: number;
  puntos_unitarios: number;
  puntos_total: number;
};

type CanjeProductoDB = {
  id: number;
  nombre: string;
  puntos_requeridos: number;
  imagen_url: string | null;
};

type ClienteCanjeRow = {
  id: number;
  codigo_retiro: string | null;
  puntos_usados: number;
  estado: "pendiente" | "entregado" | "no_disponible" | "expirado" | "cancelado";
  fecha_limite_retiro: string | null;
  notas: string | null;
  created_at: string;
  producto_nombre: string;
  producto_imagen: string | null;
  sucursal_id: number | null;
  sucursal_nombre: string | null;
  sucursal_direccion: string | null;
  sucursal_piso: string | null;
  sucursal_localidad: string | null;
  sucursal_provincia: string | null;
};

class HttpError extends Error {
  status: number;
  errorCode?: string;

  constructor(status: number, message: string, errorCode?: string) {
    super(message);
    this.status = status;
    this.errorCode = errorCode;
  }
}

const DEFAULT_INVITE_CODE_LENGTH = 9;
const MIN_INVITE_CODE_LENGTH = 6;
const MAX_INVITE_CODE_LENGTH = 20;
const REDEEM_CODE_LENGTH = 9;
const REDEEM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeRedeemCode(length = REDEEM_CODE_LENGTH): string {
  return Array.from({ length }, () => REDEEM_CODE_CHARS[crypto.randomInt(REDEEM_CODE_CHARS.length)]).join("");
}

async function uniqueRedeemCode(conn: Queryable, length = REDEEM_CODE_LENGTH): Promise<string> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const code = makeRedeemCode(length);
    const exists = await qOne<{ id: number }>(conn, "SELECT id FROM canjes WHERE codigo_retiro = ? LIMIT 1", [code]);
    if (!exists) return code;
  }
  throw new Error("No se pudo generar un codigo de canje unico");
}

function profileMissingFields(perfil?: PerfilCanje): string[] {
  if (!perfil) return ["nombre", "email", "dni"];
  const missing: string[] = [];
  if (!perfil.nombre || !perfil.nombre.trim()) missing.push("nombre");
  if (!perfil.email || !perfil.email.includes("@")) missing.push("email");
  if (!perfil.dni || perfil.dni.trim().length < 6) missing.push("dni");
  return missing;
}

async function validateProfileForRedeem(usuarioId: number): Promise<string[]> {
  const perfil = await qOne<PerfilCanje>(pool,
    "SELECT id, nombre, email, dni FROM usuarios WHERE id = ?",
    [usuarioId]
  );
  return profileMissingFields(perfil);
}

async function getReferralPointsConfig(conn: Queryable): Promise<{ pointsInvitador: number; pointsInvitado: number }> {
  const cfg = await qOne<ReferralConfig>(conn,
    `SELECT
       MAX(CASE WHEN clave = 'puntos_referido_invitador' THEN CAST(valor AS UNSIGNED) END) AS inv,
       MAX(CASE WHEN clave = 'puntos_referido_invitado' THEN CAST(valor AS UNSIGNED) END) AS nuev
     FROM configuracion
     WHERE clave IN ('puntos_referido_invitador', 'puntos_referido_invitado')`
  );

  return {
    pointsInvitador: Number(cfg?.inv ?? 50),
    pointsInvitado: Number(cfg?.nuev ?? 30),
  };
}

async function getInviteCodeLength(conn: Queryable = pool): Promise<number> {
  const row = await qOne<{ valor: string }>(conn, "SELECT valor FROM configuracion WHERE clave = 'longitud_codigo_invitacion' LIMIT 1");
  const parsed = Number(row?.valor ?? DEFAULT_INVITE_CODE_LENGTH);
  if (!Number.isInteger(parsed)) return DEFAULT_INVITE_CODE_LENGTH;
  return Math.max(MIN_INVITE_CODE_LENGTH, Math.min(MAX_INVITE_CODE_LENGTH, parsed));
}

function isValidInviteCode(code: string, length: number): boolean {
  return new RegExp(`^[A-Z0-9]{${length}}$`).test(code);
}

function normalizeCanjeItems(items: CanjeItemInput[]): CanjeItemInput[] {
  const grouped = new Map<number, number>();
  for (const item of items) {
    const productoId = Number(item.producto_id);
    const cantidad = Number(item.cantidad);
    if (!Number.isInteger(productoId) || productoId <= 0) continue;
    if (!Number.isInteger(cantidad) || cantidad <= 0) continue;
    grouped.set(productoId, (grouped.get(productoId) ?? 0) + cantidad);
  }

  return Array.from(grouped.entries()).map(([producto_id, cantidad]) => ({ producto_id, cantidad }));
}

function buildLugarRetiro(sucursal: SucursalRetiro): string {
  return `${sucursal.nombre} - ${sucursal.direccion}${
    sucursal.piso ? `, Piso ${sucursal.piso}` : ""
  }, ${sucursal.localidad}, ${sucursal.provincia}`;
}

async function getCanjeItemsByCanjeIds(conn: Queryable, canjeIds: number[]): Promise<Map<number, CanjeItemDetalle[]>> {
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
    conn,
    `SELECT ci.canje_id, ci.producto_id, p.nombre AS producto_nombre, p.imagen_url AS producto_imagen,
            ci.cantidad, ci.puntos_unitarios, ci.puntos_total
     FROM canje_items ci
     JOIN productos p ON p.id = ci.producto_id
     WHERE ci.canje_id IN (${placeholders})
     ORDER BY ci.canje_id ASC, ci.id ASC`,
    canjeIds,
  );

  for (const row of rows) {
    const current = map.get(row.canje_id) ?? [];
    current.push({
      producto_id: Number(row.producto_id),
      producto_nombre: row.producto_nombre,
      producto_imagen: row.producto_imagen ?? null,
      cantidad: Number(row.cantidad),
      puntos_unitarios: Number(row.puntos_unitarios),
      puntos_total: Number(row.puntos_total),
    });
    map.set(row.canje_id, current);
  }

  return map;
}

async function crearCanjeCarrito(
  conn: Queryable,
  {
    usuarioId,
    items,
    sucursalId,
  }: {
    usuarioId: number;
    items: CanjeItemInput[];
    sucursalId?: number | null;
  },
) {
  const itemsNormalizados = normalizeCanjeItems(items);
  if (!itemsNormalizados.length) {
    throw new HttpError(400, "Debes agregar al menos un producto al carrito.");
  }

  const productoIds = itemsNormalizados.map((item) => item.producto_id);
  const placeholders = productoIds.map(() => "?").join(", ");
  const productos = await qAll<CanjeProductoDB>(
    conn,
    `SELECT id, nombre, puntos_requeridos, imagen_url
     FROM productos
     WHERE activo = 1 AND id IN (${placeholders})`,
    productoIds,
  );

  const productosMap = new Map<number, CanjeProductoDB>();
  for (const producto of productos) {
    productosMap.set(Number(producto.id), {
      id: Number(producto.id),
      nombre: producto.nombre,
      puntos_requeridos: Number(producto.puntos_requeridos),
      imagen_url: producto.imagen_url ?? null,
    });
  }

  const faltantes = productoIds.filter((id) => !productosMap.has(id));
  if (faltantes.length > 0) {
    throw new HttpError(400, "Algunos productos del carrito no existen o estan inactivos.");
  }

  const itemsDetalle: CanjeItemDetalle[] = [];
  let puntosTotales = 0;
  for (const item of itemsNormalizados) {
    const producto = productosMap.get(item.producto_id);
    if (!producto) {
      throw new HttpError(400, "No se pudo validar el carrito de canje.");
    }
    const puntosUnitarios = Number(producto.puntos_requeridos);
    const puntosTotal = puntosUnitarios * item.cantidad;
    puntosTotales += puntosTotal;
    itemsDetalle.push({
      producto_id: item.producto_id,
      producto_nombre: producto.nombre,
      producto_imagen: producto.imagen_url ?? null,
      cantidad: item.cantidad,
      puntos_unitarios: puntosUnitarios,
      puntos_total: puntosTotal,
    });
  }

  if (puntosTotales <= 0) {
    throw new HttpError(400, "El carrito no tiene productos validos para canjear.");
  }

  const usuario = await qOne<{ puntos_saldo: number }>(
    conn,
    "SELECT puntos_saldo FROM usuarios WHERE id = ? FOR UPDATE",
    [usuarioId],
  );
  const saldo = Number(usuario?.puntos_saldo ?? 0);
  if (saldo < puntosTotales) {
    throw new HttpError(400, `Puntos insuficientes. Tenes ${saldo}, necesitas ${puntosTotales}`);
  }

  const diasRow = await qOne<{ valor: string }>(conn, "SELECT valor FROM configuracion WHERE clave = 'dias_limite_retiro'");
  const dias = Number.parseInt(diasRow?.valor ?? "7", 10);
  const diasLimite = Number.isFinite(dias) && dias > 0 ? dias : 7;

  const sucursalesActivas = await qAll<SucursalRetiro>(
    conn,
    `SELECT id, nombre, direccion, piso, localidad, provincia
     FROM sucursales
     WHERE activo = 1
     ORDER BY nombre ASC, id ASC`,
  );
  if (sucursalesActivas.length === 0) {
    throw new HttpError(400, "No hay sucursales de retiro disponibles. Contacta a la administracion.");
  }

  let sucursalSeleccionada: SucursalRetiro | undefined;
  if (sucursalId && Number.isFinite(sucursalId)) {
    sucursalSeleccionada = sucursalesActivas.find((item) => item.id === Number(sucursalId));
    if (!sucursalSeleccionada) {
      throw new HttpError(400, "La sucursal seleccionada no esta disponible.");
    }
  } else if (sucursalesActivas.length === 1) {
    sucursalSeleccionada = sucursalesActivas[0];
  } else {
    throw new HttpError(400, "Debes seleccionar una sucursal para retirar el producto.");
  }

  const fechaLimite = new Date();
  fechaLimite.setDate(fechaLimite.getDate() + diasLimite);
  const codigoRetiro = await uniqueRedeemCode(conn);
  const productoPrincipalId = itemsDetalle[0].producto_id;

  const { insertId: canjeId } = await qRun(
    conn,
    `INSERT INTO canjes (usuario_id, producto_id, sucursal_id, codigo_retiro, puntos_usados, estado, fecha_limite_retiro)
     VALUES (?, ?, ?, ?, ?, 'pendiente', ?)`,
    [usuarioId, productoPrincipalId, sucursalSeleccionada.id, codigoRetiro, puntosTotales, fechaLimite],
  );

  for (const item of itemsDetalle) {
    await qRun(
      conn,
      `INSERT INTO canje_items (canje_id, producto_id, cantidad, puntos_unitarios, puntos_total)
       VALUES (?, ?, ?, ?, ?)`,
      [canjeId, item.producto_id, item.cantidad, item.puntos_unitarios, item.puntos_total],
    );
  }

  const descripcionItems = itemsDetalle.map((item) => `${item.producto_nombre} x${item.cantidad}`).join(", ");
  const descripcionMovimiento =
    descripcionItems.length > 210 ? `Canje carrito: ${descripcionItems.slice(0, 207)}...` : `Canje carrito: ${descripcionItems}`;

  await qRun(
    conn,
    `INSERT INTO movimientos_puntos (usuario_id, tipo, puntos, descripcion, referencia_id, referencia_tipo)
     VALUES (?, 'canje_producto', ?, ?, ?, 'canjes')`,
    [usuarioId, -puntosTotales, descripcionMovimiento, canjeId],
  );
  await qRun(conn, "UPDATE usuarios SET puntos_saldo = puntos_saldo - ? WHERE id = ?", [puntosTotales, usuarioId]);

  const totalUnidades = itemsDetalle.reduce((acc, item) => acc + item.cantidad, 0);

  return {
    ok: true,
    canje_id: canjeId,
    canje_codigo: codigoRetiro,
    codigo_retiro: codigoRetiro,
    puntos_usados: puntosTotales,
    nuevo_saldo: saldo - puntosTotales,
    dias_limite_retiro: diasLimite,
    fecha_limite_retiro: fechaLimite,
    sucursal_id: sucursalSeleccionada.id,
    sucursal: sucursalSeleccionada,
    lugar_retiro: buildLugarRetiro(sucursalSeleccionada),
    total_items: itemsDetalle.length,
    total_unidades: totalUnidades,
    items: itemsDetalle,
  };
}

router.get("/me", async (req, res) => {
  const user = await qOne(pool,
    "SELECT id, nombre, email, dni, telefono, puntos_saldo, codigo_invitacion, referido_por FROM usuarios WHERE id = ?",
    [req.user!.id]
  );
  res.json(user);
});

router.patch("/perfil", async (req, res) => {
  const schema = z.object({
    nombre: z.string().min(1).max(100).optional(),
    dni: z.string().regex(/^\d{6,15}$/, "El DNI debe contener solo numeros (6 a 15 digitos)").optional(),
    telefono: z.string().regex(/^[0-9+\-()\s]{7,25}$/, "Telefono invalido").optional(),
  }).refine((value) => value.nombre !== undefined || value.dni !== undefined || value.telefono !== undefined, {
    message: "Debes enviar al menos un campo para actualizar",
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const { nombre, dni, telefono } = parsed.data;
  const usuarioId = req.user!.id;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const current = await qOne<{ id: number; rol: string }>(
      conn,
      "SELECT id, rol FROM usuarios WHERE id = ? FOR UPDATE",
      [usuarioId]
    );
    if (!current) {
      await conn.rollback();
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }

    if (dni !== undefined && current.rol !== "cliente") {
      await conn.rollback();
      res.status(400).json({ error: "Solo los clientes pueden actualizar DNI" });
      return;
    }

    if (dni !== undefined) {
      const dniDup = await qOne<{ id: number }>(
        conn,
        "SELECT id FROM usuarios WHERE dni = ? AND id <> ? LIMIT 1",
        [dni, usuarioId]
      );
      if (dniDup) {
        await conn.rollback();
        res.status(409).json({ error: "El DNI ya esta en uso por otro usuario" });
        return;
      }
    }

    await qRun(
      conn,
      `UPDATE usuarios
       SET nombre = COALESCE(?, nombre),
           dni = COALESCE(?, dni),
           telefono = COALESCE(?, telefono)
       WHERE id = ?`,
      [nombre ?? null, dni ?? null, telefono ?? null, usuarioId]
    );

    const updated = await qOne(
      conn,
      "SELECT id, nombre, email, rol, dni, telefono, puntos_saldo, codigo_invitacion, referido_por FROM usuarios WHERE id = ?",
      [usuarioId]
    );

    await conn.commit();
    res.json({ ok: true, user: updated });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

router.post("/usar-codigo-invitacion", async (req, res) => {
  const schema = z.object({ codigo: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Codigo de invitacion requerido" });
    return;
  }

  const usuarioId = req.user!.id;
  const codigo = parsed.data.codigo.trim().toUpperCase();
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();
    const longitudCodigo = await getInviteCodeLength(conn);
    if (!isValidInviteCode(codigo, longitudCodigo)) {
      await conn.rollback();
      res.status(400).json({ error: `El codigo de invitacion debe tener ${longitudCodigo} caracteres alfanumericos` });
      return;
    }

    const usuario = await qOne<PerfilCanje>(
      conn,
      "SELECT id, nombre, referido_por, codigo_invitacion FROM usuarios WHERE id = ? FOR UPDATE",
      [usuarioId]
    );
    if (!usuario) {
      await conn.rollback();
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }

    if (usuario.referido_por) {
      await conn.rollback();
      res.status(400).json({ error: "Ya usaste un codigo de invitacion anteriormente" });
      return;
    }

    if (usuario.codigo_invitacion && usuario.codigo_invitacion.toUpperCase() === codigo) {
      await conn.rollback();
      res.status(400).json({ error: "No puedes usar tu propio codigo de invitacion" });
      return;
    }

    const invitador = await qOne<{ id: number; nombre: string }>(
      conn,
      `SELECT id, nombre
       FROM usuarios
       WHERE codigo_invitacion = ? AND rol = 'cliente' AND activo = 1
       LIMIT 1
       FOR UPDATE`,
      [codigo]
    );
    if (!invitador) {
      await conn.rollback();
      res.status(404).json({ error: "Codigo de invitacion invalido" });
      return;
    }

    if (invitador.id === usuarioId) {
      await conn.rollback();
      res.status(400).json({ error: "No puedes usar tu propio codigo de invitacion" });
      return;
    }

    const relationExists = await qOne<{ id: number }>(
      conn,
      "SELECT id FROM referidos WHERE invitado_id = ? LIMIT 1",
      [usuarioId]
    );
    if (relationExists) {
      await conn.rollback();
      res.status(400).json({ error: "Ya usaste un codigo de invitacion anteriormente" });
      return;
    }

    const { pointsInvitador, pointsInvitado } = await getReferralPointsConfig(conn);

    const { insertId: refId } = await qRun(
      conn,
      `INSERT INTO referidos (invitador_id, invitado_id, puntos_invitador, puntos_invitado)
       VALUES (?, ?, ?, ?)`,
      [invitador.id, usuarioId, pointsInvitador, pointsInvitado]
    );

    const updateRef = await qRun(
      conn,
      "UPDATE usuarios SET referido_por = ? WHERE id = ? AND referido_por IS NULL",
      [invitador.id, usuarioId]
    );
    if (updateRef.affectedRows === 0) {
      await conn.rollback();
      res.status(400).json({ error: "Ya usaste un codigo de invitacion anteriormente" });
      return;
    }

    await qRun(conn,
      `INSERT INTO movimientos_puntos (usuario_id, tipo, puntos, descripcion, referencia_id, referencia_tipo)
       VALUES (?, 'referido_invitador', ?, ?, ?, 'referidos')`,
      [invitador.id, pointsInvitador, `${usuario.nombre || "Un cliente"} uso tu codigo de invitacion`, refId]
    );

    await qRun(conn,
      `INSERT INTO movimientos_puntos (usuario_id, tipo, puntos, descripcion, referencia_id, referencia_tipo)
       VALUES (?, 'referido_invitado', ?, ?, ?, 'referidos')`,
      [usuarioId, pointsInvitado, `Bono por usar el codigo de ${invitador.nombre}`, refId]
    );

    await qRun(conn, "UPDATE usuarios SET puntos_saldo = puntos_saldo + ? WHERE id = ?", [pointsInvitador, invitador.id]);
    await qRun(conn, "UPDATE usuarios SET puntos_saldo = puntos_saldo + ? WHERE id = ?", [pointsInvitado, usuarioId]);

    await conn.commit();

    const updated = await qOne<{ puntos_saldo: number }>(
      pool,
      "SELECT puntos_saldo FROM usuarios WHERE id = ?",
      [usuarioId]
    );

    res.json({
      ok: true,
      invitador: invitador.nombre,
      puntos_ganados: pointsInvitado,
      nuevo_saldo: updated?.puntos_saldo ?? 0,
    });
  } catch (err: unknown) {
    await conn.rollback();
    const dbErr = err as { code?: string };
    if (dbErr.code === "ER_DUP_ENTRY") {
      res.status(400).json({ error: "Ya usaste un codigo de invitacion anteriormente" });
      return;
    }
    throw err;
  } finally {
    conn.release();
  }
});

router.get("/mi-codigo", async (req, res) => {
  const user = await qOne(pool, "SELECT codigo_invitacion FROM usuarios WHERE id = ?", [req.user!.id]);
  const total = await qOne(pool, "SELECT COUNT(*) AS c FROM referidos WHERE invitador_id = ?", [req.user!.id]);
  res.json({ codigo: user?.codigo_invitacion, total_invitados: total?.c ?? 0 });
});

router.get("/movimientos", async (req, res) => {
  const rows = await qAll(pool,
    `SELECT id, tipo, puntos, descripcion, referencia_tipo, created_at
     FROM movimientos_puntos WHERE usuario_id = ?
     ORDER BY created_at DESC LIMIT 100`,
    [req.user!.id]
  );
  res.json(rows);
});

router.get("/canjes", async (req, res) => {
  const rows = await qAll<ClienteCanjeRow>(pool,
    `SELECT c.id, c.codigo_retiro, c.puntos_usados, c.estado, c.fecha_limite_retiro, c.notas, c.created_at,
            p.nombre AS producto_nombre, p.imagen_url AS producto_imagen,
            s.id AS sucursal_id, s.nombre AS sucursal_nombre, s.direccion AS sucursal_direccion,
            s.piso AS sucursal_piso, s.localidad AS sucursal_localidad, s.provincia AS sucursal_provincia
     FROM canjes c
     JOIN productos p ON p.id = c.producto_id
     LEFT JOIN sucursales s ON s.id = c.sucursal_id
     WHERE c.usuario_id = ? ORDER BY c.created_at DESC`,
    [req.user!.id]
  );
  if (!rows.length) {
    res.json([]);
    return;
  }

  const itemsMap = await getCanjeItemsByCanjeIds(pool, rows.map((row) => Number(row.id)));

  const payload = rows.map((row) => {
    const fallbackItem: CanjeItemDetalle = {
      producto_id: 0,
      producto_nombre: row.producto_nombre,
      producto_imagen: row.producto_imagen ?? null,
      cantidad: 1,
      puntos_unitarios: Number(row.puntos_usados),
      puntos_total: Number(row.puntos_usados),
    };
    const items = itemsMap.get(Number(row.id)) ?? [fallbackItem];
    const totalUnidades = items.reduce((acc, item) => acc + Number(item.cantidad), 0);
    const productosDetalle = items.map((item) => `${item.producto_nombre} x${item.cantidad}`).join(" | ");
    const primerItem = items[0];
    const productoNombreVista =
      items.length > 1 ? `${primerItem.producto_nombre} +${items.length - 1} mas` : primerItem.producto_nombre;

    return {
      ...row,
      producto_nombre: productoNombreVista,
      producto_imagen: primerItem.producto_imagen ?? row.producto_imagen ?? null,
      items,
      total_items: items.length,
      total_unidades: totalUnidades,
      productos_detalle: productosDetalle,
    };
  });

  res.json(payload);
});

router.get("/sucursales", async (_req, res) => {
  const rows = await qAll<SucursalRetiro>(
    pool,
    `SELECT id, nombre, direccion, piso, localidad, provincia
     FROM sucursales
     WHERE activo = 1
     ORDER BY nombre ASC, id ASC`,
  );
  res.json(rows);
});

router.post("/canjear-codigo", async (req, res) => {
  const schema = z.object({ codigo: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Codigo requerido" }); return; }

  const codigo = parsed.data.codigo.toUpperCase().trim();
  const usuarioId = req.user!.id;

  const faltantes = await validateProfileForRedeem(usuarioId);
  if (faltantes.length > 0) {
    res.status(400).json({
      error: `Completa tus datos obligatorios antes de canjear: ${faltantes.join(", ")}`,
      error_code: "PERFIL_INCOMPLETO",
    });
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const c = await qOne(conn,
      "SELECT id, puntos_valor, usos_maximos, usos_actuales, fecha_expiracion, activo FROM codigos_puntos WHERE codigo = ?",
      [codigo]
    );
    if (!c) { await conn.rollback(); res.status(404).json({ error: "Codigo no encontrado" }); return; }
    if (!c.activo) { await conn.rollback(); res.status(400).json({ error: "Codigo inactivo" }); return; }
    if (c.fecha_expiracion && new Date(c.fecha_expiracion) < new Date()) {
      await conn.rollback();
      res.status(400).json({ error: "El codigo expiro" });
      return;
    }
    if (c.usos_maximos > 0 && c.usos_actuales >= c.usos_maximos) {
      await conn.rollback();
      res.status(400).json({ error: "El codigo ya alcanzo su limite de usos" });
      return;
    }

    const yaUsado = await qOne(conn,
      "SELECT id FROM usos_codigos WHERE codigo_id = ? AND usuario_id = ?",
      [c.id, usuarioId]
    );
    if (yaUsado) { await conn.rollback(); res.status(400).json({ error: "Ya usaste este codigo" }); return; }

    await qRun(conn, "INSERT INTO usos_codigos (codigo_id, usuario_id) VALUES (?, ?)", [c.id, usuarioId]);
    await qRun(conn, "UPDATE codigos_puntos SET usos_actuales = usos_actuales + 1 WHERE id = ?", [c.id]);
    await qRun(conn,
      `INSERT INTO movimientos_puntos (usuario_id, tipo, puntos, descripcion, referencia_id, referencia_tipo)
       VALUES (?, 'codigo_canje', ?, ?, ?, 'codigos_puntos')`,
      [usuarioId, c.puntos_valor, `Codigo canjeado: ${codigo}`, c.id]
    );
    await qRun(conn, "UPDATE usuarios SET puntos_saldo = puntos_saldo + ? WHERE id = ?", [c.puntos_valor, usuarioId]);

    await conn.commit();

    const updated = await qOne(pool, "SELECT puntos_saldo FROM usuarios WHERE id = ?", [usuarioId]);
    res.json({ ok: true, puntos_ganados: c.puntos_valor, nuevo_saldo: updated?.puntos_saldo });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

router.post("/canjear-carrito", async (req, res) => {
  const schema = z.object({
    items: z.array(
      z.object({
        producto_id: z.number().int().positive(),
        cantidad: z.number().int().positive().max(100),
      }),
    ).min(1).max(40),
    sucursal_id: z.number().int().positive().optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message || "Carrito de canje invalido" });
    return;
  }

  const { items, sucursal_id } = parsed.data;
  const usuarioId = req.user!.id;

  const faltantes = await validateProfileForRedeem(usuarioId);
  if (faltantes.length > 0) {
    res.status(400).json({
      error: `Completa tus datos obligatorios antes de canjear: ${faltantes.join(", ")}`,
      error_code: "PERFIL_INCOMPLETO",
    });
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await crearCanjeCarrito(conn, {
      usuarioId,
      items,
      sucursalId: sucursal_id,
    });

    await conn.commit();
    res.status(201).json(result);
  } catch (err: unknown) {
    await conn.rollback();
    if (err instanceof HttpError) {
      res.status(err.status).json({
        error: err.message,
        ...(err.errorCode ? { error_code: err.errorCode } : {}),
      });
      return;
    }
    throw err;
  } finally {
    conn.release();
  }
});

router.post("/canjear-producto", async (req, res) => {
  const schema = z.object({
    producto_id: z.number().int().positive(),
    sucursal_id: z.number().int().positive().optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "producto_id requerido" });
    return;
  }

  const { producto_id, sucursal_id } = parsed.data;
  const usuarioId = req.user!.id;

  const faltantes = await validateProfileForRedeem(usuarioId);
  if (faltantes.length > 0) {
    res.status(400).json({
      error: `Completa tus datos obligatorios antes de canjear: ${faltantes.join(", ")}`,
      error_code: "PERFIL_INCOMPLETO",
    });
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await crearCanjeCarrito(conn, {
      usuarioId,
      items: [{ producto_id, cantidad: 1 }],
      sucursalId: sucursal_id,
    });
    await conn.commit();
    res.status(201).json(result);
  } catch (err: unknown) {
    await conn.rollback();
    if (err instanceof HttpError) {
      res.status(err.status).json({
        error: err.message,
        ...(err.errorCode ? { error_code: err.errorCode } : {}),
      });
      return;
    }
    throw err;
  } finally {
    conn.release();
  }
});

export default router;
