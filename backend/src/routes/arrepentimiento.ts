import crypto from "crypto";
import { Router } from "express";
import { z } from "zod";
import { pool, qRun } from "../db";
import { getVerifiedUser } from "../auth";
import { requestRateLimit } from "../middleware/requestRateLimit";
import { emitRealtime } from "../realtime";

const router = Router();

const arrepentimientoSchema = z.object({
  numero_orden: z.string().trim().min(1, "Debes indicar tu numero de pedido.").max(80, "El numero de pedido es demasiado largo."),
  nombre_apellido: z.string().trim().min(3, "Debes indicar tu nombre y apellido.").max(160, "El nombre es demasiado largo."),
  email: z.string().trim().email("Debes ingresar un email valido.").max(160, "El email es demasiado largo."),
  telefono: z.string().trim().min(6, "Debes indicar un telefono de contacto.").max(40, "El telefono es demasiado largo."),
  mensaje: z.string().trim().min(10, "El mensaje es demasiado corto.").max(2000, "El mensaje es demasiado largo."),
});

// Formulario publico sin autenticacion: sin limite, cualquiera puede inundar
// `arrepentimiento_solicitudes` y la bandeja del staff.
const solicitudRateLimit = requestRateLimit({
  action: "arrepentimiento_solicitud",
  windows: [
    { name: "arrepentimiento_min", limit: 5, windowSeconds: 60 },
    { name: "arrepentimiento_dia", limit: 30, windowSeconds: 86400 },
  ],
});

router.post("/", solicitudRateLimit, async (req, res) => {
  const parsed = arrepentimientoSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Datos invalidos." });
    return;
  }

  const codigoTramite = crypto.randomUUID().split("-").join("").slice(0, 12).toUpperCase();
  const userAgent = req.get("user-agent")?.trim().slice(0, 255) || null;
  const authUser = await getVerifiedUser(req);
  const usuarioId = authUser?.rol === "cliente" ? authUser.id : null;

  await qRun(
    pool,
    `INSERT INTO arrepentimiento_solicitudes (
      codigo_tramite,
      usuario_id,
      numero_orden,
      nombre_apellido,
      email,
      telefono,
      mensaje,
      ip_origen,
      user_agent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      codigoTramite,
      usuarioId,
      parsed.data.numero_orden,
      parsed.data.nombre_apellido,
      parsed.data.email,
      parsed.data.telefono,
      parsed.data.mensaje,
      req.ip || null,
      userAgent,
    ],
  );

  emitRealtime(["arrepentimiento"]);
  res.status(201).json({ ok: true, codigo_tramite: codigoTramite });
});

export default router;
