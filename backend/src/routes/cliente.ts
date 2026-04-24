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

const DEFAULT_INVITE_CODE_LENGTH = 9;
const MIN_INVITE_CODE_LENGTH = 6;
const MAX_INVITE_CODE_LENGTH = 20;
const REDEEM_CODE_LENGTH = 9;
const REDEEM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeRedeemCode(length = REDEEM_CODE_LENGTH): string {
  return Array.from({ length }, () => REDEEM_CODE_CHARS[Math.floor(Math.random() * REDEEM_CODE_CHARS.length)]).join("");
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
  const rows = await qAll(pool,
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
  res.json(rows);
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

router.post("/canjear-producto", async (req, res) => {
  const schema = z.object({
    producto_id: z.number().int().positive(),
    sucursal_id: z.number().int().positive().optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "producto_id requerido" }); return; }

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

    const prod = await qOne(conn,
      "SELECT id, nombre, puntos_requeridos FROM productos WHERE id = ? AND activo = 1",
      [producto_id]
    );
    if (!prod) { await conn.rollback(); res.status(404).json({ error: "Producto no encontrado o inactivo" }); return; }

    const userRow = await qOne(conn, "SELECT puntos_saldo FROM usuarios WHERE id = ?", [usuarioId]);
    const saldo = userRow?.puntos_saldo ?? 0;
    if (saldo < prod.puntos_requeridos) {
      await conn.rollback();
      res.status(400).json({ error: `Puntos insuficientes. Tenes ${saldo}, necesitas ${prod.puntos_requeridos}` });
      return;
    }

    const diasRow = await qOne(conn, "SELECT valor FROM configuracion WHERE clave = 'dias_limite_retiro'");
    const dias = parseInt(diasRow?.valor ?? "7", 10);
    const sucursalesActivas = await qAll<SucursalRetiro>(
      conn,
      `SELECT id, nombre, direccion, piso, localidad, provincia
       FROM sucursales
       WHERE activo = 1
       ORDER BY nombre ASC, id ASC`,
    );
    if (sucursalesActivas.length === 0) {
      await conn.rollback();
      res.status(400).json({ error: "No hay sucursales de retiro disponibles. Contacta a la administracion." });
      return;
    }

    let sucursalSeleccionada: SucursalRetiro | undefined;
    if (sucursal_id && Number.isFinite(sucursal_id)) {
      sucursalSeleccionada = sucursalesActivas.find((item) => item.id === Number(sucursal_id));
      if (!sucursalSeleccionada) {
        await conn.rollback();
        res.status(400).json({ error: "La sucursal seleccionada no esta disponible." });
        return;
      }
    } else if (sucursalesActivas.length === 1) {
      sucursalSeleccionada = sucursalesActivas[0];
    } else {
      await conn.rollback();
      res.status(400).json({ error: "Debes seleccionar una sucursal para retirar el producto." });
      return;
    }

    const fechaLimite = new Date();
    fechaLimite.setDate(fechaLimite.getDate() + dias);
    const codigoRetiro = await uniqueRedeemCode(conn);

    const { insertId: canjeId } = await qRun(conn,
      `INSERT INTO canjes (usuario_id, producto_id, sucursal_id, codigo_retiro, puntos_usados, estado, fecha_limite_retiro)
       VALUES (?, ?, ?, ?, ?, 'pendiente', ?)`,
      [usuarioId, producto_id, sucursalSeleccionada.id, codigoRetiro, prod.puntos_requeridos, fechaLimite]
    );

    await qRun(conn,
      `INSERT INTO movimientos_puntos (usuario_id, tipo, puntos, descripcion, referencia_id, referencia_tipo)
       VALUES (?, 'canje_producto', ?, ?, ?, 'canjes')`,
      [usuarioId, -prod.puntos_requeridos, `Canje: ${prod.nombre}`, canjeId]
    );
    await qRun(conn, "UPDATE usuarios SET puntos_saldo = puntos_saldo - ? WHERE id = ?", [prod.puntos_requeridos, usuarioId]);

    await conn.commit();

    res.status(201).json({
      ok: true,
      canje_id: canjeId,
      canje_codigo: codigoRetiro,
      codigo_retiro: codigoRetiro,
      puntos_usados: prod.puntos_requeridos,
      nuevo_saldo: saldo - prod.puntos_requeridos,
      dias_limite_retiro: dias,
      fecha_limite_retiro: fechaLimite,
      sucursal_id: sucursalSeleccionada.id,
      sucursal: sucursalSeleccionada,
      lugar_retiro: `${sucursalSeleccionada.nombre} - ${sucursalSeleccionada.direccion}${
        sucursalSeleccionada.piso ? `, Piso ${sucursalSeleccionada.piso}` : ""
      }, ${sucursalSeleccionada.localidad}, ${sucursalSeleccionada.provincia}`,
    });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

export default router;
