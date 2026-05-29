import { Router } from "express";
import { z } from "zod";
import { getAuthPayload } from "../auth";
import { getClientIp, getOrCreateDeviceId } from "../services/authIdentity";
import { recordAppPresence } from "../services/appPresence";

const router = Router();

const heartbeatSchema = z.object({
  session_id: z.string().trim().min(8).max(80),
  path: z.string().trim().max(255).optional().default("/"),
  page_title: z.string().trim().max(255).optional().nullable(),
  referrer: z.string().trim().max(255).optional().nullable(),
  reason: z.string().trim().max(40).optional().nullable(),
});

function isStaffRole(role: string | null | undefined): boolean {
  return role === "admin" || role === "superAdmin" || role === "vendedor";
}

function isStaffPath(path: string): boolean {
  return path.startsWith("/admin") || path.startsWith("/superadmin") || path.startsWith("/vendedor") || path.startsWith("/staff");
}

router.post("/heartbeat", async (req, res, next) => {
  const parsed = heartbeatSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  try {
    const auth = getAuthPayload(req);
    const path = parsed.data.path.trim() || "/";
    if (isStaffRole(auth?.rol) || isStaffPath(path)) {
      res.status(204).end();
      return;
    }

    const visitorId = getOrCreateDeviceId(req, res);
    await recordAppPresence({
      visitorId,
      sessionId: parsed.data.session_id,
      userId: auth?.rol === "cliente" ? Number(auth.id) : null,
      visitorType: auth?.rol === "cliente" ? "cliente" : "anonimo",
      path,
      pageTitle: parsed.data.page_title ?? null,
      referrer: parsed.data.referrer ?? null,
      ip: getClientIp(req),
      userAgent: req.get("user-agent") ?? null,
    });

    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
