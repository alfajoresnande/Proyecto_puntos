import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { pool } from "../db";
import {
  createUserAddress,
  deactivateUserAddress,
  getUserAddress,
  listUserAddresses,
  setDefaultUserAddress,
  updateUserAddress,
  UserAddressError,
} from "../services/userAddresses";

const router = Router();
router.use(requireAuth);

const addressSchema = z.object({
  alias: z.string().max(80).optional().nullable(),
  receptor_nombre: z.string().max(120).optional().nullable(),
  receptor_telefono: z.string().max(40).optional().nullable(),
  direccion_formateada: z.string().min(1).max(255),
  calle: z.string().max(140).optional().nullable(),
  numero: z.string().max(30).optional().nullable(),
  piso_departamento: z.string().max(80).optional().nullable(),
  barrio: z.string().max(120).optional().nullable(),
  localidad: z.string().max(120).optional().nullable(),
  provincia: z.string().max(120).optional().nullable(),
  codigo_postal: z.string().max(20).optional().nullable(),
  pais: z.string().max(80).optional().nullable(),
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  provider: z.enum(["manual", "geoapify", "google"]).optional().nullable(),
  provider_place_id: z.string().max(255).optional().nullable(),
  provider_raw_json: z.unknown().optional().nullable(),
  instrucciones_entrega: z.string().max(1000).optional().nullable(),
  es_predeterminada: z.boolean().optional().nullable(),
});

function parseAddressId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function handleAddressError(res: { status: (code: number) => { json: (body: unknown) => void } }, error: unknown) {
  if (error instanceof UserAddressError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  console.error(error);
  res.status(500).json({ error: "Error interno del servidor" });
}

router.get("/", async (req, res) => {
  const addresses = await listUserAddresses(req.user!.id);
  res.json(addresses);
});

router.post("/", async (req, res) => {
  const parsed = addressSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message || "Direccion invalida." });
    return;
  }

  try {
    const created = await createUserAddress(req.user!.id, parsed.data);
    res.status(201).json(created);
  } catch (error) {
    handleAddressError(res, error);
  }
});

router.get("/:id", async (req, res) => {
  const addressId = parseAddressId(req.params.id);
  if (!addressId) {
    res.status(400).json({ error: "ID de direccion invalido." });
    return;
  }

  const address = await getUserAddress(pool, req.user!.id, addressId);
  if (!address) {
    res.status(404).json({ error: "Direccion no encontrada." });
    return;
  }
  res.json(address);
});

router.put("/:id", async (req, res) => {
  const addressId = parseAddressId(req.params.id);
  if (!addressId) {
    res.status(400).json({ error: "ID de direccion invalido." });
    return;
  }

  const parsed = addressSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message || "Direccion invalida." });
    return;
  }

  try {
    const updated = await updateUserAddress(req.user!.id, addressId, parsed.data);
    res.json(updated);
  } catch (error) {
    handleAddressError(res, error);
  }
});

router.delete("/:id", async (req, res) => {
  const addressId = parseAddressId(req.params.id);
  if (!addressId) {
    res.status(400).json({ error: "ID de direccion invalido." });
    return;
  }

  try {
    const result = await deactivateUserAddress(req.user!.id, addressId);
    res.json(result);
  } catch (error) {
    handleAddressError(res, error);
  }
});

router.post("/:id/default", async (req, res) => {
  const addressId = parseAddressId(req.params.id);
  if (!addressId) {
    res.status(400).json({ error: "ID de direccion invalido." });
    return;
  }

  try {
    const address = await setDefaultUserAddress(req.user!.id, addressId);
    res.json(address);
  } catch (error) {
    handleAddressError(res, error);
  }
});

export default router;
