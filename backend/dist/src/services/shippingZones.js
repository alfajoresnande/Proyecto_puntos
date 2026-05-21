"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShippingZoneError = void 0;
exports.normalizeShippingZoneInput = normalizeShippingZoneInput;
exports.listShippingZones = listShippingZones;
exports.createShippingZone = createShippingZone;
exports.updateShippingZone = updateShippingZone;
exports.setShippingZoneActive = setShippingZoneActive;
exports.quoteShippingForCoordinates = quoteShippingForCoordinates;
exports.buildShippingQuoteSnapshot = buildShippingQuoteSnapshot;
const db_1 = require("../db");
class ShippingZoneError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
exports.ShippingZoneError = ShippingZoneError;
const DEFAULT_ZONE_COLOR = "#6B8F71";
const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const POINT_EPSILON = 1e-10;
function asDateString(value) {
    return value instanceof Date ? value.toISOString() : value;
}
function toMoney(value) {
    return Number((Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2));
}
function cleanOptional(value, max, field) {
    if (value === undefined || value === null)
        return null;
    const text = String(value).trim();
    if (!text)
        return null;
    if (text.length > max) {
        throw new ShippingZoneError(400, `${field} no puede superar ${max} caracteres.`);
    }
    return text;
}
function cleanRequired(value, max, field) {
    const text = cleanOptional(value, max, field);
    if (!text) {
        throw new ShippingZoneError(400, `${field} es obligatorio.`);
    }
    return text;
}
function normalizePrice(value) {
    const price = Number(value);
    if (!Number.isFinite(price) || price < 0 || price > 99_999_999) {
        throw new ShippingZoneError(400, "Precio de envio invalido.");
    }
    return toMoney(price);
}
function normalizePriority(value) {
    if (value === undefined || value === null || value === "")
        return 0;
    const priority = Number(value);
    if (!Number.isInteger(priority) || priority < -9999 || priority > 9999) {
        throw new ShippingZoneError(400, "Prioridad de zona invalida.");
    }
    return priority;
}
function normalizeColor(value) {
    const color = cleanOptional(value, 16, "Color") ?? DEFAULT_ZONE_COLOR;
    if (!HEX_COLOR_RE.test(color)) {
        throw new ShippingZoneError(400, "Color de zona invalido.");
    }
    return color.toUpperCase();
}
function normalizePoint(raw) {
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
function samePoint(a, b) {
    return Math.abs(a[0] - b[0]) < POINT_EPSILON && Math.abs(a[1] - b[1]) < POINT_EPSILON;
}
function normalizeRing(rawRing, ringIndex) {
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
function parsePolygon(raw) {
    let value = raw;
    if (typeof value === "string") {
        try {
            value = JSON.parse(value);
        }
        catch {
            throw new ShippingZoneError(400, "El poligono no es JSON valido.");
        }
    }
    if (value && typeof value === "object" && value.type === "Feature") {
        value = value.geometry;
    }
    if (!value || typeof value !== "object" || value.type !== "Polygon") {
        throw new ShippingZoneError(400, "La zona debe guardarse como GeoJSON Polygon.");
    }
    const coordinates = value.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length === 0) {
        throw new ShippingZoneError(400, "El poligono de la zona esta vacio.");
    }
    return {
        type: "Polygon",
        coordinates: coordinates.map((ring, index) => normalizeRing(ring, index)),
    };
}
function parseRowPolygon(value) {
    try {
        return parsePolygon(value);
    }
    catch {
        return { type: "Polygon", coordinates: [] };
    }
}
function mapShippingZone(row) {
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
function normalizeShippingZoneInput(input) {
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
async function getShippingZone(conn, id) {
    const row = await (0, db_1.qOne)(conn, `SELECT id, nombre, descripcion, precio, prioridad, color, polygon_geojson, activo,
            created_by, updated_by, created_at, updated_at
     FROM envio_zonas
     WHERE id = ?
     LIMIT 1`, [id]);
    return row ? mapShippingZone(row) : null;
}
async function listShippingZones(includeInactive = true) {
    const rows = await (0, db_1.qAll)(db_1.pool, `SELECT id, nombre, descripcion, precio, prioridad, color, polygon_geojson, activo,
            created_by, updated_by, created_at, updated_at
     FROM envio_zonas
     ${includeInactive ? "" : "WHERE activo = 1"}
     ORDER BY activo DESC, prioridad DESC, nombre ASC, id ASC`);
    return rows.map(mapShippingZone);
}
async function createShippingZone(userId, input) {
    const data = normalizeShippingZoneInput(input);
    const inserted = await (0, db_1.qRun)(db_1.pool, `INSERT INTO envio_zonas
       (nombre, descripcion, precio, prioridad, color, polygon_geojson, activo, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        data.nombre,
        data.descripcion,
        data.precio,
        data.prioridad,
        data.color,
        JSON.stringify(data.polygon_geojson),
        data.activo ? 1 : 0,
        userId,
        userId,
    ]);
    const created = await getShippingZone(db_1.pool, inserted.insertId);
    if (!created)
        throw new ShippingZoneError(500, "No se pudo leer la zona creada.");
    return created;
}
async function updateShippingZone(userId, id, input) {
    const data = normalizeShippingZoneInput(input);
    const updated = await (0, db_1.qRun)(db_1.pool, `UPDATE envio_zonas
     SET nombre = ?, descripcion = ?, precio = ?, prioridad = ?, color = ?,
         polygon_geojson = ?, activo = ?, updated_by = ?
     WHERE id = ?`, [
        data.nombre,
        data.descripcion,
        data.precio,
        data.prioridad,
        data.color,
        JSON.stringify(data.polygon_geojson),
        data.activo ? 1 : 0,
        userId,
        id,
    ]);
    if (updated.affectedRows === 0) {
        throw new ShippingZoneError(404, "Zona de envio no encontrada.");
    }
    const zone = await getShippingZone(db_1.pool, id);
    if (!zone)
        throw new ShippingZoneError(500, "No se pudo leer la zona actualizada.");
    return zone;
}
async function setShippingZoneActive(userId, id, activo) {
    const updated = await (0, db_1.qRun)(db_1.pool, "UPDATE envio_zonas SET activo = ?, updated_by = ? WHERE id = ?", [activo ? 1 : 0, userId, id]);
    if (updated.affectedRows === 0) {
        throw new ShippingZoneError(404, "Zona de envio no encontrada.");
    }
    const zone = await getShippingZone(db_1.pool, id);
    if (!zone)
        throw new ShippingZoneError(500, "No se pudo leer la zona actualizada.");
    return zone;
}
function pointOnSegment(point, start, end) {
    const [px, py] = point;
    const [x1, y1] = start;
    const [x2, y2] = end;
    const cross = (py - y1) * (x2 - x1) - (px - x1) * (y2 - y1);
    if (Math.abs(cross) > POINT_EPSILON)
        return false;
    const dot = (px - x1) * (px - x2) + (py - y1) * (py - y2);
    return dot <= POINT_EPSILON;
}
function pointInRing(point, ring) {
    if (ring.length < 4)
        return false;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const current = ring[i];
        const previous = ring[j];
        if (pointOnSegment(point, previous, current))
            return true;
        const intersects = current[1] > point[1] !== previous[1] > point[1] &&
            point[0] < ((previous[0] - current[0]) * (point[1] - current[1])) / (previous[1] - current[1]) + current[0];
        if (intersects)
            inside = !inside;
    }
    return inside;
}
function pointInPolygon(lat, lng, polygon) {
    const point = [lng, lat];
    const [outer, ...holes] = polygon.coordinates;
    if (!outer || !pointInRing(point, outer))
        return false;
    return !holes.some((ring) => pointInRing(point, ring));
}
async function quoteShippingForCoordinates(conn, lat, lng) {
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
        throw new ShippingZoneError(400, "Coordenadas de envio invalidas.");
    }
    const rows = await (0, db_1.qAll)(conn, `SELECT id, nombre, descripcion, precio, prioridad, color, polygon_geojson, activo,
            created_by, updated_by, created_at, updated_at
     FROM envio_zonas
     WHERE activo = 1
     ORDER BY prioridad DESC, id ASC`);
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
function buildShippingQuoteSnapshot(quote) {
    if (!quote.disponible || !quote.zona)
        return null;
    return {
        zona_id: quote.zona.id,
        zona_nombre: quote.zona.nombre,
        costo_envio: quote.costo_envio,
        prioridad: quote.zona.prioridad,
    };
}
