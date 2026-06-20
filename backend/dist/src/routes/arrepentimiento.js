"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = __importDefault(require("crypto"));
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../db");
const auth_1 = require("../auth");
const realtime_1 = require("../realtime");
const router = (0, express_1.Router)();
const arrepentimientoSchema = zod_1.z.object({
    numero_orden: zod_1.z.string().trim().min(1, "Debes indicar tu numero de pedido.").max(80, "El numero de pedido es demasiado largo."),
    nombre_apellido: zod_1.z.string().trim().min(3, "Debes indicar tu nombre y apellido.").max(160, "El nombre es demasiado largo."),
    email: zod_1.z.string().trim().email("Debes ingresar un email valido.").max(160, "El email es demasiado largo."),
    telefono: zod_1.z.string().trim().min(6, "Debes indicar un telefono de contacto.").max(40, "El telefono es demasiado largo."),
    mensaje: zod_1.z.string().trim().min(10, "El mensaje es demasiado corto.").max(2000, "El mensaje es demasiado largo."),
});
router.post("/", async (req, res) => {
    const parsed = arrepentimientoSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Datos invalidos." });
        return;
    }
    const codigoTramite = crypto_1.default.randomUUID().split("-").join("").slice(0, 12).toUpperCase();
    const userAgent = req.get("user-agent")?.trim().slice(0, 255) || null;
    const authUser = (0, auth_1.getAuthPayload)(req);
    const usuarioId = authUser?.rol === "cliente" ? authUser.id : null;
    await (0, db_1.qRun)(db_1.pool, `INSERT INTO arrepentimiento_solicitudes (
      codigo_tramite,
      usuario_id,
      numero_orden,
      nombre_apellido,
      email,
      telefono,
      mensaje,
      ip_origen,
      user_agent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        codigoTramite,
        usuarioId,
        parsed.data.numero_orden,
        parsed.data.nombre_apellido,
        parsed.data.email,
        parsed.data.telefono,
        parsed.data.mensaje,
        req.ip || null,
        userAgent,
    ]);
    (0, realtime_1.emitRealtime)(["arrepentimiento"]);
    res.status(201).json({ ok: true, codigo_tramite: codigoTramite });
});
exports.default = router;
