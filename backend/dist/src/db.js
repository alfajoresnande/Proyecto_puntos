"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
exports.qAll = qAll;
exports.qOne = qOne;
exports.qRun = qRun;
require("dotenv/config");
const crypto_1 = require("crypto");
const promise_1 = __importDefault(require("mysql2/promise"));
const IS_PRODUCTION = (process.env.NODE_ENV || "").trim().toLowerCase() === "production";
const WEAK_DB_PASSWORDS = new Set(["", "password", "123456", "nande_password"]);
const WEAK_DB_USERS = new Set(["root", "admin", "nande_user"]);
function readDbEnv(name, fallbackForDev) {
    const value = (process.env[name] || "").trim();
    if (value)
        return value;
    if (IS_PRODUCTION) {
        throw new Error(`${name} no configurado. Definilo en backend/.env antes de iniciar en produccion.`);
    }
    return fallbackForDev;
}
function parseDbPort(raw) {
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
        if (IS_PRODUCTION) {
            throw new Error(`MYSQL_PORT invalido: '${raw}'. Debe estar entre 1 y 65535.`);
        }
        return 3306;
    }
    return parsed;
}
function parseMysqlSslMode() {
    const mode = (process.env.MYSQL_SSL_MODE || "").trim().toLowerCase();
    if (!mode || mode === "off" || mode === "false" || mode === "disabled")
        return undefined;
    if (mode === "required" || mode === "require" || mode === "preferred") {
        return { rejectUnauthorized: false };
    }
    if (mode === "verify-ca" || mode === "verify-full" || mode === "verify_identity") {
        return { rejectUnauthorized: true };
    }
    if (IS_PRODUCTION) {
        throw new Error(`MYSQL_SSL_MODE invalido: '${mode}'. Usa off|required|verify-ca.`);
    }
    return undefined;
}
const dbHost = readDbEnv("MYSQL_HOST", "localhost");
const dbPort = parseDbPort(readDbEnv("MYSQL_PORT", "3306"));
const dbName = readDbEnv("MYSQL_DATABASE", "nande_puntos");
const dbUser = readDbEnv("MYSQL_USER", "nande_user");
const dbPassword = readDbEnv("MYSQL_PASSWORD", "nande_password");
const dbSsl = parseMysqlSslMode();
if (IS_PRODUCTION) {
    if (WEAK_DB_PASSWORDS.has(dbPassword.toLowerCase())) {
        throw new Error("MYSQL_PASSWORD debil o por defecto detectado. Configura una clave fuerte para produccion.");
    }
    if (WEAK_DB_USERS.has(dbUser.toLowerCase())) {
        throw new Error("MYSQL_USER inseguro para produccion. Crea un usuario dedicado con privilegios minimos.");
    }
}
exports.pool = promise_1.default.createPool({
    host: dbHost,
    port: dbPort,
    database: dbName,
    user: dbUser,
    password: dbPassword,
    ssl: dbSsl,
    charset: "utf8mb4", /* ← codificación para tildes y ñ */
    waitForConnections: true,
    connectionLimit: 10,
    multipleStatements: false,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,
    timezone: "Z",
});
const REDEEM_CODE_LENGTH = 9;
const REDEEM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function makeRandomRedeemCode() {
    let code = "";
    for (let i = 0; i < REDEEM_CODE_LENGTH; i += 1) {
        code += REDEEM_CODE_CHARS[(0, crypto_1.randomInt)(REDEEM_CODE_CHARS.length)];
    }
    return code;
}
function isLegacyRedeemCode(code) {
    if (!code || code.length !== REDEEM_CODE_LENGTH)
        return true;
    return /^C0{2,}[A-Z0-9]*$/.test(code);
}
async function ensureUsuarioTelefonoSchema() {
    const [colRows] = await exports.pool.query(`SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'telefono'
     LIMIT 1`);
    if (!colRows.length) {
        await exports.pool.query("ALTER TABLE usuarios ADD COLUMN telefono VARCHAR(25) NULL AFTER dni");
    }
}
async function ensureUsuarioDemographicsSchema() {
    const [fechaRows] = await exports.pool.query(`SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'fecha_nacimiento'
     LIMIT 1`);
    if (!fechaRows.length) {
        await exports.pool.query("ALTER TABLE usuarios ADD COLUMN fecha_nacimiento DATE NULL AFTER telefono");
    }
    const [localidadRows] = await exports.pool.query(`SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'localidad'
     LIMIT 1`);
    if (!localidadRows.length) {
        await exports.pool.query("ALTER TABLE usuarios ADD COLUMN localidad VARCHAR(120) NULL AFTER fecha_nacimiento");
    }
    const [provinciaRows] = await exports.pool.query(`SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'provincia'
     LIMIT 1`);
    if (!provinciaRows.length) {
        await exports.pool.query("ALTER TABLE usuarios ADD COLUMN provincia VARCHAR(120) NULL AFTER localidad");
    }
}
async function ensureCanjeRedeemCodeSchema() {
    // Agrega la columna si no existe, o expande a VARCHAR(50) para que quepan los updates
    const [colRows] = await exports.pool.query(`SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'canjes' AND COLUMN_NAME = 'codigo_retiro'
     LIMIT 1`);
    if (!colRows.length) {
        await exports.pool.query("ALTER TABLE canjes ADD COLUMN codigo_retiro VARCHAR(50) NULL AFTER producto_id");
    }
    else {
        // Expande temporalmente para poder escribir sin importar el tamaño actual
        await exports.pool.query("ALTER TABLE canjes MODIFY COLUMN codigo_retiro VARCHAR(50) NULL");
    }
    // Asigna códigos random a los canjes que tienen código legacy o vacío
    const [codeRows] = await exports.pool.query("SELECT id, codigo_retiro FROM canjes");
    const usedCodes = new Set(codeRows
        .map((r) => r.codigo_retiro)
        .filter((c) => Boolean(c) && !isLegacyRedeemCode(c)));
    for (const row of codeRows) {
        if (!isLegacyRedeemCode(row.codigo_retiro))
            continue;
        let code = makeRandomRedeemCode();
        while (usedCodes.has(code))
            code = makeRandomRedeemCode();
        usedCodes.add(code);
        await exports.pool.query("UPDATE canjes SET codigo_retiro = ? WHERE id = ?", [code, row.id]);
    }
    // Ajuste de schema — no crítico, se ignora si falla
    try {
        await exports.pool.query("ALTER TABLE canjes MODIFY COLUMN codigo_retiro VARCHAR(9) NOT NULL");
    }
    catch { /* ya estaba bien o los datos no lo permiten aún */ }
    try {
        const [idxRows] = await exports.pool.query(`SELECT 1 FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'canjes'
         AND INDEX_NAME = 'uq_canjes_codigo_retiro' LIMIT 1`);
        if (!idxRows.length) {
            await exports.pool.query("ALTER TABLE canjes ADD UNIQUE INDEX uq_canjes_codigo_retiro (codigo_retiro)");
        }
    }
    catch { /* índice ya existe con otro nombre */ }
}
async function ensureCanjeItemsSchema() {
    await exports.pool.query(`CREATE TABLE IF NOT EXISTS canje_items (
      id INT PRIMARY KEY AUTO_INCREMENT,
      canje_id INT NOT NULL,
      producto_id INT NOT NULL,
      cantidad INT NOT NULL DEFAULT 1,
      puntos_unitarios INT NOT NULL,
      puntos_total INT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_canje_items_canje
        FOREIGN KEY (canje_id) REFERENCES canjes(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_canje_items_producto
        FOREIGN KEY (producto_id) REFERENCES productos(id)
        ON DELETE RESTRICT,
      CONSTRAINT uq_canje_items_producto
        UNIQUE (canje_id, producto_id)
    )`);
    await exports.pool.query(`INSERT INTO canje_items (canje_id, producto_id, cantidad, puntos_unitarios, puntos_total)
     SELECT c.id,
            c.producto_id,
            1,
            COALESCE(NULLIF(p.puntos_requeridos, 0), c.puntos_usados),
            c.puntos_usados
     FROM canjes c
     LEFT JOIN productos p ON p.id = c.producto_id
     LEFT JOIN canje_items ci ON ci.canje_id = c.id
     WHERE ci.id IS NULL`);
}
async function ensureProductoImagenesSchema() {
    await exports.pool.query(`CREATE TABLE IF NOT EXISTS producto_imagenes (
      id INT PRIMARY KEY AUTO_INCREMENT,
      producto_id INT NOT NULL,
      imagen_url VARCHAR(255) NOT NULL,
      orden TINYINT UNSIGNED NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_producto_imagenes_producto
        FOREIGN KEY (producto_id) REFERENCES productos(id)
        ON DELETE CASCADE,
      CONSTRAINT uq_producto_imagen_orden
        UNIQUE (producto_id, orden)
    )`);
    const [legacyRows] = await exports.pool.query(`SELECT p.id, p.imagen_url
     FROM productos p
     LEFT JOIN (
       SELECT producto_id, COUNT(*) AS c
       FROM producto_imagenes
       GROUP BY producto_id
     ) pi ON pi.producto_id = p.id
     WHERE p.imagen_url IS NOT NULL
       AND TRIM(p.imagen_url) <> ''
       AND COALESCE(pi.c, 0) = 0`);
    for (const row of legacyRows) {
        await exports.pool.query("INSERT INTO producto_imagenes (producto_id, imagen_url, orden) VALUES (?, ?, 1)", [row.id, row.imagen_url.trim()]);
    }
}
async function ensureSucursalesSchema() {
    await exports.pool.query(`CREATE TABLE IF NOT EXISTS sucursales (
      id INT PRIMARY KEY AUTO_INCREMENT,
      nombre VARCHAR(120) NOT NULL,
      direccion VARCHAR(180) NOT NULL,
      piso VARCHAR(30) NULL,
      localidad VARCHAR(120) NOT NULL,
      provincia VARCHAR(120) NOT NULL,
      activo TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);
    const [colRows] = await exports.pool.query(`SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'canjes' AND COLUMN_NAME = 'sucursal_id'
     LIMIT 1`);
    if (!colRows.length) {
        await exports.pool.query("ALTER TABLE canjes ADD COLUMN sucursal_id INT NULL AFTER producto_id");
    }
    try {
        const [idxRows] = await exports.pool.query(`SELECT 1 FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'canjes'
         AND INDEX_NAME = 'idx_canjes_sucursal_id' LIMIT 1`);
        if (!idxRows.length) {
            await exports.pool.query("ALTER TABLE canjes ADD INDEX idx_canjes_sucursal_id (sucursal_id)");
        }
    }
    catch {
        // No-op
    }
    try {
        const [fkRows] = await exports.pool.query(`SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'canjes'
         AND CONSTRAINT_NAME = 'fk_canje_sucursal' LIMIT 1`);
        if (!fkRows.length) {
            await exports.pool.query(`ALTER TABLE canjes
         ADD CONSTRAINT fk_canje_sucursal
         FOREIGN KEY (sucursal_id) REFERENCES sucursales(id)
         ON DELETE SET NULL
         ON UPDATE CASCADE`);
        }
    }
    catch {
        // No-op
    }
    const [countRows] = await exports.pool.query("SELECT COUNT(*) AS c FROM sucursales");
    const totalSucursales = Number(countRows?.[0]?.c ?? 0);
    if (totalSucursales === 0) {
        const [cfgRows] = await exports.pool.query("SELECT valor FROM configuracion WHERE clave = 'lugar_retiro_canje' LIMIT 1");
        const direccionBase = cfgRows?.[0]?.valor?.trim() || "Direccion a definir";
        await exports.pool.query(`INSERT INTO sucursales (nombre, direccion, piso, localidad, provincia, activo)
       VALUES (?, ?, ?, ?, ?, 1)`, ["Sucursal principal", direccionBase, null, "No informado", "No informado"]);
    }
    const [activeRows] = await exports.pool.query("SELECT COUNT(*) AS c FROM sucursales WHERE activo = 1");
    const totalActivas = Number(activeRows?.[0]?.c ?? 0);
    if (totalActivas === 0) {
        await exports.pool.query("UPDATE sucursales SET activo = 1 WHERE id = (SELECT id FROM (SELECT id FROM sucursales ORDER BY id ASC LIMIT 1) t)");
    }
}
async function ensureProductosEcommerceSchema() {
    const [tipoColRows] = await exports.pool.query(`SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'tipo_producto'
     LIMIT 1`);
    if (!tipoColRows.length) {
        await exports.pool.query("ALTER TABLE productos ADD COLUMN tipo_producto ENUM('canje','venta','mixto') NOT NULL DEFAULT 'canje' AFTER categoria");
    }
    const [precioDineroRows] = await exports.pool.query(`SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'precio_dinero'
     LIMIT 1`);
    if (!precioDineroRows.length) {
        await exports.pool.query("ALTER TABLE productos ADD COLUMN precio_dinero DECIMAL(10,2) NULL AFTER puntos_acumulables");
    }
    const [precioPuntosRows] = await exports.pool.query(`SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'precio_puntos'
     LIMIT 1`);
    if (!precioPuntosRows.length) {
        await exports.pool.query("ALTER TABLE productos ADD COLUMN precio_puntos INT NULL AFTER precio_dinero");
    }
    const [stockRows] = await exports.pool.query(`SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'stock_disponible'
     LIMIT 1`);
    if (!stockRows.length) {
        await exports.pool.query("ALTER TABLE productos ADD COLUMN stock_disponible INT NOT NULL DEFAULT 0 AFTER precio_puntos");
    }
    const [stockReservadoRows] = await exports.pool.query(`SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'stock_reservado'
     LIMIT 1`);
    if (!stockReservadoRows.length) {
        await exports.pool.query("ALTER TABLE productos ADD COLUMN stock_reservado INT NOT NULL DEFAULT 0 AFTER stock_disponible");
    }
    const [trackRows] = await exports.pool.query(`SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'track_stock'
     LIMIT 1`);
    if (!trackRows.length) {
        await exports.pool.query("ALTER TABLE productos ADD COLUMN track_stock TINYINT(1) NOT NULL DEFAULT 1 AFTER stock_reservado");
    }
    const [permiteEnvioRows] = await exports.pool.query(`SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'permite_envio'
     LIMIT 1`);
    if (!permiteEnvioRows.length) {
        await exports.pool.query("ALTER TABLE productos ADD COLUMN permite_envio TINYINT(1) NOT NULL DEFAULT 0 AFTER track_stock");
    }
    const [permiteRetiroRows] = await exports.pool.query(`SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'permite_retiro_local'
     LIMIT 1`);
    if (!permiteRetiroRows.length) {
        await exports.pool.query("ALTER TABLE productos ADD COLUMN permite_retiro_local TINYINT(1) NOT NULL DEFAULT 1 AFTER permite_envio");
    }
    const [skuRows] = await exports.pool.query(`SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'sku'
     LIMIT 1`);
    if (!skuRows.length) {
        await exports.pool.query("ALTER TABLE productos ADD COLUMN sku VARCHAR(64) NULL AFTER nombre");
    }
    const [updatedRows] = await exports.pool.query(`SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'updated_at'
     LIMIT 1`);
    if (!updatedRows.length) {
        await exports.pool.query("ALTER TABLE productos ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at");
    }
    await exports.pool.query("UPDATE productos SET precio_puntos = puntos_requeridos WHERE precio_puntos IS NULL");
    const [puntosCanjearRows] = await exports.pool.query(`SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'puntos_para_canjear'
     LIMIT 1`);
    if (!puntosCanjearRows.length) {
        await exports.pool.query("ALTER TABLE productos ADD COLUMN puntos_para_canjear INT NULL AFTER precio_puntos");
    }
    const [puntajeComprarRows] = await exports.pool.query(`SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'puntaje_al_comprar'
     LIMIT 1`);
    if (!puntajeComprarRows.length) {
        await exports.pool.query("ALTER TABLE productos ADD COLUMN puntaje_al_comprar INT NULL AFTER puntos_para_canjear");
    }
    await exports.pool.query("UPDATE productos SET puntos_para_canjear = COALESCE(puntos_para_canjear, precio_puntos, puntos_requeridos)");
    await exports.pool.query("UPDATE productos SET puntaje_al_comprar = COALESCE(puntaje_al_comprar, puntos_acumulables)");
    try {
        const [skuIdxRows] = await exports.pool.query(`SELECT 1 FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos'
         AND INDEX_NAME = 'uq_productos_sku' LIMIT 1`);
        if (!skuIdxRows.length) {
            await exports.pool.query("ALTER TABLE productos ADD UNIQUE INDEX uq_productos_sku (sku)");
        }
    }
    catch {
        // No-op
    }
}
async function ensureInventarioSucursalSchema() {
    await exports.pool.query(`CREATE TABLE IF NOT EXISTS inventario_sucursal (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      producto_id INT NOT NULL,
      sucursal_id INT NOT NULL,
      stock_disponible INT NOT NULL DEFAULT 0,
      stock_reservado INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_inventario_producto
        FOREIGN KEY (producto_id) REFERENCES productos(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_inventario_sucursal
        FOREIGN KEY (sucursal_id) REFERENCES sucursales(id)
        ON DELETE CASCADE,
      CONSTRAINT uq_inventario_producto_sucursal
        UNIQUE (producto_id, sucursal_id)
    )`);
}
async function ensureOrderCoreSchema() {
    await exports.pool.query(`CREATE TABLE IF NOT EXISTS carritos (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      usuario_id INT NOT NULL,
      estado ENUM('activo','convertido','abandonado') NOT NULL DEFAULT 'activo',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_carrito_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        ON DELETE CASCADE,
      INDEX idx_carritos_usuario_estado (usuario_id, estado, updated_at)
    )`);
    await exports.pool.query(`CREATE TABLE IF NOT EXISTS carrito_items (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      carrito_id BIGINT UNSIGNED NOT NULL,
      producto_id INT NOT NULL,
      cantidad INT NOT NULL DEFAULT 1,
      modo_compra ENUM('dinero','puntos') NOT NULL,
      precio_dinero_unit DECIMAL(10,2) NULL,
      precio_puntos_unit INT NULL,
      subtotal_dinero DECIMAL(10,2) NOT NULL DEFAULT 0,
      subtotal_puntos INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_carrito_items_carrito
        FOREIGN KEY (carrito_id) REFERENCES carritos(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_carrito_items_producto
        FOREIGN KEY (producto_id) REFERENCES productos(id)
        ON DELETE RESTRICT,
      CONSTRAINT uq_carrito_item_producto_modo
        UNIQUE (carrito_id, producto_id, modo_compra)
    )`);
    await exports.pool.query(`CREATE TABLE IF NOT EXISTS ordenes (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      usuario_id INT NOT NULL,
      carrito_id BIGINT UNSIGNED NULL,
      canal ENUM('web','admin','vendedor') NOT NULL DEFAULT 'web',
      tipo_orden ENUM('canje','venta','mixta') NOT NULL DEFAULT 'canje',
      estado ENUM('borrador','pendiente_pago','pagada','preparada','entregada','cancelada','expirada')
        NOT NULL DEFAULT 'borrador',
      moneda VARCHAR(8) NOT NULL DEFAULT 'ARS',
      total_dinero DECIMAL(10,2) NOT NULL DEFAULT 0,
      total_puntos INT NOT NULL DEFAULT 0,
      direccion_envio_json JSON NULL,
      sucursal_retiro_id INT NULL,
      notas TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_orden_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        ON DELETE RESTRICT,
      CONSTRAINT fk_orden_carrito
        FOREIGN KEY (carrito_id) REFERENCES carritos(id)
        ON DELETE SET NULL,
      CONSTRAINT fk_orden_sucursal
        FOREIGN KEY (sucursal_retiro_id) REFERENCES sucursales(id)
        ON DELETE SET NULL,
      INDEX idx_ordenes_usuario_created_at (usuario_id, created_at),
      INDEX idx_ordenes_estado_created_at (estado, created_at)
    )`);
    await exports.pool.query(`CREATE TABLE IF NOT EXISTS orden_items (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      orden_id BIGINT UNSIGNED NOT NULL,
      producto_id INT NOT NULL,
      cantidad INT NOT NULL DEFAULT 1,
      modo_compra ENUM('dinero','puntos') NOT NULL,
      precio_dinero_unit DECIMAL(10,2) NULL,
      precio_puntos_unit INT NULL,
      subtotal_dinero DECIMAL(10,2) NOT NULL DEFAULT 0,
      subtotal_puntos INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_orden_items_orden
        FOREIGN KEY (orden_id) REFERENCES ordenes(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_orden_items_producto
        FOREIGN KEY (producto_id) REFERENCES productos(id)
        ON DELETE RESTRICT,
      CONSTRAINT uq_orden_item_producto_modo
        UNIQUE (orden_id, producto_id, modo_compra)
    )`);
    await exports.pool.query(`CREATE TABLE IF NOT EXISTS pagos (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      orden_id BIGINT UNSIGNED NOT NULL,
      proveedor VARCHAR(40) NOT NULL,
      estado ENUM('iniciado','aprobado','rechazado','reembolsado') NOT NULL DEFAULT 'iniciado',
      monto DECIMAL(10,2) NOT NULL,
      moneda VARCHAR(8) NOT NULL DEFAULT 'ARS',
      provider_payment_id VARCHAR(120) NULL,
      payload_json JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_pagos_orden
        FOREIGN KEY (orden_id) REFERENCES ordenes(id)
        ON DELETE CASCADE,
      INDEX idx_pagos_orden_estado (orden_id, estado),
      INDEX idx_pagos_provider_id (provider_payment_id)
    )`);
    await exports.pool.query(`CREATE TABLE IF NOT EXISTS movimientos_stock (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      producto_id INT NOT NULL,
      sucursal_id INT NULL,
      orden_id BIGINT UNSIGNED NULL,
      tipo ENUM('ingreso','reserva','liberacion','descuento','ajuste') NOT NULL,
      origen ENUM('compra','canje','admin','devolucion') NOT NULL,
      cantidad INT NOT NULL,
      descripcion VARCHAR(255) NULL,
      creado_por INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_mov_stock_producto
        FOREIGN KEY (producto_id) REFERENCES productos(id)
        ON DELETE RESTRICT,
      CONSTRAINT fk_mov_stock_sucursal
        FOREIGN KEY (sucursal_id) REFERENCES sucursales(id)
        ON DELETE SET NULL,
      CONSTRAINT fk_mov_stock_orden
        FOREIGN KEY (orden_id) REFERENCES ordenes(id)
        ON DELETE SET NULL,
      CONSTRAINT fk_mov_stock_creado_por
        FOREIGN KEY (creado_por) REFERENCES usuarios(id)
        ON DELETE SET NULL,
      INDEX idx_mov_stock_producto_fecha (producto_id, created_at),
      INDEX idx_mov_stock_orden (orden_id)
    )`);
}
async function ensurePagosCheckoutSchema() {
    const [methodRows] = await exports.pool.query(`SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pagos' AND COLUMN_NAME = 'metodo'
     LIMIT 1`);
    if (!methodRows.length) {
        await exports.pool.query("ALTER TABLE pagos ADD COLUMN metodo VARCHAR(40) NULL AFTER proveedor");
    }
    const [checkoutUrlRows] = await exports.pool.query(`SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pagos' AND COLUMN_NAME = 'checkout_url'
     LIMIT 1`);
    if (!checkoutUrlRows.length) {
        await exports.pool.query("ALTER TABLE pagos ADD COLUMN checkout_url VARCHAR(500) NULL AFTER provider_payment_id");
    }
    try {
        const [idxRows] = await exports.pool.query(`SELECT 1 FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pagos'
         AND INDEX_NAME = 'idx_pagos_proveedor_metodo'
       LIMIT 1`);
        if (!idxRows.length) {
            await exports.pool.query("ALTER TABLE pagos ADD INDEX idx_pagos_proveedor_metodo (proveedor, metodo)");
        }
    }
    catch {
        // No-op
    }
}
async function ensureEventosSeguridadSchema() {
    await exports.pool.query(`CREATE TABLE IF NOT EXISTS eventos_seguridad (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      evento VARCHAR(120) NOT NULL,
      ip VARCHAR(64) NOT NULL,
      metodo VARCHAR(12) NOT NULL,
      ruta VARCHAR(255) NOT NULL,
      origen VARCHAR(255) NOT NULL,
      agente_usuario VARCHAR(255) NOT NULL,
      detalles_json JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_eventos_seguridad_created_at (created_at),
      INDEX idx_eventos_seguridad_evento_created_at (evento, created_at),
      INDEX idx_eventos_seguridad_ip_created_at (ip, created_at)
    )`);
}
exports.pool
    .getConnection()
    .then(async (conn) => {
    console.log("✅ MySQL conectado");
    conn.release();
    try {
        await ensureUsuarioTelefonoSchema();
    }
    catch (err) {
        console.error("Migracion telefono:", err.message);
    }
    try {
        await ensureUsuarioDemographicsSchema();
    }
    catch (err) {
        console.error("Migracion datos demograficos de usuarios:", err.message);
    }
    try {
        await ensureCanjeRedeemCodeSchema();
    }
    catch (err) {
        console.error("⚠️  Migración códigos de canje:", err.message);
    }
    try {
        await ensureCanjeItemsSchema();
    }
    catch (err) {
        console.error("⚠️  Migración detalle de canjes:", err.message);
    }
    try {
        await ensureProductoImagenesSchema();
    }
    catch (err) {
        console.error("⚠️  Migración imágenes de productos:", err.message);
    }
    try {
        await ensureSucursalesSchema();
    }
    catch (err) {
        console.error("⚠️  Migración sucursales:", err.message);
    }
    try {
        await ensureProductosEcommerceSchema();
    }
    catch (err) {
        console.error("⚠️  Migración productos e-commerce:", err.message);
    }
    try {
        await ensureInventarioSucursalSchema();
    }
    catch (err) {
        console.error("⚠️  Migración inventario por sucursal:", err.message);
    }
    try {
        await ensureOrderCoreSchema();
    }
    catch (err) {
        console.error("⚠️  Migración carrito/ordenes/pagos:", err.message);
    }
    try {
        await ensurePagosCheckoutSchema();
    }
    catch (err) {
        console.error("⚠️  Migración columnas de pagos checkout:", err.message);
    }
    try {
        await ensureEventosSeguridadSchema();
    }
    catch (err) {
        console.error("⚠️  Migración eventos de seguridad:", err.message);
    }
})
    .catch((err) => {
    // No detenemos el proceso: permitimos que /diagnostico reporte estado degradado.
    console.error("❌ MySQL:", err.message);
});
/** Devuelve todas las filas de un SELECT */
async function qAll(q, sql, params) {
    const [rows] = await q.query(sql, params);
    return rows;
}
/** Devuelve la primera fila de un SELECT (o undefined) */
async function qOne(q, sql, params) {
    const [rows] = await q.query(sql, params);
    return rows[0];
}
/** Ejecuta INSERT/UPDATE/DELETE y devuelve insertId y affectedRows */
async function qRun(q, sql, params) {
    const [result] = await q.query(sql, params);
    return { insertId: result.insertId ?? 0, affectedRows: result.affectedRows ?? 0 };
}
