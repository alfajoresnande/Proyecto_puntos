import { pool, qAll, qOne, qRun, type Queryable } from "../db";

type Position = [number, number];

export type ShippingPolygonGeoJson = {
  type: "Polygon";
  coordinates: Position[][];
};

export type ShippingZoneInput = {
  nombre: string;
  descripcion?: string | null;
  precio: number;
  prioridad?: number | null;
  color?: string | null;
  polygon_geojson: unknown;
  activo?: boolean | null;
};

export type ShippingZone = {
  id: number;
  nombre: string;
  descripcion: string | null;
  precio: number;
  prioridad: number;
  color: string;
  polygon_geojson: ShippingPolygonGeoJson;
  activo: boolean;
  created_by: number | null;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
};

export type ShippingQuote = {
  disponible: boolean;
  costo_envio: number;
  zona: Pick<ShippingZone, "id" | "nombre" | "precio" | "prioridad" | "color"> | null;
  error?: string;
};

type ShippingZoneRow = Omit<ShippingZone, "precio" | "polygon_geojson" | "activo" | "created_at" | "updated_at"> & {
  precio: string | number;
  polygon_geojson: string | ShippingPolygonGeoJson;
  activo: number | boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

type NormalizedShippingZoneInput = {
  nombre: string;
  descripcion: string | null;
  precio: number;
  prioridad: number;
  color: string;
  polygon_geojson: ShippingPolygonGeoJson;
  activo: boolean;
};

export class ShippingZoneError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const DEFAULT_ZONE_COLOR = "#6B8F71";
const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const POINT_EPSILON = 1e-10;

function asDateString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toMoney(value: number): number {
  return Number((Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2));
}

function cleanOptional(value: unknown, max: number, field: string): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > max) {
    throw new ShippingZoneError(400, `${field} no puede superar ${max} caracteres.`);
  }
  return text;
}

function cleanRequired(value: unknown, max: number, field: string): string {
  const text = cleanOptional(value, max, field);
  if (!text) {
    throw new ShippingZoneError(400, `${field} es obligatorio.`);
  }
  return text;
}

function normalizePrice(value: unknown): number {
  const price = Number(value);
  if (!Number.isFinite(price) || price < 0 || price > 99_999_999) {
    throw new ShippingZoneError(400, "Precio de envio invalido.");
  }
  return toMoney(price);
}

function normalizePriority(value: unknown): number {
  if (value === undefined || value === null || value === "") return 0;
  const priority = Number(value);
  if (!Number.isInteger(priority) || priority < -9999 || priority > 9999) {
    throw new ShippingZoneError(400, "Prioridad de zona invalida.");
  }
  return priority;
}

function normalizeColor(value: unknown): string {
  const color = cleanOptional(value, 16, "Color") ?? DEFAULT_ZONE_COLOR;
  if (!HEX_COLOR_RE.test(color)) {
    throw new ShippingZoneError(400, "Color de zona invalido.");
  }
  return color.toUpperCase();
}

function normalizePoint(raw: unknown): Position {
  if (!Array.isArray(raw) || raw.length < 2) {
    throw new ShippingZoneError(400, "Cada punto del poligono debe tener longitud y latitud.");
  }
  const lng = Number(raw[0]);
  const lat = Number(raw[1]);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new ShippingZoneError(400, "El poligono contiene coordenadas invalidas.");
  }
  return [Number(lng.toFixed(7)), Number(lat.toFixed(7))];
}

function samePoint(a: Position, b: Position): boolean {
  return Math.abs(a[0] - b[0]) < POINT_EPSILON && Math.abs(a[1] - b[1]) < POINT_EPSILON;
}

function normalizeRing(rawRing: unknown, ringIndex: number): Position[] {
  if (!Array.isArray(rawRing)) {
    throw new ShippingZoneError(400, "El poligono debe incluir anillos de coordenadas.");
  }
  const ring = rawRing.map(normalizePoint);
  const unique = new Set(ring.map((point) => `${point[0]},${point[1]}`));
  if (unique.size < 3) {
    throw new ShippingZoneError(400, ringIndex === 0 ? "Marca al menos 3 puntos para crear la zona." : "Un hueco del poligono necesita al menos 3 puntos.");
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (!samePoint(first, last)) {
    ring.push([first[0], first[1]]);
  }
  return ring;
}

function parsePolygon(raw: unknown): ShippingPolygonGeoJson {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      throw new ShippingZoneError(400, "El poligono no es JSON valido.");
    }
  }

  if (value && typeof value === "object" && (value as { type?: unknown }).type === "Feature") {
    value = (value as { geometry?: unknown }).geometry;
  }

  if (!value || typeof value !== "object" || (value as { type?: unknown }).type !== "Polygon") {
    throw new ShippingZoneError(400, "La zona debe guardarse como GeoJSON Polygon.");
  }

  const coordinates = (value as { coordinates?: unknown }).coordinates;
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    throw new ShippingZoneError(400, "El poligono de la zona esta vacio.");
  }

  return {
    type: "Polygon",
    coordinates: coordinates.map((ring, index) => normalizeRing(ring, index)),
  };
}

function parseRowPolygon(value: ShippingZoneRow["polygon_geojson"]): ShippingPolygonGeoJson {
  try {
    return parsePolygon(value);
  } catch {
    return { type: "Polygon", coordinates: [] };
  }
}

function mapShippingZone(row: ShippingZoneRow): ShippingZone {
  return {
    ...row,
    id: Number(row.id),
    precio: Number(row.precio),
    prioridad: Number(row.prioridad ?? 0),
    polygon_geojson: parseRowPolygon(row.polygon_geojson),
    activo: Boolean(row.activo),
    created_by: row.created_by === null ? null : Number(row.created_by),
    updated_by: row.updated_by === null ? null : Number(row.updated_by),
    created_at: asDateString(row.created_at),
    updated_at: asDateString(row.updated_at),
  };
}

export function normalizeShippingZoneInput(input: ShippingZoneInput): NormalizedShippingZoneInput {
  return {
    nombre: cleanRequired(input.nombre, 120, "Nombre"),
    descripcion: cleanOptional(input.descripcion, 1000, "Descripcion"),
    precio: normalizePrice(input.precio),
    prioridad: normalizePriority(input.prioridad),
    color: normalizeColor(input.color),
    polygon_geojson: parsePolygon(input.polygon_geojson),
    activo: input.activo === undefined || input.activo === null ? true : Boolean(input.activo),
  };
}

async function getShippingZone(conn: Queryable, id: number): Promise<ShippingZone | null> {
  const row = await qOne<ShippingZoneRow>(
    conn,
    `SELECT id, nombre, descripcion, precio, prioridad, color, polygon_geojson, activo,
            created_by, updated_by, created_at, updated_at
     FROM envio_zonas
     WHERE id = ?
     LIMIT 1`,
    [id],
  );
  return row ? mapShippingZone(row) : null;
}

export async function listShippingZones(includeInactive = true): Promise<ShippingZone[]> {
  const rows = await qAll<ShippingZoneRow>(
    pool,
    `SELECT id, nombre, descripcion, precio, prioridad, color, polygon_geojson, activo,
            created_by, updated_by, created_at, updated_at
     FROM envio_zonas
     ${includeInactive ? "" : "WHERE activo = 1"}
     ORDER BY activo DESC, prioridad DESC, nombre ASC, id ASC`,
  );
  return rows.map(mapShippingZone);
}

export async function createShippingZone(userId: number, input: ShippingZoneInput): Promise<ShippingZone> {
  const data = normalizeShippingZoneInput(input);
  const inserted = await qRun(
    pool,
    `INSERT INTO envio_zonas
       (nombre, descripcion, precio, prioridad, color, polygon_geojson, activo, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.nombre,
      data.descripcion,
      data.precio,
      data.prioridad,
      data.color,
      JSON.stringify(data.polygon_geojson),
      data.activo ? 1 : 0,
      userId,
      userId,
    ],
  );
  const created = await getShippingZone(pool, inserted.insertId);
  if (!created) throw new ShippingZoneError(500, "No se pudo leer la zona creada.");
  return created;
}

export async function updateShippingZone(userId: number, id: number, input: ShippingZoneInput): Promise<ShippingZone> {
  const data = normalizeShippingZoneInput(input);
  const updated = await qRun(
    pool,
    `UPDATE envio_zonas
     SET nombre = ?, descripcion = ?, precio = ?, prioridad = ?, color = ?,
         polygon_geojson = ?, activo = ?, updated_by = ?
     WHERE id = ?`,
    [
      data.nombre,
      data.descripcion,
      data.precio,
      data.prioridad,
      data.color,
      JSON.stringify(data.polygon_geojson),
      data.activo ? 1 : 0,
      userId,
      id,
    ],
  );
  if (updated.affectedRows === 0) {
    throw new ShippingZoneError(404, "Zona de envio no encontrada.");
  }
  const zone = await getShippingZone(pool, id);
  if (!zone) throw new ShippingZoneError(500, "No se pudo leer la zona actualizada.");
  return zone;
}

export async function setShippingZoneActive(userId: number, id: number, activo: boolean): Promise<ShippingZone> {
  const updated = await qRun(
    pool,
    "UPDATE envio_zonas SET activo = ?, updated_by = ? WHERE id = ?",
    [activo ? 1 : 0, userId, id],
  );
  if (updated.affectedRows === 0) {
    throw new ShippingZoneError(404, "Zona de envio no encontrada.");
  }
  const zone = await getShippingZone(pool, id);
  if (!zone) throw new ShippingZoneError(500, "No se pudo leer la zona actualizada.");
  return zone;
}

function pointOnSegment(point: Position, start: Position, end: Position): boolean {
  const [px, py] = point;
  const [x1, y1] = start;
  const [x2, y2] = end;
  const cross = (py - y1) * (x2 - x1) - (px - x1) * (y2 - y1);
  if (Math.abs(cross) > POINT_EPSILON) return false;
  const dot = (px - x1) * (px - x2) + (py - y1) * (py - y2);
  return dot <= POINT_EPSILON;
}

function pointInRing(point: Position, ring: Position[]): boolean {
  if (ring.length < 4) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const current = ring[i];
    const previous = ring[j];
    if (pointOnSegment(point, previous, current)) return true;
    const intersects =
      current[1] > point[1] !== previous[1] > point[1] &&
      point[0] < ((previous[0] - current[0]) * (point[1] - current[1])) / (previous[1] - current[1]) + current[0];
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lat: number, lng: number, polygon: ShippingPolygonGeoJson): boolean {
  const point: Position = [lng, lat];
  const [outer, ...holes] = polygon.coordinates;
  if (!outer || !pointInRing(point, outer)) return false;
  return !holes.some((ring) => pointInRing(point, ring));
}

export async function quoteShippingForCoordinates(conn: Queryable, lat: number, lng: number): Promise<ShippingQuote> {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new ShippingZoneError(400, "Coordenadas de envio invalidas.");
  }

  const rows = await qAll<ShippingZoneRow>(
    conn,
    `SELECT id, nombre, descripcion, precio, prioridad, color, polygon_geojson, activo,
            created_by, updated_by, created_at, updated_at
     FROM envio_zonas
     WHERE activo = 1
     ORDER BY prioridad DESC, id ASC`,
  );

  for (const zone of rows.map(mapShippingZone)) {
    if (pointInPolygon(lat, lng, zone.polygon_geojson)) {
      return {
        disponible: true,
        costo_envio: zone.precio,
        zona: {
          id: zone.id,
          nombre: zone.nombre,
          precio: zone.precio,
          prioridad: zone.prioridad,
          color: zone.color,
        },
      };
    }
  }

  return {
    disponible: false,
    costo_envio: 0,
    zona: null,
    error: "La direccion seleccionada no esta dentro de una zona de envio activa.",
  };
}

export function buildShippingQuoteSnapshot(quote: ShippingQuote) {
  if (!quote.disponible || !quote.zona) return null;
  return {
    zona_id: quote.zona.id,
    zona_nombre: quote.zona.nombre,
    costo_envio: quote.costo_envio,
    prioridad: quote.zona.prioridad,
  };
}
