import { Router } from "express";
import { getAuthPayload } from "../auth";
import { postAiChat } from "../controllers/aiChat.controller";
import { pool, qOne } from "../db";

const router = Router();

router.use((req, _res, next) => {
  const payload = getAuthPayload(req);
  if (payload) req.user = payload;
  next();
});

router.get("/status", async (_req, res) => {
  try {
    const row = await qOne<{ valor: string }>(
      pool,
      "SELECT valor FROM configuracion WHERE clave = 'chatbot_activo' LIMIT 1",
    );
    const valor = (row?.valor ?? "1").trim().toLowerCase();
    const enabled = ["1", "true", "yes", "on"].includes(valor);
    res.json({ enabled });
  } catch {
    // Si falla la consulta, asumimos que el chatbot está habilitado (default seguro)
    res.json({ enabled: true });
  }
});

router.post("/chat", postAiChat);

export default router;
