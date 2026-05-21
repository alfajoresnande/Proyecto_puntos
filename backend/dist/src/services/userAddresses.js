"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserAddressError = void 0;
exports.normalizeUserAddressInput = normalizeUserAddressInput;
exports.buildAddressSnapshot = buildAddressSnapshot;
exports.listUserAddresses = listUserAddresses;
exports.getUserAddress = getUserAddress;
exports.createUserAddress = createUserAddress;
exports.updateUserAddress = updateUserAddress;
exports.deactivateUserAddress = deactivateUserAddress;
exports.setDefaultUserAddress = setDefaultUserAddress;
const db_1 = require("../db");
class UserAddressError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
exports.UserAddressError = UserAddressError;
const ALLOWED_PROVIDERS = new Set(["manual", "geoapify", "google"]);
const PHONE_RE = /^[0-9+\-().\s]{6,40}$/;
function asDateString(value) {
    if (value instanceof Date)
        return value.toISOString();
    return typeof value === "string" ? value : String(value ?? "");
}
function parseProviderRawJson(value) {
    if (!value)
        return null;
    if (typeof value === "object")
        return value;
    try {
        return JSON.parse(value);
    }
    catch {
        return null;
    }
}
function mapAddress(row) {
    return {
        ...row,
        id: Number(row.id),
        usuario_id: Number(row.usuario_id),
        lat: Number(row.lat),
        lng: Number(row.lng),
        provider_raw_json: parseProviderRawJson(row.provider_raw_json),
        es_predeterminada: Boolean(row.es_predeterminada),
        activo: Boolean(row.activo),
        created_at: asDateString(row.created_at),
        updated_at: asDateString(row.updated_at),
    };
}
function cleanOptional(value, max, field) {
    if (value === undefined || value === null)
        return null;
    const text = String(value).trim();
    if (!text)
        return null;
    if (text.length > max) {
        throw new UserAddressError(400, `${field} no puede superar ${max} caracteres.`);
    }
    return text;
}
function cleanRequired(value, max, field) {
    const text = cleanOptional(value, max, field);
    if (!text) {
        throw new UserAddressError(400, `${field} es obligatorio.`);
    }
    return text;
}
function normalizeProvider(value) {
    const provider = (typeof value === "string" && value.trim() ? value.trim() : "manual");
    if (!ALLOWED_PROVIDERS.has(provider)) {
        throw new UserAddressError(400, "Proveedor de ubicacion invalido.");
    }
    return provider;
}
function normalizeCoordinate(value, min, max, field) {
    const coordinate = Number(value);
    if (!Number.isFinite(coordinate) || coordinate < min || coordinate > max) {
        throw new UserAddressError(400, `${field} debe ser una coordenada valida.`);
    }
    return coordinate;
}
function normalizeProviderRawJson(value) {
    if (value === undefined || value === null || value === "")
        return null;
    let serialized = "";
    try {
        serialized = JSON.stringify(value);
    }
    catch {
        throw new UserAddressError(400, "La respuesta cruda del proveedor no es JSON valido.");
    }
    if (!serialized || serialized.length > 12000) {
        throw new UserAddressError(400, "La respuesta cruda del proveedor es demasiado grande.");
    }
    return value;
}
function normalizeUserAddressInput(input) {
    const receptorTelefono = cleanOptional(input.receptor_telefono, 40, "Telefono");
    if (receptorTelefono && !PHONE_RE.test(receptorTelefono)) {
        throw new UserAddressError(400, "Telefono invalido.");
    }
    return {
        alias: cleanOptional(input.alias, 80, "Alias"),
        receptor_nombre: cleanOptional(input.receptor_nombre, 120, "Nombre de quien recibe"),
        receptor_telefono: receptorTelefono,
        direccion_formateada: cleanRequired(input.direccion_formateada, 255, "Direccion formateada"),
        calle: cleanOptional(input.calle, 140, "Calle"),
        numero: cleanOptional(input.numero, 30, "Numero"),
        piso_departamento: cleanOptional(input.piso_departamento, 80, "Piso/departamento"),
        barrio: cleanOptional(input.barrio, 120, "Barrio"),
        localidad: cleanOptional(input.localidad, 120, "Localidad"),
        provincia: cleanOptional(input.provincia, 120, "Provincia"),
        codigo_postal: cleanOptional(input.codigo_postal, 20, "Codigo postal"),
        pais: cleanOptional(input.pais, 80, "Pais") ?? "Argentina",
        lat: normalizeCoordinate(input.lat, -90, 90, "Latitud"),
        lng: normalizeCoordinate(input.lng, -180, 180, "Longitud"),
        provider: normalizeProvider(input.provider),
        provider_place_id: cleanOptional(input.provider_place_id, 255, "ID del lugar"),
        provider_raw_json: normalizeProviderRawJson(input.provider_raw_json),
        instrucciones_entrega: cleanOptional(input.instrucciones_entrega, 1000, "Instrucciones de entrega"),
        es_predeterminada: Boolean(input.es_predeterminada),
    };
}
function buildAddressSnapshot(address) {
    return {
        id: address.id,
        alias: address.alias,
        receptor_nombre: address.receptor_nombre,
        receptor_telefono: address.receptor_telefono,
        direccion_formateada: address.direccion_formateada,
        nombre: address.receptor_nombre,
        telefono: address.receptor_telefono,
        direccion: address.direccion_formateada,
        calle: address.calle,
        numero: address.numero,
        piso_departamento: address.piso_departamento,
        barrio: address.barrio,
        localidad: address.localidad,
        provincia: address.provincia,
        codigo_postal: address.codigo_postal,
        pais: address.pais,
        lat: address.lat,
        lng: address.lng,
        instrucciones_entrega: address.instrucciones_entrega,
        referencias: address.instrucciones_entrega,
    };
}
async function listUserAddresses(usuarioId) {
    const rows = await (0, db_1.qAll)(db_1.pool, `SELECT *
     FROM usuario_direcciones
     WHERE usuario_id = ? AND activo = 1
     ORDER BY es_predeterminada DESC, updated_at DESC, id DESC`, [usuarioId]);
    return rows.map(mapAddress);
}
async function getUserAddress(conn, usuarioId, addressId, activeOnly = true) {
    const row = await (0, db_1.qOne)(conn, `SELECT *
     FROM usuario_direcciones
     WHERE id = ? AND usuario_id = ?${activeOnly ? " AND activo = 1" : ""}
     LIMIT 1`, [addressId, usuarioId]);
    return row ? mapAddress(row) : null;
}
async function assignFallbackDefault(conn, usuarioId) {
    const fallback = await (0, db_1.qOne)(conn, `SELECT id
     FROM usuario_direcciones
     WHERE usuario_id = ? AND activo = 1
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`, [usuarioId]);
    if (fallback?.id) {
        await (0, db_1.qRun)(conn, "UPDATE usuario_direcciones SET es_predeterminada = 1 WHERE id = ?", [fallback.id]);
    }
}
async function lockUserAddressBook(conn, usuarioId) {
    const user = await (0, db_1.qOne)(conn, "SELECT id FROM usuarios WHERE id = ? LIMIT 1 FOR UPDATE", [usuarioId]);
    if (!user) {
        throw new UserAddressError(404, "Usuario no encontrado.");
    }
}
async function createUserAddress(usuarioId, input) {
    const data = normalizeUserAddressInput(input);
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        await lockUserAddressBook(conn, usuarioId);
        const activeRows = await (0, db_1.qAll)(conn, `SELECT id
       FROM usuario_direcciones
       WHERE usuario_id = ? AND activo = 1
       FOR UPDATE`, [usuarioId]);
        const shouldBeDefault = activeRows.length === 0 || data.es_predeterminada;
        if (shouldBeDefault) {
            await (0, db_1.qRun)(conn, "UPDATE usuario_direcciones SET es_predeterminada = 0 WHERE usuario_id = ? AND activo = 1", [usuarioId]);
        }
        const inserted = await (0, db_1.qRun)(conn, `INSERT INTO usuario_direcciones (
         usuario_id, alias, receptor_nombre, receptor_telefono, direccion_formateada,
         calle, numero, piso_departamento, barrio, localidad, provincia, codigo_postal, pais,
         lat, lng, provider, provider_place_id, provider_raw_json, instrucciones_entrega,
         es_predeterminada, activo
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`, [
            usuarioId,
            data.alias,
            data.receptor_nombre,
            data.receptor_telefono,
            data.direccion_formateada,
            data.calle,
            data.numero,
            data.piso_departamento,
            data.barrio,
            data.localidad,
            data.provincia,
            data.codigo_postal,
            data.pais,
            data.lat,
            data.lng,
            data.provider,
            data.provider_place_id,
            data.provider_raw_json === null ? null : JSON.stringify(data.provider_raw_json),
            data.instrucciones_entrega,
            shouldBeDefault ? 1 : 0,
        ]);
        const created = await getUserAddress(conn, usuarioId, inserted.insertId);
        if (!created)
            throw new UserAddressError(500, "No se pudo leer la direccion creada.");
        await conn.commit();
        return created;
    }
    catch (error) {
        await conn.rollback();
        throw error;
    }
    finally {
        conn.release();
    }
}
async function updateUserAddress(usuarioId, addressId, input) {
    const data = normalizeUserAddressInput(input);
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        await lockUserAddressBook(conn, usuarioId);
        const current = await getUserAddress(conn, usuarioId, addressId);
        if (!current) {
            throw new UserAddressError(404, "Direccion no encontrada.");
        }
        if (data.es_predeterminada) {
            await (0, db_1.qRun)(conn, "UPDATE usuario_direcciones SET es_predeterminada = 0 WHERE usuario_id = ? AND activo = 1", [usuarioId]);
        }
        await (0, db_1.qRun)(conn, `UPDATE usuario_direcciones
       SET alias = ?,
           receptor_nombre = ?,
           receptor_telefono = ?,
           direccion_formateada = ?,
           calle = ?,
           numero = ?,
           piso_departamento = ?,
           barrio = ?,
           localidad = ?,
           provincia = ?,
           codigo_postal = ?,
           pais = ?,
           lat = ?,
           lng = ?,
           provider = ?,
           provider_place_id = ?,
           provider_raw_json = ?,
           instrucciones_entrega = ?,
           es_predeterminada = ?
       WHERE id = ? AND usuario_id = ? AND activo = 1`, [
            data.alias,
            data.receptor_nombre,
            data.receptor_telefono,
            data.direccion_formateada,
            data.calle,
            data.numero,
            data.piso_departamento,
            data.barrio,
            data.localidad,
            data.provincia,
            data.codigo_postal,
            data.pais,
            data.lat,
            data.lng,
            data.provider,
            data.provider_place_id,
            data.provider_raw_json === null ? null : JSON.stringify(data.provider_raw_json),
            data.instrucciones_entrega,
            data.es_predeterminada || current.es_predeterminada ? 1 : 0,
            addressId,
            usuarioId,
        ]);
        const updated = await getUserAddress(conn, usuarioId, addressId);
        if (!updated)
            throw new UserAddressError(500, "No se pudo leer la direccion actualizada.");
        await conn.commit();
        return updated;
    }
    catch (error) {
        await conn.rollback();
        throw error;
    }
    finally {
        conn.release();
    }
}
async function deactivateUserAddress(usuarioId, addressId) {
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        await lockUserAddressBook(conn, usuarioId);
        const current = await getUserAddress(conn, usuarioId, addressId);
        if (!current) {
            throw new UserAddressError(404, "Direccion no encontrada.");
        }
        await (0, db_1.qRun)(conn, "UPDATE usuario_direcciones SET activo = 0, es_predeterminada = 0 WHERE id = ? AND usuario_id = ?", [addressId, usuarioId]);
        if (current.es_predeterminada) {
            await assignFallbackDefault(conn, usuarioId);
        }
        await conn.commit();
        return { ok: true };
    }
    catch (error) {
        await conn.rollback();
        throw error;
    }
    finally {
        conn.release();
    }
}
async function setDefaultUserAddress(usuarioId, addressId) {
    const conn = await db_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        await lockUserAddressBook(conn, usuarioId);
        const current = await getUserAddress(conn, usuarioId, addressId);
        if (!current) {
            throw new UserAddressError(404, "Direccion no encontrada.");
        }
        await (0, db_1.qRun)(conn, "UPDATE usuario_direcciones SET es_predeterminada = 0 WHERE usuario_id = ? AND activo = 1", [usuarioId]);
        await (0, db_1.qRun)(conn, "UPDATE usuario_direcciones SET es_predeterminada = 1 WHERE id = ? AND usuario_id = ? AND activo = 1", [addressId, usuarioId]);
        const updated = await getUserAddress(conn, usuarioId, addressId);
        if (!updated)
            throw new UserAddressError(500, "No se pudo leer la direccion predeterminada.");
        await conn.commit();
        return updated;
    }
    catch (error) {
        await conn.rollback();
        throw error;
    }
    finally {
        conn.release();
    }
}
