import { Router } from "express";
import { getVerifiedUser } from "../auth";
import { postAiChat } from "../controllers/aiChat.controller";
import { pool, qOne } from "../db";

const router = Router();

router.use(async (req, _res, next) => {
  // Estado verificado contra la base: un token de una cuenta desactivada o
  // degradada no arrastra su rol viejo al chat.
  const payload = await getVerifiedUser(req);
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
