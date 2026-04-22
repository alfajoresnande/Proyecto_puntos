import path from "path";
import { Router } from "express";
import bcrypt from "bcryptjs";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { pool, qOne, qAll, qRun } from "../db";
import { requireAuth, requireRole } from "../auth";

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
    "SELECT id, nombre, email, rol, dni, puntos_saldo, codigo_invitacion, activo, created_at FROM usuarios ORDER BY created_at DESC"
  );
  res.json(rows);
});

router.post("/usuarios", async (req, res) => {
  const schema = z.object({
    nombre:   z.string().min(1).max(100),
    email:    z.string().email(),
    password: z.string().min(6),
    rol:      z.enum(["cliente", "admin"]),
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
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      codigo = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
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
    `SELECT c.id, c.puntos_usados, c.estado, c.fecha_limite_retiro, c.notas,
            c.created_at, c.updated_at,
            u.nombre AS cliente_nombre, u.email AS cliente_email, u.dni AS cliente_dni,
            p.nombre AS producto_nombre
     FROM canjes c
     JOIN usuarios u ON u.id = c.usuario_id
     JOIN productos p ON p.id = c.producto_id
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
  const rows = await qAll(pool,
    "SELECT id, nombre, descripcion, imagen_url, categoria, puntos_requeridos, puntos_acumulables, activo, created_at FROM productos ORDER BY created_at DESC"
  );
  res.json(rows);
});

// POST /admin/productos/upload — recibe imagen y devuelve la URL pública
router.post("/productos/upload", upload.single("imagen"), (req, res) => {
  if (!req.file) { res.status(400).json({ error: "No se recibió ningún archivo" }); return; }
  const url = `/uploads/${req.file.filename}`;
  res.json({ url });
});

router.post("/productos", async (req, res) => {
  const schema = z.object({
    nombre:             z.string().min(1).max(150),
    descripcion:        z.string().max(1000).optional().nullable(),
    imagen_url:         z.string().min(1).optional().nullable(),
    categoria:          z.string().max(100).optional().nullable(),
    puntos_requeridos:  z.number().int().positive(),
    puntos_acumulables: z.number().int().positive().optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }
  const { nombre, descripcion, imagen_url, categoria, puntos_requeridos, puntos_acumulables } = parsed.data;

  const { insertId } = await qRun(pool,
    "INSERT INTO productos (nombre, descripcion, imagen_url, categoria, puntos_requeridos, puntos_acumulables) VALUES (?, ?, ?, ?, ?, ?)",
    [nombre, descripcion ?? null, imagen_url ?? null, categoria ?? null, puntos_requeridos, puntos_acumulables ?? null]
  );
  res.status(201).json({ id: insertId });
});

router.put("/productos/:id", async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({
    nombre:             z.string().min(1).max(150),
    descripcion:        z.string().max(1000).optional().nullable(),
    imagen_url:         z.string().min(1).optional().nullable(),
    categoria:          z.string().max(100).optional().nullable(),
    puntos_requeridos:  z.number().int().positive(),
    puntos_acumulables: z.number().int().positive().optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }
  const { nombre, descripcion, imagen_url, categoria, puntos_requeridos, puntos_acumulables } = parsed.data;

  const { affectedRows } = await qRun(pool,
    "UPDATE productos SET nombre=?, descripcion=?, imagen_url=?, categoria=?, puntos_requeridos=?, puntos_acumulables=? WHERE id=?",
    [nombre, descripcion ?? null, imagen_url ?? null, categoria ?? null, puntos_requeridos, puntos_acumulables ?? null, id]
  );
  if (affectedRows === 0) { res.status(404).json({ error: "Producto no encontrado" }); return; }
  res.json({ ok: true });
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
  const rows = await qAll(pool, "SELECT id, nombre, descripcion, created_at FROM categorias ORDER BY nombre ASC");
  res.json(rows);
});

router.post("/categorias", async (req, res) => {
  const schema = z.object({
    nombre:      z.string().min(1).max(100),
    descripcion: z.string().max(1000).optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }
  const { nombre, descripcion } = parsed.data;

  try {
    const { insertId } = await qRun(pool, "INSERT INTO categorias (nombre, descripcion) VALUES (?, ?)", [nombre, descripcion ?? null]);
    res.status(201).json({ id: insertId });
  } catch (err: any) {
    if (err.code === "ER_DUP_ENTRY") { res.status(409).json({ error: "Ya existe una categoría con ese nombre" }); return; }
    throw err;
  }
});

router.put("/categorias/:id", async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({
    nombre:      z.string().min(1).max(100),
    descripcion: z.string().max(1000).optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }
  const { nombre, descripcion } = parsed.data;

  try {
    const { affectedRows } = await qRun(pool, "UPDATE categorias SET nombre=?, descripcion=? WHERE id=?", [nombre, descripcion ?? null, id]);
    if (affectedRows === 0) { res.status(404).json({ error: "Categoría no encontrada" }); return; }
    res.json({ ok: true });
  } catch (err: any) {
    if (err.code === "ER_DUP_ENTRY") { res.status(409).json({ error: "Ya existe otra categoría con ese nombre" }); return; }
    throw err;
  }
});

router.delete("/categorias/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { affectedRows } = await qRun(pool, "DELETE FROM categorias WHERE id=?", [id]);
  if (affectedRows === 0) { res.status(404).json({ error: "Categoría no encontrada" }); return; }
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════
//  CONFIGURACIÓN
// ════════════════════════════════════════════════════════

router.get("/configuracion", async (_req, res) => {
  const rows = await qAll(pool, "SELECT clave, valor, descripcion FROM configuracion");
  res.json(rows);
});

router.put("/configuracion/:clave", async (req, res) => {
  const { clave } = req.params;
  const { valor } = req.body;
  if (valor === undefined || valor === null) { res.status(400).json({ error: "valor requerido" }); return; }
  await qRun(pool, "UPDATE configuracion SET valor = ? WHERE clave = ?", [String(valor), clave]);
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
