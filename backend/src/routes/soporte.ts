import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { pool, qAll, qOne, qRun, type Queryable } from "../db";

const router = Router();
router.use(requireAuth);

const createConversationSchema = z.object({
  asunto: z.string().trim().min(3).max(180).optional().default(""),
  cuerpo: z.string().trim().min(1).max(4000),
  prioridad: z.enum(["normal", "alta"]).optional().default("normal"),
  usuario_id: z.number().int().positive().optional(),
});

const sendMessageSchema = z.object({
  cuerpo: z.string().trim().min(1).max(4000),
  es_interno: z.boolean().optional().default(false),
});

const updateConversationSchema = z.object({
  estado: z.enum(["abierta", "respondida", "cerrada"]).optional(),
  prioridad: z.enum(["normal", "alta"]).optional(),
  asignado_a: z.number().int().positive().nullable().optional(),
});

type ConversationRow = {
  id: number;
  usuario_id: number;
  asunto: string | null;
  estado: "abierta" | "respondida" | "cerrada";
  prioridad: "normal" | "alta";
  asignado_a: number | null;
  ultimo_mensaje_at: string;
  ultimo_staff_at: string | null;
  ultimo_cliente_at: string | null;
  created_at: string;
  updated_at: string;
  usuario_nombre: string;
  usuario_email: string;
  usuario_dni: string | null;
  usuario_telefono: string | null;
  asignado_nombre: string | null;
};

type MessageRow = {
  id: number;
  conversacion_id: number;
  autor_usuario_id: number | null;
  autor_tipo: "cliente" | "staff" | "sistema";
  cuerpo: string;
  es_interno: number;
  leido_por_cliente_at: string | null;
  leido_por_staff_at: string | null;
  created_at: string;
  autor_nombre: string | null;
  autor_rol: string | null;
};

type SupportUserRow = {
  id: number;
  nombre: string;
  email: string;
  dni: string | null;
  telefono: string | null;
  rol: "admin" | "superAdmin" | "vendedor" | "cliente";
};

function isStaff(req: Express.Request): boolean {
  return req.user?.rol === "admin" || req.user?.rol === "superAdmin" || req.user?.rol === "vendedor";
}

async function getConversationById(conn: Queryable, id: number): Promise<ConversationRow | undefined> {
  return qOne<ConversationRow>(
    conn,
    `SELECT c.id, c.usuario_id, c.asunto, c.estado, c.prioridad, c.asignado_a,
           c.ultimo_mensaje_at, c.ultimo_staff_at, c.ultimo_cliente_at, c.created_at, c.updated_at,
            u.nombre AS usuario_nombre, u.email AS usuario_email, u.dni AS usuario_dni, u.telefono AS usuario_telefono,
            a.nombre AS asignado_nombre
     FROM soporte_conversaciones c
     JOIN usuarios u ON u.id = c.usuario_id
     LEFT JOIN usuarios a ON a.id = c.asignado_a
     WHERE c.id = ?
     LIMIT 1`,
    [id],
  );
}

async function ensureConversationAccess(conn: Queryable, conversationId: number, requesterId: number, staff: boolean) {
  const conversation = await getConversationById(conn, conversationId);
  if (!conversation) {
    throw new Error("Conversacion no encontrada.");
  }
  if (!staff && Number(conversation.usuario_id) !== requesterId) {
    throw new Error("No autorizado para ver esta conversacion.");
  }
  return conversation;
}

function serializeConversation(row: ConversationRow & {
  unread_staff?: number;
  unread_cliente?: number;
  last_public_message?: string | null;
}) {
  return {
    id: Number(row.id),
    usuario_id: Number(row.usuario_id),
    asunto: row.asunto ?? "",
    estado: row.estado,
    prioridad: row.prioridad,
    asignado_a: row.asignado_a === null ? null : Number(row.asignado_a),
    ultimo_mensaje_at: row.ultimo_mensaje_at,
    ultimo_staff_at: row.ultimo_staff_at,
    ultimo_cliente_at: row.ultimo_cliente_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    usuario: {
      id: Number(row.usuario_id),
      nombre: row.usuario_nombre,
      email: row.usuario_email,
      dni: row.usuario_dni ?? null,
      telefono: row.usuario_telefono ?? null,
    },
    asignado_nombre: row.asignado_nombre ?? null,
    unread_staff: Number(row.unread_staff ?? 0),
    unread_cliente: Number(row.unread_cliente ?? 0),
    last_public_message: row.last_public_message ?? null,
  };
}

function serializeMessage(row: MessageRow, viewerIsStaff: boolean) {
  const publicSender =
    row.autor_tipo === "staff"
      ? "Staff"
      : row.autor_tipo === "cliente"
        ? row.autor_nombre || "Cliente"
        : "Sistema";

  const staffSender =
    row.autor_tipo === "staff"
      ? row.autor_nombre || "Staff"
      : row.autor_tipo === "cliente"
        ? row.autor_nombre || "Cliente"
        : "Sistema";

  return {
    id: Number(row.id),
    conversacion_id: Number(row.conversacion_id),
    autor_usuario_id: row.autor_usuario_id === null ? null : Number(row.autor_usuario_id),
    autor_tipo: row.autor_tipo,
    autor_label: viewerIsStaff ? staffSender : publicSender,
    autor_rol: viewerIsStaff ? row.autor_rol ?? row.autor_tipo : row.autor_tipo === "staff" ? "staff" : row.autor_tipo,
    cuerpo: row.cuerpo,
    es_interno: Boolean(row.es_interno),
    created_at: row.created_at,
  };
}

router.get("/conversaciones", async (req, res) => {
  const staff = isStaff(req);
  const estado = typeof req.query.estado === "string" ? req.query.estado.trim().toLowerCase() : "";
  const params: Array<number | string> = [];
  const where: string[] = [];

  if (!staff) {
    where.push("c.usuario_id = ?");
    params.push(req.user!.id);
  }
  if (estado && ["abierta", "respondida", "cerrada"].includes(estado)) {
    where.push("c.estado = ?");
    params.push(estado);
  }

  const rows = await qAll<
    ConversationRow & { unread_staff: number; unread_cliente: number; last_public_message: string | null }
  >(
    pool,
    `SELECT c.id, c.usuario_id, c.asunto, c.estado, c.prioridad, c.asignado_a,
            c.ultimo_mensaje_at, c.ultimo_staff_at, c.ultimo_cliente_at, c.created_at, c.updated_at,
            u.nombre AS usuario_nombre, u.email AS usuario_email, u.dni AS usuario_dni, u.telefono AS usuario_telefono,
            a.nombre AS asignado_nombre,
            (
              SELECT COUNT(*)
              FROM soporte_mensajes sm
              WHERE sm.conversacion_id = c.id
                AND sm.autor_tipo = 'cliente'
                AND sm.leido_por_staff_at IS NULL
            ) AS unread_staff,
            (
              SELECT COUNT(*)
              FROM soporte_mensajes sm
              WHERE sm.conversacion_id = c.id
                AND sm.autor_tipo = 'staff'
                AND sm.es_interno = 0
                AND sm.leido_por_cliente_at IS NULL
            ) AS unread_cliente,
            (
              SELECT sm.cuerpo
              FROM soporte_mensajes sm
              WHERE sm.conversacion_id = c.id
                AND sm.es_interno = 0
              ORDER BY sm.created_at DESC, sm.id DESC
              LIMIT 1
            ) AS last_public_message
     FROM soporte_conversaciones c
     JOIN usuarios u ON u.id = c.usuario_id
     LEFT JOIN usuarios a ON a.id = c.asignado_a
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY
       CASE c.estado WHEN 'abierta' THEN 0 WHEN 'respondida' THEN 1 ELSE 2 END ASC,
       c.ultimo_mensaje_at DESC,
       c.id DESC`,
    params,
  );

  res.json(rows.map(serializeConversation));
});

router.get("/usuarios", async (req, res) => {
  if (!isStaff(req)) {
    res.status(403).json({ error: "Solo staff puede consultar usuarios." });
    return;
  }

  const search = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const params: Array<string | number> = [];
  const where = ["u.activo = 1", "u.rol = 'cliente'"];

  if (search) {
    where.push("(u.nombre LIKE ? OR u.email LIKE ? OR u.dni LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const rows = await qAll<SupportUserRow>(
    pool,
    `SELECT u.id, u.nombre, u.email, u.dni, u.telefono, u.rol
     FROM usuarios u
     WHERE ${where.join(" AND ")}
     ORDER BY
       CASE u.rol WHEN 'cliente' THEN 0 WHEN 'vendedor' THEN 1 ELSE 2 END ASC,
       u.nombre ASC,
       u.id ASC
     LIMIT 100`,
    params,
  );

  res.json(
    rows.map((row) => ({
      id: Number(row.id),
      nombre: row.nombre,
      email: row.email,
      dni: row.dni ?? null,
      telefono: row.telefono ?? null,
      rol: row.rol,
    })),
  );
});

router.post("/conversaciones", async (req, res) => {
  const parsed = createConversationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message || "Datos invalidos." });
    return;
  }

  const staff = isStaff(req);
  if (!staff && req.user!.rol !== "cliente") {
    res.status(403).json({ error: "No autorizado para iniciar conversaciones." });
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const usuarioDestinoId = staff ? Number(parsed.data.usuario_id ?? 0) : req.user!.id;
    if (!Number.isInteger(usuarioDestinoId) || usuarioDestinoId <= 0) {
      throw new Error("Selecciona un usuario valido para iniciar la conversacion.");
    }

    const usuarioDestino = await qOne<{ id: number; activo: number }>(
      conn,
      "SELECT id, activo FROM usuarios WHERE id = ? LIMIT 1",
      [usuarioDestinoId],
    );
    if (!usuarioDestino || Number(usuarioDestino.activo) !== 1) {
      throw new Error("El usuario seleccionado no esta disponible.");
    }

    const asunto = parsed.data.asunto || "Consulta general";
    const prioridad = parsed.data.prioridad;
    const estadoInicial = staff ? "respondida" : "abierta";

    const { insertId } = await qRun(
      conn,
      `INSERT INTO soporte_conversaciones
        (usuario_id, asunto, estado, prioridad, asignado_a, ultimo_mensaje_at, ultimo_staff_at, ultimo_cliente_at)
       VALUES (?, ?, ?, ?, ?, NOW(), ?, ?)`,
      [
        usuarioDestinoId,
        asunto,
        estadoInicial,
        prioridad,
        staff ? req.user!.id : null,
        staff ? new Date() : null,
        staff ? null : new Date(),
      ],
    );

    await qRun(
      conn,
      `INSERT INTO soporte_mensajes
        (conversacion_id, autor_usuario_id, autor_tipo, cuerpo, es_interno, leido_por_staff_at, leido_por_cliente_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
      [
        insertId,
        req.user!.id,
        staff ? "staff" : "cliente",
        parsed.data.cuerpo,
        staff ? new Date() : null,
        staff ? null : new Date(),
      ],
    );

    await conn.commit();
    const conversation = await getConversationById(pool, insertId);
    res.status(201).json({
      ok: true,
      conversacion: conversation ? serializeConversation(conversation) : { id: insertId },
    });
  } catch (err) {
    await conn.rollback();
    const message = err instanceof Error ? err.message : "No se pudo crear la conversacion.";
    res.status(400).json({ error: message });
  } finally {
    conn.release();
  }
});

router.get("/conversaciones/:id", async (req, res) => {
  const conversationId = Number(req.params.id);
  if (!Number.isInteger(conversationId) || conversationId <= 0) {
    res.status(400).json({ error: "ID invalido." });
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const staff = isStaff(req);
    const conversation = await ensureConversationAccess(conn, conversationId, req.user!.id, staff);
    const messages = await qAll<MessageRow>(
      conn,
      `SELECT sm.id, sm.conversacion_id, sm.autor_usuario_id, sm.autor_tipo, sm.cuerpo, sm.es_interno,
              sm.leido_por_cliente_at, sm.leido_por_staff_at, sm.created_at,
              u.nombre AS autor_nombre, u.rol AS autor_rol
       FROM soporte_mensajes sm
       LEFT JOIN usuarios u ON u.id = sm.autor_usuario_id
       WHERE sm.conversacion_id = ?
         ${staff ? "" : "AND sm.es_interno = 0"}
       ORDER BY sm.created_at ASC, sm.id ASC`,
      [conversationId],
    );

    if (staff) {
      await qRun(
        conn,
        `UPDATE soporte_mensajes
         SET leido_por_staff_at = NOW()
         WHERE conversacion_id = ?
           AND autor_tipo = 'cliente'
           AND leido_por_staff_at IS NULL`,
        [conversationId],
      );
    } else {
      await qRun(
        conn,
        `UPDATE soporte_mensajes
         SET leido_por_cliente_at = NOW()
         WHERE conversacion_id = ?
           AND autor_tipo = 'staff'
           AND es_interno = 0
           AND leido_por_cliente_at IS NULL`,
        [conversationId],
      );
    }

    await conn.commit();
    res.json({
      conversacion: serializeConversation(conversation),
      mensajes: messages.map((message) => serializeMessage(message, staff)),
    });
  } catch (err) {
    await conn.rollback();
    const message = err instanceof Error ? err.message : "No se pudo cargar la conversacion.";
    const status = message.toLowerCase().includes("autorizado") ? 403 : 404;
    res.status(status).json({ error: message });
  } finally {
    conn.release();
  }
});

router.post("/conversaciones/:id/mensajes", async (req, res) => {
  const conversationId = Number(req.params.id);
  if (!Number.isInteger(conversationId) || conversationId <= 0) {
    res.status(400).json({ error: "ID invalido." });
    return;
  }

  const parsed = sendMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message || "Mensaje invalido." });
    return;
  }

  const staff = isStaff(req);
  if (!staff && parsed.data.es_interno) {
    res.status(403).json({ error: "No autorizado." });
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const conversation = await ensureConversationAccess(conn, conversationId, req.user!.id, staff);

    const autorTipo = staff ? "staff" : "cliente";
    await qRun(
      conn,
      `INSERT INTO soporte_mensajes
        (conversacion_id, autor_usuario_id, autor_tipo, cuerpo, es_interno, leido_por_staff_at, leido_por_cliente_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        conversationId,
        req.user!.id,
        autorTipo,
        parsed.data.cuerpo,
        parsed.data.es_interno ? 1 : 0,
        autorTipo === "staff" ? new Date() : null,
        autorTipo === "cliente" ? new Date() : null,
      ],
    );

    if (staff) {
      const nextState = parsed.data.es_interno ? conversation.estado : "respondida";
      await qRun(
        conn,
        `UPDATE soporte_conversaciones
         SET estado = ?, ultimo_mensaje_at = NOW(), ultimo_staff_at = NOW(),
             asignado_a = COALESCE(asignado_a, ?)
         WHERE id = ?`,
        [nextState, req.user!.id, conversationId],
      );
    } else {
      await qRun(
        conn,
        `UPDATE soporte_conversaciones
         SET estado = 'abierta', ultimo_mensaje_at = NOW(), ultimo_cliente_at = NOW()
         WHERE id = ?`,
        [conversationId],
      );
    }

    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    const message = err instanceof Error ? err.message : "No se pudo enviar el mensaje.";
    res.status(400).json({ error: message });
  } finally {
    conn.release();
  }
});

router.patch("/conversaciones/:id", async (req, res) => {
  if (!isStaff(req)) {
    res.status(403).json({ error: "Solo staff puede actualizar conversaciones." });
    return;
  }

  const conversationId = Number(req.params.id);
  if (!Number.isInteger(conversationId) || conversationId <= 0) {
    res.status(400).json({ error: "ID invalido." });
    return;
  }

  const parsed = updateConversationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message || "Datos invalidos." });
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await ensureConversationAccess(conn, conversationId, req.user!.id, true);

    const updates: string[] = [];
    const params: Array<string | number | null> = [];
    if (parsed.data.estado) {
      updates.push("estado = ?");
      params.push(parsed.data.estado);
    }
    if (parsed.data.prioridad) {
      updates.push("prioridad = ?");
      params.push(parsed.data.prioridad);
    }
    if (parsed.data.asignado_a !== undefined) {
      updates.push("asignado_a = ?");
      params.push(parsed.data.asignado_a);
    }
    if (!updates.length) {
      await conn.rollback();
      res.status(400).json({ error: "No hay cambios para aplicar." });
      return;
    }

    params.push(conversationId);
    await qRun(conn, `UPDATE soporte_conversaciones SET ${updates.join(", ")} WHERE id = ?`, params);
    await conn.commit();

    const conversation = await getConversationById(pool, conversationId);
    res.json({ ok: true, conversacion: conversation ? serializeConversation(conversation) : null });
  } catch (err) {
    await conn.rollback();
    const message = err instanceof Error ? err.message : "No se pudo actualizar la conversacion.";
    res.status(400).json({ error: message });
  } finally {
    conn.release();
  }
});

export default router;
