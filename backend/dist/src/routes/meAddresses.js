"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../auth");
const db_1 = require("../db");
const userAddresses_1 = require("../services/userAddresses");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
const addressSchema = zod_1.z.object({
    alias: zod_1.z.string().max(80).optional().nullable(),
    receptor_nombre: zod_1.z.string().max(120).optional().nullable(),
    receptor_telefono: zod_1.z.string().max(40).optional().nullable(),
    direccion_formateada: zod_1.z.string().min(1).max(255),
    calle: zod_1.z.string().max(140).optional().nullable(),
    numero: zod_1.z.string().max(30).optional().nullable(),
    piso_departamento: zod_1.z.string().max(80).optional().nullable(),
    barrio: zod_1.z.string().max(120).optional().nullable(),
    localidad: zod_1.z.string().max(120).optional().nullable(),
    provincia: zod_1.z.string().max(120).optional().nullable(),
    codigo_postal: zod_1.z.string().max(20).optional().nullable(),
    pais: zod_1.z.string().max(80).optional().nullable(),
    lat: zod_1.z.coerce.number(),
    lng: zod_1.z.coerce.number(),
    provider: zod_1.z.enum(["manual", "geoapify", "google"]).optional().nullable(),
    provider_place_id: zod_1.z.string().max(255).optional().nullable(),
    provider_raw_json: zod_1.z.unknown().optional().nullable(),
    instrucciones_entrega: zod_1.z.string().max(1000).optional().nullable(),
    es_predeterminada: zod_1.z.boolean().optional().nullable(),
});
function parseAddressId(raw) {
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
}
function handleAddressError(res, error) {
    if (error instanceof userAddresses_1.UserAddressError) {
        res.status(error.status).json({ error: error.message });
        return;
    }
    console.error(error);
    res.status(500).json({ error: "Error interno del servidor" });
}
router.get("/", async (req, res) => {
    const addresses = await (0, userAddresses_1.listUserAddresses)(req.user.id);
    res.json(addresses);
});
router.post("/", async (req, res) => {
    const parsed = addressSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0]?.message || "Direccion invalida." });
        return;
    }
    try {
        const created = await (0, userAddresses_1.createUserAddress)(req.user.id, parsed.data);
        res.status(201).json(created);
    }
    catch (error) {
        handleAddressError(res, error);
    }
});
router.get("/:id", async (req, res) => {
    const addressId = parseAddressId(req.params.id);
    if (!addressId) {
        res.status(400).json({ error: "ID de direccion invalido." });
        return;
    }
    const address = await (0, userAddresses_1.getUserAddress)(db_1.pool, req.user.id, addressId);
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
        const updated = await (0, userAddresses_1.updateUserAddress)(req.user.id, addressId, parsed.data);
        res.json(updated);
    }
    catch (error) {
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
        const result = await (0, userAddresses_1.deactivateUserAddress)(req.user.id, addressId);
        res.json(result);
    }
    catch (error) {
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
        const address = await (0, userAddresses_1.setDefaultUserAddress)(req.user.id, addressId);
        res.json(address);
    }
    catch (error) {
        handleAddressError(res, error);
    }
});
exports.default = router;
