import { Router } from "express";
import { qAll, qOne, pool } from "../db";

const router = Router();

type ProvinciaRow = {
  id: string;
  nombre: string;
};

type LocalidadRow = {
  id: string;
  provincia_id: string;
  nombre: string;
};

router.get("/provincias", async (_req, res) => {
  const rows = await qAll<ProvinciaRow>(
    pool,
    `SELECT id, nombre
     FROM argentina_provincias
     ORDER BY nombre ASC`
  );
  res.json(rows);
});

router.get("/localidades", async (req, res) => {
  const provinciaIdRaw = typeof req.query.provincia_id === "string" ? req.query.provincia_id.trim() : "";
  const provinciaNombreRaw = typeof req.query.provincia === "string" ? req.query.provincia.trim() : "";

  let provinciaId = provinciaIdRaw;
  if (!provinciaId && provinciaNombreRaw) {
    const provincia = await qOne<ProvinciaRow>(
      pool,
      "SELECT id, nombre FROM argentina_provincias WHERE LOWER(nombre) = LOWER(?) LIMIT 1",
      [provinciaNombreRaw]
    );
    provinciaId = provincia?.id ?? "";
  }

  if (!/^\d{2}$/.test(provinciaId)) {
    res.status(400).json({ error: "Provincia invalida" });
    return;
  }

  const rows = await qAll<LocalidadRow>(
    pool,
    `SELECT id, provincia_id, nombre
     FROM argentina_localidades
     WHERE provincia_id = ?
     ORDER BY nombre ASC`,
    [provinciaId]
  );
  res.json(rows);
});

export default router;
