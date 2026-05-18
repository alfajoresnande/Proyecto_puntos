"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyOrderCancellation = notifyOrderCancellation;
const db_1 = require("../db");
async function getPreferredConversation(conn, usuarioId) {
    return (0, db_1.qOne)(conn, `SELECT id, estado
     FROM soporte_conversaciones
     WHERE usuario_id = ?
     ORDER BY
       CASE estado WHEN 'archivada' THEN 1 ELSE 0 END ASC,
       ultimo_mensaje_at DESC,
       id DESC
     LIMIT 1
     FOR UPDATE`, [usuarioId]);
}
async function createConversation(conn, usuarioId, orderId, authorUserId) {
    const created = await (0, db_1.qRun)(conn, `INSERT INTO soporte_conversaciones
       (usuario_id, asunto, estado, prioridad, asignado_a, ultimo_mensaje_at, ultimo_staff_at, ultimo_cliente_at)
     VALUES (?, ?, 'respondida', 'alta', ?, NOW(), NOW(), NULL)`, [usuarioId, `Pedido #${orderId} cancelado`, authorUserId]);
    return created.insertId;
}
async function notifyOrderCancellation(conn, { usuarioId, orderId, reason, refundMessage, authorUserId, }) {
    if (!usuarioId)
        return null;
    const cleanReason = reason.trim();
    const cleanRefundMessage = refundMessage?.trim();
    const body = [
        `Hola, te escribimos por tu pedido #${orderId}.`,
        `Tuvimos que cancelarlo por este motivo: ${cleanReason}.`,
        cleanRefundMessage
            ? cleanRefundMessage
            : "Si ya abonaste el pedido, por este mismo chat coordinamos la devolucion del dinero como ultima instancia.",
    ].join("\n\n");
    const existing = await getPreferredConversation(conn, usuarioId);
    const conversationId = existing?.id ?? await createConversation(conn, usuarioId, orderId, authorUserId);
    await (0, db_1.qRun)(conn, `INSERT INTO soporte_mensajes
      (conversacion_id, autor_usuario_id, autor_tipo, cuerpo, es_interno, leido_por_staff_at, leido_por_cliente_at)
     VALUES (?, ?, 'staff', ?, 0, NOW(), NULL)`, [conversationId, authorUserId, body]);
    await (0, db_1.qRun)(conn, `UPDATE soporte_conversaciones
     SET estado = 'respondida',
         prioridad = 'alta',
         asignado_a = COALESCE(asignado_a, ?),
         ultimo_mensaje_at = NOW(),
         ultimo_staff_at = NOW()
     WHERE id = ?`, [authorUserId, conversationId]);
    return Number(conversationId);
}
