import path from "path";
import { Router } from "express";
import bcrypt from "bcryptjs";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { pool, qOne, qAll, qRun } from "../db";
import { requireAuth, requireRole } from "../auth";
const DEFAULT_INVITE_CODE_LENGTH = 9;
const MIN_INVITE_CODE_LENGTH = 6;
const MAX_INVITE_CODE_LENGTH = 20;

// ── Configuración de multer para subida de imágenes ──────
const storage = multer.diskStorage({
  destination: path.join(__dirname, "../../uploads"),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB máx
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Solo se permiten imágenes JPG, PNG o WEBP"));
  },
});

const router = Router();
router.use(requireAuth, requireRole("admin"));

const strongPasswordSchema = z
  .string()
  .min(8, "La contrasena debe tener al menos 8 caracteres")
  .regex(/(?:.*\d){3,}/, "La contrasena debe incluir al menos 3 numeros")
  .regex(
    /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/,
    "La contrasena debe incluir al menos 1 caracter especial",
  );

const sucursalSchema = z.object({
  nombre: z.string().min(2).max(120),
  direccion: z.string().min(3).max(180),
  piso: z.string().max(30).optional().nullable(),
  localidad: z.string().min(2).max(120),
  provincia: z.string().min(2).max(120),
});

function makeInviteCode(length: number): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

async function uniqueInviteCode(length: number): Promise<string> {
  while (true) {
    const code = makeInviteCode(length);
    const exists = await qOne(pool, "SELECT id FROM usuarios WHERE codigo_invitacion = ?", [code]);
    if (!exists) return code;
  }
}

async function getInviteCodeLength(): Promise<number> {
  const row = await qOne<{ valor: string }>(pool, "SELECT valor FROM configuracion WHERE clave = 'longitud_codigo_invitacion' LIMIT 1");
  const parsed = Number(row?.valor ?? DEFAULT_INVITE_CODE_LENGTH);
  if (!Number.isInteger(parsed)) return DEFAULT_INVITE_CODE_LENGTH;
  return Math.max(MIN_INVITE_CODE_LENGTH, Math.min(MAX_INVITE_CODE_LENGTH, parsed));
}

function normalizeProductImages(imagenes: string[] | undefined | null, imagenUrlFallback?: string | null): string[] {
  const clean = (imagenes ?? [])
    .map((url) => url.trim())
    .filter((url) => url.length > 0)
    .slice(0, 3);

  if (clean.length > 0) return clean;
  if (imagenUrlFallback && imagenUrlFallback.trim()) return [imagenUrlFallback.trim()];
  return [];
}

async function replaceProductImages(conn: any, productoId: number, imagenes: string[]) {
  await qRun(conn, "DELETE FROM producto_imagenes WHERE producto_id = ?", [productoId]);
  for (let index = 0; index < imagenes.length; index += 1) {
    await qRun(
      conn,
      "INSERT INTO producto_imagenes (producto_id, imagen_url, orden) VALUES (?, ?, ?)",
      [productoId, imagenes[index], index + 1]
    );
  }
}

// ════════════════════════════════════════════════════════
//  ESTADÍSTICAS
// ════════════════════════════════════════════════════════

router.get("/stats", async (_req, res) => {
  const [clientes, productos, codigos, canjesPend, ptsEmitidos] = await Promise.all([
    qOne(pool, "SELECT COUNT(*) AS c FROM usuarios WHERE rol='cliente'"),
    qOne(pool, "SELECT COUNT(*) AS c FROM productos WHERE activo=1"),
    qOne(pool, "SELECT COUNT(*) AS c FROM codigos_puntos WHERE activo=1"),
    qOne(pool, "SELECT COUNT(*) AS c FROM canjes WHERE estado='pendiente'"),
    qOne(pool, "SELECT COALESCE(SUM(puntos),0) AS s FROM movimientos_puntos WHERE puntos > 0"),
  ]);
  res.json({
    clientes:          clientes?.c          ?? 0,
    productos:         productos?.c         ?? 0,
    codigos_activos:   codigos?.c           ?? 0,
    canjes_pendientes: canjesPend?.c        ?? 0,
    puntos_emitidos:   ptsEmitidos?.s       ?? 0,
  });
});

// ════════════════════════════════════════════════════════
//  USUARIOS
// ════════════════════════════════════════════════════════

router.get("/usuarios", async (_req, res) => {
  const rows = await qAll(pool,
    "SELECT id, nombre, email, rol, dni, telefono, puntos_saldo, codigo_invitacion, activo, created_at FROM usuarios ORDER BY created_at DESC"
  );
  res.json(rows);
});

router.post("/usuarios", async (req, res) => {
  const schema = z.object({
    nombre:   z.string().min(1).max(100),
    email:    z.string().email(),
    password: strongPasswordSchema,
    rol:      z.enum(["cliente", "vendedor", "admin"]),
    dni:      z.string().min(6).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }
  const { nombre, email, password, rol, dni } = parsed.data;

  if (rol === "cliente" && !dni) { res.status(400).json({ error: "DNI requerido para clientes" }); return; }

  try {
    const hash = await bcrypt.hash(password, 10);
    let codigo: string | null = null;
    if (rol === "cliente") {
      const longitud = await getInviteCodeLength();
      codigo = await uniqueInviteCode(longitud);
    }
    const { insertId } = await qRun(pool,
      `INSERT INTO usuarios (nombre, email, password_hash, rol, dni, codigo_invitacion) VALUES (?, ?, ?, ?, ?, ?)`,
      [nombre, email, hash, rol, dni ?? null, codigo]
    );
    res.status(201).json({ id: insertId });
  } catch (err: any) {
    if (err.code === "ER_DUP_ENTRY") { res.status(409).json({ error: "Email o DNI ya registrado" }); return; }
    throw err;
  }
});

router.put("/usuarios/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "ID de usuario inválido" });
    return;
  }

  const schema = z.object({
    nombre: z.string().min(1).max(100),
    email: z.string().email(),
    rol: z.enum(["cliente", "vendedor", "admin"]),
    dni: z.string().min(6).max(20).optional().nullable(),
    telefono: z.string().max(25).optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const { nombre, email, rol, dni, telefono } = parsed.data;
  if (rol === "cliente" && !dni?.trim()) {
    res.status(400).json({ error: "DNI requerido para clientes" });
    return;
  }

  try {
    const { affectedRows } = await qRun(
      pool,
      `UPDATE usuarios
       SET nombre = ?, email = ?, rol = ?, dni = ?, telefono = ?
       WHERE id = ?`,
      [nombre.trim(), email.trim().toLowerCase(), rol, dni?.trim() || null, telefono?.trim() || null, id]
    );
    if (affectedRows === 0) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    if (err.code === "ER_DUP_ENTRY") {
      res.status(409).json({ error: "Email o DNI ya registrado" });
      return;
    }
    throw err;
  }
});

router.patch("/usuarios/:id/activo", async (req, res) => {
  const id = Number(req.params.id);
  const { activo } = req.body;
  if (typeof activo !== "boolean") { res.status(400).json({ error: "activo debe ser boolean" }); return; }
  await qRun(pool, "UPDATE usuarios SET activo = ? WHERE id = ?", [activo ? 1 : 0, id]);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════
//  PUNTOS MANUALES
// ════════════════════════════════════════════════════════

router.post("/puntos", async (req, res) => {
  const schema = z.object({
    usuario_id:  z.number().int().positive(),
    puntos:      z.number().int().refine((n) => n !== 0, "No puede ser 0"),
    descripcion: z.string().max(255).optional(),
    tipo:        z.enum(["asignacion_manual", "ajuste"]).default("asignacion_manual"),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }
  const { usuario_id, puntos, descripcion, tipo } = parsed.data;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const userRow = await qOne(conn, "SELECT id, puntos_saldo FROM usuarios WHERE id = ? AND rol = 'cliente'", [usuario_id]);
    if (!userRow) { res.status(404).json({ error: "Cliente no encontrado" }); return; }

    const nuevoSaldo = userRow.puntos_saldo + puntos;
    if (nuevoSaldo < 0) { res.status(400).json({ error: "El saldo no puede quedar negativo" }); return; }

    await qRun(conn,
      `INSERT INTO movimientos_puntos (usuario_id, tipo, puntos, descripcion, creado_por) VALUES (?, ?, ?, ?, ?)`,
      [usuario_id, tipo, puntos, descripcion ?? null, req.user!.id]
    );
    await qRun(conn, "UPDATE usuarios SET puntos_saldo = puntos_saldo + ? WHERE id = ?", [puntos, usuario_id]);

    await conn.commit();
    res.json({ ok: true, nuevo_saldo: nuevoSaldo });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

// ════════════════════════════════════════════════════════
//  CÓDIGOS DE PUNTOS
// ════════════════════════════════════════════════════════

router.get("/codigos", async (_req, res) => {
  const rows = await qAll(pool,
    `SELECT c.id, c.codigo, c.puntos_valor, c.usos_maximos, c.usos_actuales,
            c.fecha_expiracion, c.activo, c.created_at, u.nombre AS creado_por_nombre
     FROM codigos_puntos c JOIN usuarios u ON u.id = c.creado_por
     ORDER BY c.created_at DESC`
  );
  res.json(rows);
});

router.get("/codigos/:id/usos", async (req, res) => {
  const rows = await qAll(pool,
    `SELECT u.nombre, u.email, u.dni, uc.created_at AS usado_en
     FROM usos_codigos uc JOIN usuarios u ON u.id = uc.usuario_id
     WHERE uc.codigo_id = ? ORDER BY uc.created_at DESC`,
    [Number(req.params.id)]
  );
  res.json(rows);
});

router.post("/codigos", async (req, res) => {
  const schema = z.object({
    codigo:           z.string().min(3).max(50).transform((s) => s.toUpperCase().trim()),
    puntos_valor:     z.number().int().positive(),
    usos_maximos:     z.number().int().min(0).default(1),
    fecha_expiracion: z.string().datetime().optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }
  const { codigo, puntos_valor, usos_maximos, fecha_expiracion } = parsed.data;

  try {
    const { insertId } = await qRun(pool,
      `INSERT INTO codigos_puntos (codigo, puntos_valor, usos_maximos, fecha_expiracion, creado_por)
       VALUES (?, ?, ?, ?, ?)`,
      [codigo, puntos_valor, usos_maximos, fecha_expiracion ?? null, req.user!.id]
    );
    res.status(201).json({ id: insertId, codigo });
  } catch (err: any) {
    if (err.code === "ER_DUP_ENTRY") { res.status(409).json({ error: "Ya existe un código con ese nombre" }); return; }
    throw err;
  }
});

router.patch("/codigos/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { activo } = req.body;
  if (typeof activo !== "boolean") { res.status(400).json({ error: "activo (boolean) requerido" }); return; }
  await qRun(pool, "UPDATE codigos_puntos SET activo = ? WHERE id = ?", [activo ? 1 : 0, id]);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════
//  CANJES
// ════════════════════════════════════════════════════════

router.get("/canjes", async (_req, res) => {
  const rows = await qAll(pool,
    `SELECT c.id, c.codigo_retiro, c.puntos_usados, c.estado, c.fecha_limite_retiro, c.notas,
            c.created_at, c.updated_at,
            u.nombre AS cliente_nombre, u.email AS cliente_email, u.dni AS cliente_dni,
            p.nombre AS producto_nombre,
            s.id AS sucursal_id, s.nombre AS sucursal_nombre, s.direccion AS sucursal_direccion,
            s.piso AS sucursal_piso, s.localidad AS sucursal_localidad, s.provincia AS sucursal_provincia
     FROM canjes c
     JOIN usuarios u ON u.id = c.usuario_id
     JOIN productos p ON p.id = c.producto_id
     LEFT JOIN sucursales s ON s.id = c.sucursal_id
     ORDER BY c.created_at DESC`
  );
  res.json(rows);
});

router.patch("/canjes/:id", async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({
    estado: z.enum(["pendiente", "entregado", "no_disponible", "expirado", "cancelado"]),
    notas:  z.string().max(1000).optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }
  const { estado, notas } = parsed.data;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const canje = await qOne(conn, "SELECT id, usuario_id, puntos_usados, estado FROM canjes WHERE id = ?", [id]);
    if (!canje) { res.status(404).json({ error: "Canje no encontrado" }); return; }
    if (canje.estado === "entregado" || canje.estado === "cancelado") {
      res.status(400).json({ error: `El canje ya está en estado '${canje.estado}'` }); return;
    }

    await qRun(conn, "UPDATE canjes SET estado = ?, notas = ? WHERE id = ?", [estado, notas ?? null, id]);

    if (estado === "no_disponible" || estado === "cancelado") {
      const motivo = estado === "cancelado" ? "cancelado" : "no disponible";
      await qRun(conn,
        `INSERT INTO movimientos_puntos
           (usuario_id, tipo, puntos, descripcion, referencia_id, referencia_tipo, creado_por)
         VALUES (?, 'devolucion_canje', ?, ?, ?, 'canjes', ?)`,
        [canje.usuario_id, canje.puntos_usados, `Devolución por canje ${motivo}`, id, req.user!.id]
      );
      await qRun(conn, "UPDATE usuarios SET puntos_saldo = puntos_saldo + ? WHERE id = ?",
        [canje.puntos_usados, canje.usuario_id]);
    }

    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

// ════════════════════════════════════════════════════════
//  MOVIMIENTOS (historial global)
// ════════════════════════════════════════════════════════

router.get("/movimientos", async (_req, res) => {
  const rows = await qAll(pool,
    `SELECT m.id, m.tipo, m.puntos, m.descripcion, m.referencia_tipo, m.created_at,
            u.nombre AS usuario_nombre, u.email AS usuario_email,
            a.nombre AS admin_nombre
     FROM movimientos_puntos m
     JOIN usuarios u ON u.id = m.usuario_id
     LEFT JOIN usuarios a ON a.id = m.creado_por
     ORDER BY m.created_at DESC LIMIT 500`
  );
  res.json(rows);
});

// ════════════════════════════════════════════════════════
//  PRODUCTOS (ABM completo)
// ════════════════════════════════════════════════════════

router.get("/productos", async (_req, res) => {
  const rows = await qAll<{
    id: number;
    nombre: string;
    descripcion: string | null;
    imagen_url: string | null;
    categoria: string | null;
    puntos_requeridos: number;
    puntos_acumulables: number | null;
    activo: number;
    created_at: string;
  }>(pool,
    "SELECT id, nombre, descripcion, imagen_url, categoria, puntos_requeridos, puntos_acumulables, activo, created_at FROM productos ORDER BY created_at DESC"
  );
  if (!rows.length) {
    res.json([]);
    return;
  }

  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => "?").join(", ");
  const imageRows = await qAll<{ producto_id: number; imagen_url: string; orden: number }>(
    pool,
    `SELECT producto_id, imagen_url, orden
     FROM producto_imagenes
     WHERE producto_id IN (${placeholders})
     ORDER BY producto_id ASC, orden ASC`,
    ids
  );

  const imageMap = new Map<number, string[]>();
  for (const image of imageRows) {
    const current = imageMap.get(image.producto_id) ?? [];
    current.push(image.imagen_url);
    imageMap.set(image.producto_id, current);
  }

  res.json(
    rows.map((row) => {
      const imagenes = normalizeProductImages(imageMap.get(row.id), row.imagen_url);
      return {
        ...row,
        activo: Boolean(row.activo),
        imagenes,
        imagen_url: imagenes[0] ?? null,
      };
    })
  );
});

// POST /admin/productos/upload — recibe imagen y devuelve la URL pública
router.post("/productos/upload", (req, res, next) => {
  upload.single("imagen")(req, res, (err) => {
    if (err) { res.status(400).json({ error: err.message }); return; }
    if (!req.file) { res.status(400).json({ error: "No se recibió ningún archivo" }); return; }
    res.json({ url: `/uploads/${req.file.filename}` });
  });
});

router.post("/productos", async (req, res) => {
  const schema = z.object({
    nombre:             z.string().min(1).max(150),
    descripcion:        z.string().max(1000).optional().nullable(),
    imagen_url:         z.string().min(1).optional().nullable(),
    imagenes:           z.array(z.string().min(1)).max(3).optional().nullable(),
    categoria:          z.string().max(100).optional().nullable(),
    puntos_requeridos:  z.number().int().positive(),
    puntos_acumulables: z.number().int().positive().optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }
  const { nombre, descripcion, imagen_url, imagenes, categoria, puntos_requeridos, puntos_acumulables } = parsed.data;
  const imageUrls = normalizeProductImages(imagenes, imagen_url);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const { insertId } = await qRun(conn,
      "INSERT INTO productos (nombre, descripcion, imagen_url, categoria, puntos_requeridos, puntos_acumulables) VALUES (?, ?, ?, ?, ?, ?)",
      [nombre, descripcion ?? null, imageUrls[0] ?? null, categoria ?? null, puntos_requeridos, puntos_acumulables ?? null]
    );
    await replaceProductImages(conn, insertId, imageUrls);

    await conn.commit();
    res.status(201).json({ id: insertId });
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
});

router.put("/productos/:id", async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({
    nombre:             z.string().min(1).max(150),
    descripcion:        z.string().max(1000).optional().nullable(),
    imagen_url:         z.string().min(1).optional().nullable(),
    imagenes:           z.array(z.string().min(1)).max(3).optional().nullable(),
    categoria:          z.string().max(100).optional().nullable(),
    puntos_requeridos:  z.number().int().positive(),
    puntos_acumulables: z.number().int().positive().optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }
  const { nombre, descripcion, imagen_url, imagenes, categoria, puntos_requeridos, puntos_acumulables } = parsed.data;
  const imageUrls = normalizeProductImages(imagenes, imagen_url);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const { affectedRows } = await qRun(conn,
      "UPDATE productos SET nombre=?, descripcion=?, imagen_url=?, categoria=?, puntos_requeridos=?, puntos_acumulables=? WHERE id=?",
      [nombre, descripcion ?? null, imageUrls[0] ?? null, categoria ?? null, puntos_requeridos, puntos_acumulables ?? null, id]
    );
    if (affectedRows === 0) {
      await conn.rollback();
      res.status(404).json({ error: "Producto no encontrado" });
      return;
    }

    await replaceProductImages(conn, id, imageUrls);
    await conn.commit();
    res.json({ ok: true });
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
});

router.patch("/productos/:id/activo", async (req, res) => {
  const id = Number(req.params.id);
  const { activo } = req.body;
  if (typeof activo !== "boolean") { res.status(400).json({ error: "activo debe ser boolean" }); return; }
  await qRun(pool, "UPDATE productos SET activo = ? WHERE id = ?", [activo ? 1 : 0, id]);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════
//  CATEGORÍAS (ABM)
// ════════════════════════════════════════════════════════

router.get("/categorias", async (_req, res) => {
  const rows = await qAll(pool, "SELECT id, nombre, created_at FROM categorias ORDER BY nombre ASC");
  res.json(rows);
});

router.post("/categorias", async (req, res) => {
  const schema = z.object({ nombre: z.string().min(1).max(100) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }

  try {
    const { insertId } = await qRun(pool, "INSERT INTO categorias (nombre) VALUES (?)", [parsed.data.nombre]);
    res.status(201).json({ id: insertId });
  } catch (err: any) {
    if (err.code === "ER_DUP_ENTRY") { res.status(409).json({ error: "Ya existe una categoría con ese nombre" }); return; }
    throw err;
  }
});

router.put("/categorias/:id", async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({ nombre: z.string().min(1).max(100) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }

  try {
    const { affectedRows } = await qRun(pool, "UPDATE categorias SET nombre=? WHERE id=?", [parsed.data.nombre, id]);
    if (affectedRows === 0) { res.status(404).json({ error: "Categoría no encontrada" }); return; }
    res.json({ ok: true });
  } catch (err: any) {
    if (err.code === "ER_DUP_ENTRY") { res.status(409).json({ error: "Ya existe otra categoría con ese nombre" }); return; }
    throw err;
  }
});


// ════════════════════════════════════════════════════════
//  CONFIGURACIÓN
// ════════════════════════════════════════════════════════

router.get("/sucursales", async (_req, res) => {
  const rows = await qAll(
    pool,
    `SELECT id, nombre, direccion, piso, localidad, provincia, activo, created_at, updated_at
     FROM sucursales
     ORDER BY activo DESC, nombre ASC, id ASC`,
  );
  res.json(rows);
});

router.post("/sucursales", async (req, res) => {
  const parsed = sucursalSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }
  const { nombre, direccion, piso, localidad, provincia } = parsed.data;
  const { insertId } = await qRun(
    pool,
    `INSERT INTO sucursales (nombre, direccion, piso, localidad, provincia, activo)
     VALUES (?, ?, ?, ?, ?, 1)`,
    [nombre.trim(), direccion.trim(), piso?.trim() || null, localidad.trim(), provincia.trim()],
  );
  res.status(201).json({ id: insertId });
});

router.put("/sucursales/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "ID de sucursal invalido" });
    return;
  }
  const parsed = sucursalSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const { nombre, direccion, piso, localidad, provincia } = parsed.data;
  const { affectedRows } = await qRun(
    pool,
    `UPDATE sucursales
     SET nombre = ?, direccion = ?, piso = ?, localidad = ?, provincia = ?
     WHERE id = ?`,
    [nombre.trim(), direccion.trim(), piso?.trim() || null, localidad.trim(), provincia.trim(), id],
  );
  if (affectedRows === 0) {
    res.status(404).json({ error: "Sucursal no encontrada" });
    return;
  }
  res.json({ ok: true });
});

router.patch("/sucursales/:id/activo", async (req, res) => {
  const id = Number(req.params.id);
  const { activo } = req.body;
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "ID de sucursal invalido" });
    return;
  }
  if (typeof activo !== "boolean") {
    res.status(400).json({ error: "activo debe ser boolean" });
    return;
  }

  if (!activo) {
    const totalActivas = await qOne<{ c: number }>(
      pool,
      "SELECT COUNT(*) AS c FROM sucursales WHERE activo = 1 AND id <> ?",
      [id],
    );
    if (Number(totalActivas?.c ?? 0) <= 0) {
      res.status(400).json({ error: "Debe quedar al menos una sucursal activa." });
      return;
    }
  }

  const { affectedRows } = await qRun(pool, "UPDATE sucursales SET activo = ? WHERE id = ?", [activo ? 1 : 0, id]);
  if (affectedRows === 0) {
    res.status(404).json({ error: "Sucursal no encontrada" });
    return;
  }
  res.json({ ok: true });
});

router.get("/configuracion", async (_req, res) => {
  const rows = await qAll(pool, "SELECT clave, valor, descripcion FROM configuracion");
  res.json(rows);
});

router.put("/configuracion/:clave", async (req, res) => {
  const { clave } = req.params;
  const { valor, descripcion } = req.body;
  if (valor === undefined || valor === null) { res.status(400).json({ error: "valor requerido" }); return; }
  await qRun(
    pool,
    `INSERT INTO configuracion (clave, valor, descripcion)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       valor = VALUES(valor),
       descripcion = COALESCE(NULLIF(VALUES(descripcion), ''), configuracion.descripcion)`,
    [clave, String(valor), typeof descripcion === "string" ? descripcion : null]
  );
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════
//  PÁGINAS DE CONTENIDO (Sobre Nosotros, Términos, etc.)
// ════════════════════════════════════════════════════════

router.get("/paginas", async (_req, res) => {
  const rows = await qAll(pool, "SELECT slug, titulo, updated_at FROM paginas_contenido");
  res.json(rows);
});

router.get("/paginas/:slug", async (req, res) => {
  const page = await qOne(pool,
    "SELECT slug, titulo, contenido, updated_at FROM paginas_contenido WHERE slug = ?",
    [req.params.slug]
  );
  if (!page) { res.status(404).json({ error: "Página no encontrada" }); return; }
  res.json(page);
});

router.put("/paginas/:slug", async (req, res) => {
  const schema = z.object({
    titulo:    z.string().min(1).max(200),
    contenido: z.string().min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }

  const { titulo, contenido } = parsed.data;
  const { affectedRows } = await qRun(pool,
    "UPDATE paginas_contenido SET titulo = ?, contenido = ? WHERE slug = ?",
    [titulo, contenido, req.params.slug]
  );
  if (affectedRows === 0) { res.status(404).json({ error: "Página no encontrada" }); return; }
  res.json({ ok: true });
});

export default router;
