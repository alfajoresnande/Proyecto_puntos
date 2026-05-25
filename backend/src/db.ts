import "dotenv/config";
import { randomInt } from "crypto";
import mysql, { Pool, PoolConnection } from "mysql2/promise";

const IS_PRODUCTION = (process.env.NODE_ENV || "").trim().toLowerCase() === "production";
const WEAK_DB_PASSWORDS = new Set(["", "password", "123456", "nande_password"]);
const WEAK_DB_USERS = new Set(["root", "admin", "nande_user"]);

function readDbEnv(name: string, fallbackForDev: string): string {
  const value = (process.env[name] || "").trim();
  if (value) return value;
  if (IS_PRODUCTION) {
    throw new Error(`${name} no configurado. Definilo en backend/.env antes de iniciar en produccion.`);
  }
  return fallbackForDev;
}

function parseDbPort(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    if (IS_PRODUCTION) {
      throw new Error(`MYSQL_PORT invalido: '${raw}'. Debe estar entre 1 y 65535.`);
    }
    return 3306;
  }
  return parsed;
}

function parseMysqlSslMode():
  | undefined
  | {
      rejectUnauthorized: boolean;
    } {
  const mode = (process.env.MYSQL_SSL_MODE || "").trim().toLowerCase();
  if (!mode || mode === "off" || mode === "false" || mode === "disabled") return undefined;
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

export const pool = mysql.createPool({
  host: dbHost,
  port: dbPort,
  database: dbName,
  user: dbUser,
  password: dbPassword,
  ssl: dbSsl,
  charset:  "utf8mb4",          /* ← codificación para tildes y ñ */
  waitForConnections: true,
  connectionLimit: 10,
  multipleStatements: false,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10_000,
  timezone: "Z",
});

const REDEEM_CODE_LENGTH = 9;
const REDEEM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeRandomRedeemCode(): string {
  let code = "";
  for (let i = 0; i < REDEEM_CODE_LENGTH; i += 1) {
    code += REDEEM_CODE_CHARS[randomInt(REDEEM_CODE_CHARS.length)];
  }
  return code;
}

function isLegacyRedeemCode(code: string | null | undefined): boolean {
  if (!code || code.length !== REDEEM_CODE_LENGTH) return true;
  return /^C0{2,}[A-Z0-9]*$/.test(code);
}

async function ensureUsuarioTelefonoSchema() {
  const [colRows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'telefono'
     LIMIT 1`
  ) as [any[], any[]];

  if (!colRows.length) {
    await pool.query("ALTER TABLE usuarios ADD COLUMN telefono VARCHAR(25) NULL AFTER dni");
  }
}

async function ensureUsuarioDemographicsSchema() {
  const [fechaRows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'fecha_nacimiento'
     LIMIT 1`
  ) as [any[], any[]];
  if (!fechaRows.length) {
    await pool.query("ALTER TABLE usuarios ADD COLUMN fecha_nacimiento DATE NULL AFTER telefono");
  }

  const [localidadRows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'localidad'
     LIMIT 1`
  ) as [any[], any[]];
  if (!localidadRows.length) {
    await pool.query("ALTER TABLE usuarios ADD COLUMN localidad VARCHAR(120) NULL AFTER fecha_nacimiento");
  }

  const [provinciaRows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'provincia'
     LIMIT 1`
  ) as [any[], any[]];
  if (!provinciaRows.length) {
    await pool.query("ALTER TABLE usuarios ADD COLUMN provincia VARCHAR(120) NULL AFTER localidad");
  }
}

async function ensureUsuarioDireccionesSchema() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS usuario_direcciones (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      usuario_id INT NOT NULL,
      alias VARCHAR(80) NULL,
      receptor_nombre VARCHAR(120) NULL,
      receptor_telefono VARCHAR(40) NULL,
      direccion_formateada VARCHAR(255) NOT NULL,
      calle VARCHAR(140) NULL,
      numero VARCHAR(30) NULL,
      piso_departamento VARCHAR(80) NULL,
      barrio VARCHAR(120) NULL,
      localidad VARCHAR(120) NULL,
      provincia VARCHAR(120) NULL,
      codigo_postal VARCHAR(20) NULL,
      pais VARCHAR(80) NOT NULL DEFAULT 'Argentina',
      lat DECIMAL(10,7) NOT NULL,
      lng DECIMAL(10,7) NOT NULL,
      provider ENUM('manual','geoapify','google') NOT NULL DEFAULT 'manual',
      provider_place_id VARCHAR(255) NULL,
      provider_raw_json JSON NULL,
      instrucciones_entrega TEXT NULL,
      es_predeterminada TINYINT(1) NOT NULL DEFAULT 0,
      activo TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_usuario_direcciones_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        ON DELETE CASCADE,
      CONSTRAINT chk_usuario_direcciones_lat
        CHECK (lat >= -90 AND lat <= 90),
      CONSTRAINT chk_usuario_direcciones_lng
        CHECK (lng >= -180 AND lng <= 180),
      INDEX idx_usuario_direcciones_usuario_activo (usuario_id, activo, updated_at),
      INDEX idx_usuario_direcciones_usuario_predeterminada (usuario_id, es_predeterminada, activo),
      INDEX idx_usuario_direcciones_lat_lng (lat, lng)
    )`
  );
}

async function ensureEnvioZonasSchema() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS envio_zonas (
      id INT PRIMARY KEY AUTO_INCREMENT,
      nombre VARCHAR(120) NOT NULL,
      descripcion TEXT NULL,
      precio DECIMAL(10,2) NOT NULL DEFAULT 0,
      prioridad INT NOT NULL DEFAULT 0,
      color VARCHAR(16) NOT NULL DEFAULT '#6B8F71',
      polygon_geojson JSON NOT NULL,
      activo TINYINT(1) NOT NULL DEFAULT 1,
      created_by INT NULL,
      updated_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_envio_zonas_created_by
        FOREIGN KEY (created_by) REFERENCES usuarios(id)
        ON DELETE SET NULL,
      CONSTRAINT fk_envio_zonas_updated_by
        FOREIGN KEY (updated_by) REFERENCES usuarios(id)
        ON DELETE SET NULL,
      INDEX idx_envio_zonas_activo_prioridad (activo, prioridad, id)
    )`
  );
}

async function ensureEmailVerificationSchema() {
  const [verifiedRows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'email_verificado'
     LIMIT 1`
  ) as [any[], any[]];
  if (!verifiedRows.length) {
    await pool.query("ALTER TABLE usuarios ADD COLUMN email_verificado TINYINT(1) NOT NULL DEFAULT 1 AFTER email");
  }

  const [verifiedAtRows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'email_verificado_at'
     LIMIT 1`
  ) as [any[], any[]];
  if (!verifiedAtRows.length) {
    await pool.query("ALTER TABLE usuarios ADD COLUMN email_verificado_at DATETIME NULL AFTER email_verificado");
  }

  await pool.query(
    `CREATE TABLE IF NOT EXISTS email_verification_codes (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      usuario_id INT NOT NULL,
      codigo_hash CHAR(64) NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
      requested_ip VARCHAR(64) NULL,
      requested_user_agent VARCHAR(255) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_email_verification_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        ON DELETE CASCADE,
      INDEX idx_email_verification_usuario_estado (usuario_id, used_at, expires_at)
    )`
  );
}

async function ensureAuthProtectionSchema() {
  const columnExists = async (tableName: string, columnName: string) => {
    const [rows] = await pool.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
       LIMIT 1`,
      [tableName, columnName]
    ) as [any[], any[]];
    return rows.length > 0;
  };

  await pool.query(
    `CREATE TABLE IF NOT EXISTS auth_rate_limit_counters (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      rate_key VARCHAR(255) NOT NULL,
      action VARCHAR(80) NOT NULL,
      count INT UNSIGNED NOT NULL DEFAULT 0,
      window_start DATETIME NOT NULL,
      expires_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_auth_rate_limit_key (rate_key),
      INDEX idx_auth_rate_limit_expires (expires_at),
      INDEX idx_auth_rate_limit_action (action)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS auth_cooldowns (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      cooldown_key VARCHAR(255) NOT NULL,
      action VARCHAR(80) NOT NULL,
      strikes TINYINT UNSIGNED NOT NULL DEFAULT 0,
      blocked_until DATETIME NOT NULL,
      expires_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_auth_cooldown_key (cooldown_key),
      INDEX idx_auth_cooldown_blocked_until (blocked_until),
      INDEX idx_auth_cooldown_expires (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS pending_registrations (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      email_hash CHAR(64) NOT NULL,
      email VARCHAR(255) NOT NULL,
      token_hash CHAR(64) NOT NULL,
      nombre VARCHAR(100) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      dni VARCHAR(20) NULL,
      fecha_nacimiento DATE NULL,
      localidad VARCHAR(120) NULL,
      provincia VARCHAR(120) NULL,
      codigo_invitacion_usado VARCHAR(32) NULL,
      device_id CHAR(36) NULL,
      ip VARCHAR(64) NULL,
      attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
      resend_available_at DATETIME NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_pending_registrations_email_hash (email_hash),
      INDEX idx_pending_registrations_token_hash (token_hash),
      INDEX idx_pending_registrations_expires (expires_at),
      INDEX idx_pending_registrations_device (device_id, updated_at),
      INDEX idx_pending_registrations_ip (ip, updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      usuario_id INT NOT NULL,
      token_hash CHAR(64) NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
      requested_ip VARCHAR(64) NULL,
      requested_user_agent VARCHAR(255) NULL,
      device_id CHAR(36) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_password_reset_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        ON DELETE CASCADE,
      UNIQUE KEY uq_password_reset_token_hash (token_hash),
      INDEX idx_password_reset_usuario_estado (usuario_id, used_at, expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  if (!(await columnExists("password_reset_tokens", "attempts"))) {
    await pool.query("ALTER TABLE password_reset_tokens ADD COLUMN attempts TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER used_at");
  }
  if (!(await columnExists("password_reset_tokens", "device_id"))) {
    await pool.query("ALTER TABLE password_reset_tokens ADD COLUMN device_id CHAR(36) NULL AFTER requested_user_agent");
  }
}

async function ensureUsuarioRolesSchema() {
  const [roleRows] = await pool.query(
    `SELECT COLUMN_TYPE
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'rol'
     LIMIT 1`
  ) as [Array<{ COLUMN_TYPE: string }>, any[]];

  const currentType = (roleRows[0]?.COLUMN_TYPE || "").toLowerCase();
  if (!currentType.includes("'superadmin'")) {
    await pool.query(
      "ALTER TABLE usuarios MODIFY COLUMN rol ENUM('admin','superAdmin','vendedor','cliente') NOT NULL DEFAULT 'cliente'"
    );
  }
}

async function ensureCanjeRedeemCodeSchema() {
  // Agrega la columna si no existe, o expande a VARCHAR(50) para que quepan los updates
  const [colRows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'canjes' AND COLUMN_NAME = 'codigo_retiro'
     LIMIT 1`
  ) as [any[], any[]];

  if (!colRows.length) {
    await pool.query("ALTER TABLE canjes ADD COLUMN codigo_retiro VARCHAR(50) NULL AFTER producto_id");
  } else {
    // Expande temporalmente para poder escribir sin importar el tamaño actual
    await pool.query("ALTER TABLE canjes MODIFY COLUMN codigo_retiro VARCHAR(50) NULL");
  }

  // Asigna códigos random a los canjes que tienen código legacy o vacío
  const [codeRows] = await pool.query(
    "SELECT id, codigo_retiro FROM canjes"
  ) as [Array<{ id: number; codigo_retiro: string | null }>, any[]];

  const usedCodes = new Set(
    codeRows
      .map((r) => r.codigo_retiro)
      .filter((c): c is string => Boolean(c) && !isLegacyRedeemCode(c))
  );

  for (const row of codeRows) {
    if (!isLegacyRedeemCode(row.codigo_retiro)) continue;
    let code = makeRandomRedeemCode();
    while (usedCodes.has(code)) code = makeRandomRedeemCode();
    usedCodes.add(code);
    await pool.query("UPDATE canjes SET codigo_retiro = ? WHERE id = ?", [code, row.id]);
  }

  // Ajuste de schema — no crítico, se ignora si falla
  try {
    await pool.query("ALTER TABLE canjes MODIFY COLUMN codigo_retiro VARCHAR(9) NOT NULL");
  } catch { /* ya estaba bien o los datos no lo permiten aún */ }

  try {
    const [idxRows] = await pool.query(
      `SELECT 1 FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'canjes'
         AND INDEX_NAME = 'uq_canjes_codigo_retiro' LIMIT 1`
    ) as [any[], any[]];
    if (!idxRows.length) {
      await pool.query("ALTER TABLE canjes ADD UNIQUE INDEX uq_canjes_codigo_retiro (codigo_retiro)");
    }
  } catch { /* índice ya existe con otro nombre */ }
}

async function ensureCanjeItemsSchema() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS canje_items (
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
    )`
  );

  await pool.query(
    `INSERT INTO canje_items (canje_id, producto_id, cantidad, puntos_unitarios, puntos_total)
     SELECT c.id,
            c.producto_id,
            1,
            COALESCE(NULLIF(p.puntos_requeridos, 0), c.puntos_usados),
            c.puntos_usados
     FROM canjes c
     LEFT JOIN productos p ON p.id = c.producto_id
     LEFT JOIN canje_items ci ON ci.canje_id = c.id
     WHERE ci.id IS NULL`
  );
}

async function ensureProductoImagenesSchema() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS producto_imagenes (
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
    )`
  );

  const [legacyRows] = await pool.query(
    `SELECT p.id, p.imagen_url
     FROM productos p
     LEFT JOIN (
       SELECT producto_id, COUNT(*) AS c
       FROM producto_imagenes
       GROUP BY producto_id
     ) pi ON pi.producto_id = p.id
     WHERE p.imagen_url IS NOT NULL
       AND TRIM(p.imagen_url) <> ''
       AND COALESCE(pi.c, 0) = 0`
  ) as [Array<{ id: number; imagen_url: string }>, any[]];

  for (const row of legacyRows) {
    await pool.query(
      "INSERT INTO producto_imagenes (producto_id, imagen_url, orden) VALUES (?, ?, 1)",
      [row.id, row.imagen_url.trim()]
    );
  }
}

async function ensureSucursalesSchema() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS sucursales (
      id INT PRIMARY KEY AUTO_INCREMENT,
      nombre VARCHAR(120) NOT NULL,
      direccion VARCHAR(180) NOT NULL,
      piso VARCHAR(30) NULL,
      localidad VARCHAR(120) NOT NULL,
      provincia VARCHAR(120) NOT NULL,
      activo TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`
  );

  const [colRows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'canjes' AND COLUMN_NAME = 'sucursal_id'
     LIMIT 1`
  ) as [any[], any[]];
  if (!colRows.length) {
    await pool.query("ALTER TABLE canjes ADD COLUMN sucursal_id INT NULL AFTER producto_id");
  }

  try {
    const [idxRows] = await pool.query(
      `SELECT 1 FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'canjes'
         AND INDEX_NAME = 'idx_canjes_sucursal_id' LIMIT 1`
    ) as [any[], any[]];
    if (!idxRows.length) {
      await pool.query("ALTER TABLE canjes ADD INDEX idx_canjes_sucursal_id (sucursal_id)");
    }
  } catch {
    // No-op
  }

  try {
    const [fkRows] = await pool.query(
      `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'canjes'
         AND CONSTRAINT_NAME = 'fk_canje_sucursal' LIMIT 1`
    ) as [any[], any[]];
    if (!fkRows.length) {
      await pool.query(
        `ALTER TABLE canjes
         ADD CONSTRAINT fk_canje_sucursal
         FOREIGN KEY (sucursal_id) REFERENCES sucursales(id)
         ON DELETE SET NULL
         ON UPDATE CASCADE`
      );
    }
  } catch {
    // No-op
  }

  const [countRows] = await pool.query("SELECT COUNT(*) AS c FROM sucursales") as [Array<{ c: number }>, any[]];
  const totalSucursales = Number(countRows?.[0]?.c ?? 0);
  if (totalSucursales === 0) {
    const [cfgRows] = await pool.query(
      "SELECT valor FROM configuracion WHERE clave = 'lugar_retiro_canje' LIMIT 1"
    ) as [Array<{ valor: string }>, any[]];
    const direccionBase = cfgRows?.[0]?.valor?.trim() || "Direccion a definir";
    await pool.query(
      `INSERT INTO sucursales (nombre, direccion, piso, localidad, provincia, activo)
       VALUES (?, ?, ?, ?, ?, 1)`,
      ["Sucursal principal", direccionBase, null, "No informado", "No informado"]
    );
  }

  const [activeRows] = await pool.query(
    "SELECT COUNT(*) AS c FROM sucursales WHERE activo = 1"
  ) as [Array<{ c: number }>, any[]];
  const totalActivas = Number(activeRows?.[0]?.c ?? 0);
  if (totalActivas === 0) {
    await pool.query(
      "UPDATE sucursales SET activo = 1 WHERE id = (SELECT id FROM (SELECT id FROM sucursales ORDER BY id ASC LIMIT 1) t)"
    );
  }
}

async function ensureGlobalConfigurationSchema() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS configuracion (
      clave VARCHAR(100) PRIMARY KEY,
      valor VARCHAR(255) NOT NULL,
      descripcion TEXT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  const defaultConfigs = [
    {
      clave: "envio_gratis_monto_minimo",
      valor: "0",
      descripcion: "Monto minimo de productos para que el envio sea gratis. 0 desactiva la regla.",
    },
    {
      clave: "limite_compra_cliente",
      valor: "100",
      descripcion: "Cantidad maxima por producto para clientes comunes. 0 significa sin tope comercial.",
    },
    {
      clave: "limite_compra_mayorista",
      valor: "100",
      descripcion: "Cantidad maxima por producto para clientes mayoristas. 0 significa sin tope comercial.",
    },
    {
      clave: "limite_compra_empleado",
      valor: "100",
      descripcion: "Cantidad maxima por producto para clientes empleados. 0 significa sin tope comercial.",
    },
  ];

  for (const item of defaultConfigs) {
    await pool.query(
      `INSERT INTO configuracion (clave, valor, descripcion)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         descripcion = COALESCE(NULLIF(VALUES(descripcion), ''), configuracion.descripcion)`,
      [item.clave, item.valor, item.descripcion],
    );
  }
}

async function ensureCategoriasSchema() {
  const categoriaColumnExists = async (columnName: string) => {
    const [rows] = await pool.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categorias' AND COLUMN_NAME = ?
       LIMIT 1`,
      [columnName]
    ) as [any[], any[]];
    return rows.length > 0;
  };

  await pool.query(
    `CREATE TABLE IF NOT EXISTS categorias (
      id INT PRIMARY KEY AUTO_INCREMENT,
      nombre VARCHAR(100) NOT NULL UNIQUE,
      descripcion TEXT NULL,
      activo TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  if (!(await categoriaColumnExists("descripcion"))) {
    await pool.query("ALTER TABLE categorias ADD COLUMN descripcion TEXT NULL AFTER nombre");
  }
  if (!(await categoriaColumnExists("activo"))) {
    await pool.query("ALTER TABLE categorias ADD COLUMN activo TINYINT(1) NOT NULL DEFAULT 1 AFTER descripcion");
  }
  if (!(await categoriaColumnExists("updated_at"))) {
    await pool.query(
      "ALTER TABLE categorias ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at"
    );
  }
}

async function ensureProductosEcommerceSchema() {
  const [tipoColRows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'tipo_producto'
     LIMIT 1`
  ) as [any[], any[]];
  if (!tipoColRows.length) {
    await pool.query(
      "ALTER TABLE productos ADD COLUMN tipo_producto ENUM('canje','venta','mixto') NOT NULL DEFAULT 'canje' AFTER categoria"
    );
  }

  const [precioDineroRows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'precio_dinero'
     LIMIT 1`
  ) as [any[], any[]];
  if (!precioDineroRows.length) {
    await pool.query("ALTER TABLE productos ADD COLUMN precio_dinero DECIMAL(10,2) NULL AFTER puntos_acumulables");
  }

  const [precioPuntosRows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'precio_puntos'
     LIMIT 1`
  ) as [any[], any[]];
  if (!precioPuntosRows.length) {
    await pool.query("ALTER TABLE productos ADD COLUMN precio_puntos INT NULL AFTER precio_dinero");
  }

  const [stockRows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'stock_disponible'
     LIMIT 1`
  ) as [any[], any[]];
  if (!stockRows.length) {
    await pool.query("ALTER TABLE productos ADD COLUMN stock_disponible INT NOT NULL DEFAULT 0 AFTER precio_puntos");
  }

  const [stockReservadoRows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'stock_reservado'
     LIMIT 1`
  ) as [any[], any[]];
  if (!stockReservadoRows.length) {
    await pool.query("ALTER TABLE productos ADD COLUMN stock_reservado INT NOT NULL DEFAULT 0 AFTER stock_disponible");
  }

  const [trackRows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'track_stock'
     LIMIT 1`
  ) as [any[], any[]];
  if (!trackRows.length) {
    await pool.query("ALTER TABLE productos ADD COLUMN track_stock TINYINT(1) NOT NULL DEFAULT 1 AFTER stock_reservado");
  }

  const [permiteEnvioRows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'permite_envio'
     LIMIT 1`
  ) as [any[], any[]];
  if (!permiteEnvioRows.length) {
    await pool.query("ALTER TABLE productos ADD COLUMN permite_envio TINYINT(1) NOT NULL DEFAULT 0 AFTER track_stock");
  }

  const [envioGratisRows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'envio_gratis'
     LIMIT 1`
  ) as [any[], any[]];
  if (!envioGratisRows.length) {
    await pool.query("ALTER TABLE productos ADD COLUMN envio_gratis TINYINT(1) NOT NULL DEFAULT 0 AFTER permite_envio");
  }

  const [permiteRetiroRows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'permite_retiro_local'
     LIMIT 1`
  ) as [any[], any[]];
  if (!permiteRetiroRows.length) {
    await pool.query("ALTER TABLE productos ADD COLUMN permite_retiro_local TINYINT(1) NOT NULL DEFAULT 1 AFTER envio_gratis");
  }

  const [skuRows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'sku'
     LIMIT 1`
  ) as [any[], any[]];
  if (!skuRows.length) {
    await pool.query("ALTER TABLE productos ADD COLUMN sku VARCHAR(64) NULL AFTER nombre");
  }

  const [updatedRows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'updated_at'
     LIMIT 1`
  ) as [any[], any[]];
  if (!updatedRows.length) {
    await pool.query(
      "ALTER TABLE productos ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at"
    );
  }

  await pool.query("UPDATE productos SET precio_puntos = puntos_requeridos WHERE precio_puntos IS NULL");

  const [puntosCanjearRows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'puntos_para_canjear'
     LIMIT 1`
  ) as [any[], any[]];
  if (!puntosCanjearRows.length) {
    await pool.query("ALTER TABLE productos ADD COLUMN puntos_para_canjear INT NULL AFTER precio_puntos");
  }

  const [puntajeComprarRows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'puntaje_al_comprar'
     LIMIT 1`
  ) as [any[], any[]];
  if (!puntajeComprarRows.length) {
    await pool.query("ALTER TABLE productos ADD COLUMN puntaje_al_comprar INT NULL AFTER puntos_para_canjear");
  }

  const [destacadoHomeRows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'destacado_home'
     LIMIT 1`
  ) as [any[], any[]];
  if (!destacadoHomeRows.length) {
    await pool.query("ALTER TABLE productos ADD COLUMN destacado_home TINYINT(1) NOT NULL DEFAULT 0 AFTER puntaje_al_comprar");
  }

  await pool.query(
    "UPDATE productos SET puntos_para_canjear = COALESCE(puntos_para_canjear, precio_puntos, puntos_requeridos)"
  );
  await pool.query(
    "UPDATE productos SET puntaje_al_comprar = COALESCE(puntaje_al_comprar, puntos_acumulables)"
  );

  try {
    const [skuIdxRows] = await pool.query(
      `SELECT 1 FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos'
         AND INDEX_NAME = 'uq_productos_sku' LIMIT 1`
    ) as [any[], any[]];
    if (!skuIdxRows.length) {
      await pool.query("ALTER TABLE productos ADD UNIQUE INDEX uq_productos_sku (sku)");
    }
  } catch {
    // No-op
  }
}

async function ensureInventarioSucursalSchema() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS inventario_sucursal (
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
    )`
  );

  const [products] = await pool.query(
    `SELECT p.id, p.stock_disponible, p.stock_reservado
     FROM productos p
     LEFT JOIN inventario_sucursal i ON i.producto_id = p.id
     WHERE i.id IS NULL`
  ) as [Array<{ id: number; stock_disponible: number; stock_reservado: number }>, any[]];
  if (!products.length) return;

  const [branches] = await pool.query(
    "SELECT id FROM sucursales WHERE activo = 1 ORDER BY id ASC"
  ) as [Array<{ id: number }>, any[]];
  if (!branches.length) return;

  for (const product of products) {
    for (let index = 0; index < branches.length; index += 1) {
      await pool.query(
        `INSERT INTO inventario_sucursal (producto_id, sucursal_id, stock_disponible, stock_reservado)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP`,
        [
          product.id,
          branches[index].id,
          index === 0 ? Number(product.stock_disponible ?? 0) : 0,
          index === 0 ? Number(product.stock_reservado ?? 0) : 0,
        ]
      );
    }
  }
}

async function ensureOrderCoreSchema() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS carritos (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      usuario_id INT NOT NULL,
      estado ENUM('activo','convertido','abandonado') NOT NULL DEFAULT 'activo',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_carrito_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        ON DELETE CASCADE,
      INDEX idx_carritos_usuario_estado (usuario_id, estado, updated_at)
    )`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS carrito_items (
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
    )`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS ordenes (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      usuario_id INT NULL,
      cliente_local_id INT NULL,
      carrito_id BIGINT UNSIGNED NULL,
      canal ENUM('web','admin','vendedor') NOT NULL DEFAULT 'web',
      tipo_orden ENUM('canje','venta','mixta') NOT NULL DEFAULT 'canje',
      estado ENUM('borrador','pendiente_pago','pagada','preparandose','preparada','enviada','entregando','entregada','cancelada','expirada')
        NOT NULL DEFAULT 'borrador',
      moneda VARCHAR(8) NOT NULL DEFAULT 'ARS',
      total_dinero DECIMAL(10,2) NOT NULL DEFAULT 0,
      total_puntos INT NOT NULL DEFAULT 0,
      direccion_envio_json JSON NULL,
      sucursal_retiro_id INT NULL,
      envio_zona_id INT NULL,
      envio_costo DECIMAL(10,2) NOT NULL DEFAULT 0,
      envio_cotizacion_json JSON NULL,
      notas TEXT NULL,
      receipt_email_sent_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_orden_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        ON DELETE RESTRICT,
      CONSTRAINT fk_orden_cliente_local
        FOREIGN KEY (cliente_local_id) REFERENCES clientes_locales(id)
        ON DELETE SET NULL,
      CONSTRAINT fk_orden_carrito
        FOREIGN KEY (carrito_id) REFERENCES carritos(id)
        ON DELETE SET NULL,
      CONSTRAINT fk_orden_sucursal
        FOREIGN KEY (sucursal_retiro_id) REFERENCES sucursales(id)
        ON DELETE SET NULL,
      CONSTRAINT fk_orden_envio_zona
        FOREIGN KEY (envio_zona_id) REFERENCES envio_zonas(id)
        ON DELETE SET NULL,
      INDEX idx_ordenes_usuario_created_at (usuario_id, created_at),
      INDEX idx_ordenes_cliente_local_created_at (cliente_local_id, created_at),
      INDEX idx_ordenes_estado_created_at (estado, created_at)
    )`
  );

  await pool.query(
    `ALTER TABLE ordenes
     MODIFY COLUMN usuario_id INT NULL`
  ).catch(() => {});
  await pool.query(
    `ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS receipt_email_sent_at DATETIME NULL AFTER notas`
  ).catch(() => {});

  const [clienteLocalRows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ordenes' AND COLUMN_NAME = 'cliente_local_id'
     LIMIT 1`
  ) as [any[], any[]];
  if (!clienteLocalRows.length) {
    await pool.query("ALTER TABLE ordenes ADD COLUMN cliente_local_id INT NULL AFTER usuario_id");
  }

  const ensureOrderColumn = async (columnName: string, definition: string) => {
    const [rows] = await pool.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ordenes' AND COLUMN_NAME = ?
       LIMIT 1`,
      [columnName]
    ) as [any[], any[]];
    if (!rows.length) {
      await pool.query(`ALTER TABLE ordenes ADD COLUMN ${definition}`);
    }
  };

  await ensureOrderColumn("envio_zona_id", "envio_zona_id INT NULL AFTER sucursal_retiro_id");
  await ensureOrderColumn("envio_costo", "envio_costo DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER envio_zona_id");
  await ensureOrderColumn("envio_cotizacion_json", "envio_cotizacion_json JSON NULL AFTER envio_costo");

  try {
    const [idxRows] = await pool.query(
      `SELECT 1 FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ordenes'
         AND INDEX_NAME = 'idx_ordenes_cliente_local_created_at'
       LIMIT 1`
    ) as [any[], any[]];
    if (!idxRows.length) {
      await pool.query("ALTER TABLE ordenes ADD INDEX idx_ordenes_cliente_local_created_at (cliente_local_id, created_at)");
    }
  } catch {
    // No-op
  }

  try {
    const [fkRows] = await pool.query(
      `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ordenes'
         AND CONSTRAINT_NAME = 'fk_orden_cliente_local'
       LIMIT 1`
    ) as [any[], any[]];
    if (!fkRows.length) {
      await pool.query(
        `ALTER TABLE ordenes
         ADD CONSTRAINT fk_orden_cliente_local
         FOREIGN KEY (cliente_local_id) REFERENCES clientes_locales(id)
         ON DELETE SET NULL`
      );
    }
  } catch {
    // No-op
  }

  try {
    const [fkRows] = await pool.query(
      `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ordenes'
         AND CONSTRAINT_NAME = 'fk_orden_envio_zona'
       LIMIT 1`
    ) as [any[], any[]];
    if (!fkRows.length) {
      await pool.query(
        `ALTER TABLE ordenes
         ADD CONSTRAINT fk_orden_envio_zona
         FOREIGN KEY (envio_zona_id) REFERENCES envio_zonas(id)
         ON DELETE SET NULL`
      );
    }
  } catch {
    // No-op
  }

  await pool.query(
    `CREATE TABLE IF NOT EXISTS orden_items (
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
    )`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS pagos (
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
    )`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS movimientos_stock (
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
    )`
  );

  try {
    const [statusRows] = await pool.query(
      `SELECT COLUMN_TYPE AS column_type
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ordenes' AND COLUMN_NAME = 'estado'
       LIMIT 1`
    ) as [Array<{ column_type: string }>, any[]];
    const columnType = statusRows[0]?.column_type ?? "";
    if (!columnType.includes("'preparandose'") || !columnType.includes("'entregando'")) {
      await pool.query(
        `ALTER TABLE ordenes
         MODIFY estado ENUM('borrador','pendiente_pago','pagada','preparandose','preparada','enviada','entregando','entregada','cancelada','expirada')
         NOT NULL DEFAULT 'borrador'`
      );
    }
  } catch {
    // No detenemos el arranque si MySQL no permite modificar el enum en este momento.
  }
}

async function ensureUsuarioCommercialSchema() {
  const [tipoRows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'tipo_cliente'
     LIMIT 1`
  ) as [any[], any[]];
  if (!tipoRows.length) {
    await pool.query(
      "ALTER TABLE usuarios ADD COLUMN tipo_cliente ENUM('cliente','mayorista','empleado') NOT NULL DEFAULT 'cliente' AFTER rol"
    );
  } else {
    try {
      await pool.query(
        "ALTER TABLE usuarios MODIFY COLUMN tipo_cliente ENUM('cliente','mayorista','empleado') NOT NULL DEFAULT 'cliente'"
      );
    } catch {
      // No-op
    }
  }

  const [discountRows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'descuento_porcentaje'
     LIMIT 1`
  ) as [any[], any[]];
  if (!discountRows.length) {
    await pool.query(
      "ALTER TABLE usuarios ADD COLUMN descuento_porcentaje DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER tipo_cliente"
    );
  }

  await pool.query(
    `UPDATE usuarios
     SET tipo_cliente = 'cliente'
     WHERE tipo_cliente IS NULL OR tipo_cliente = ''`
  ).catch(() => {});

  await pool.query(
    `UPDATE usuarios
     SET descuento_porcentaje = 0
     WHERE descuento_porcentaje IS NULL OR descuento_porcentaje < 0`
  ).catch(() => {});
}

async function ensureClientesLocalesSchema() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS clientes_locales (
      id INT PRIMARY KEY AUTO_INCREMENT,
      nombre VARCHAR(120) NOT NULL,
      dni VARCHAR(20) NOT NULL,
      telefono VARCHAR(25) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_clientes_locales_dni (dni),
      INDEX idx_clientes_locales_nombre (nombre)
    )`
  );
  await pool.query("ALTER TABLE clientes_locales MODIFY COLUMN dni VARCHAR(20) NULL");
}

async function ensurePricingDiscountSchema() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS descuentos_tipo_categoria (
      id INT PRIMARY KEY AUTO_INCREMENT,
      tipo_cliente ENUM('cliente','mayorista','empleado') NOT NULL,
      categoria VARCHAR(100) NOT NULL,
      descuento_porcentaje DECIMAL(5,2) NOT NULL DEFAULT 0,
      activo TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT uq_descuento_tipo_categoria UNIQUE (tipo_cliente, categoria),
      INDEX idx_descuentos_tipo_categoria_categoria (categoria)
    )`
  );
}

async function ensurePaymentFeeRulesSchema() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS costos_cobro (
      id INT PRIMARY KEY AUTO_INCREMENT,
      proveedor VARCHAR(40) NOT NULL,
      metodo VARCHAR(40) NOT NULL,
      descripcion VARCHAR(160) NOT NULL,
      porcentaje DECIMAL(5,2) NOT NULL DEFAULT 0,
      activo TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT uq_costos_cobro UNIQUE (proveedor, metodo)
    )`
  );

  await pool.query(
    `INSERT INTO costos_cobro (proveedor, metodo, descripcion, porcentaje, activo)
     VALUES
       ('efectivo', 'cash', 'Efectivo en sucursal', 0, 1),
       ('mercadopago', 'brick', 'Mercado Pago tarjeta / checkout', 0, 1),
       ('mercadopago', 'wallet', 'Mercado Pago wallet / link de pago', 0, 1),
       ('mercadopago', 'qr', 'Mercado Pago QR', 0, 1),
       ('local', 'cash', 'Venta local efectivo', 0, 1),
       ('local', 'transferencia', 'Venta local transferencia', 0, 1),
       ('local', 'tarjeta', 'Venta local tarjeta / point', 0, 1),
       ('local', 'qr', 'Venta local QR', 0, 1),
       ('local', 'otro', 'Venta local otro medio', 0, 1)
     ON DUPLICATE KEY UPDATE descripcion = VALUES(descripcion)`
  );
}

async function ensureSaboresSchema() {
  const columnExists = async (tableName: string, columnName: string) => {
    const [rows] = await pool.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
       LIMIT 1`,
      [tableName, columnName],
    ) as [any[], any[]];
    return rows.length > 0;
  };

  const indexExists = async (tableName: string, indexName: string) => {
    const [rows] = await pool.query(
      `SELECT 1 FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
       LIMIT 1`,
      [tableName, indexName],
    ) as [any[], any[]];
    return rows.length > 0;
  };

  await pool.query(
    `CREATE TABLE IF NOT EXISTS sabores (
      id INT PRIMARY KEY AUTO_INCREMENT,
      nombre VARCHAR(120) NOT NULL,
      descripcion VARCHAR(300) NULL,
      activo TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT uq_sabores_nombre UNIQUE (nombre)
    )`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS inventario_sabor_sucursal (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      sabor_id INT NOT NULL,
      sucursal_id INT NOT NULL,
      stock_disponible INT NOT NULL DEFAULT 0,
      stock_reservado INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_inv_sabor_sabor
        FOREIGN KEY (sabor_id) REFERENCES sabores(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_inv_sabor_sucursal
        FOREIGN KEY (sucursal_id) REFERENCES sucursales(id)
        ON DELETE CASCADE,
      CONSTRAINT uq_inv_sabor_sucursal
        UNIQUE (sabor_id, sucursal_id)
    )`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS producto_sabores (
      producto_id INT NOT NULL,
      sabor_id INT NOT NULL,
      orden TINYINT UNSIGNED NOT NULL DEFAULT 1,
      activo TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (producto_id, sabor_id),
      CONSTRAINT fk_producto_sabores_producto
        FOREIGN KEY (producto_id) REFERENCES productos(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_producto_sabores_sabor
        FOREIGN KEY (sabor_id) REFERENCES sabores(id)
        ON DELETE RESTRICT
    )`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS carrito_item_sabores (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      carrito_item_id BIGINT UNSIGNED NOT NULL,
      sabor_id INT NOT NULL,
      sabor_nombre VARCHAR(120) NOT NULL,
      cantidad INT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_carrito_item_sabores_item
        FOREIGN KEY (carrito_item_id) REFERENCES carrito_items(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_carrito_item_sabores_sabor
        FOREIGN KEY (sabor_id) REFERENCES sabores(id)
        ON DELETE RESTRICT,
      CONSTRAINT uq_carrito_item_sabor
        UNIQUE (carrito_item_id, sabor_id)
    )`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS orden_item_sabores (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      orden_item_id BIGINT UNSIGNED NOT NULL,
      sabor_id INT NOT NULL,
      sabor_nombre VARCHAR(120) NOT NULL,
      cantidad INT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_orden_item_sabores_item
        FOREIGN KEY (orden_item_id) REFERENCES orden_items(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_orden_item_sabores_sabor
        FOREIGN KEY (sabor_id) REFERENCES sabores(id)
        ON DELETE RESTRICT,
      CONSTRAINT uq_orden_item_sabor
        UNIQUE (orden_item_id, sabor_id)
    )`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS movimientos_sabor_stock (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      sabor_id INT NOT NULL,
      sucursal_id INT NULL,
      orden_id BIGINT UNSIGNED NULL,
      tipo ENUM('ingreso','reserva','liberacion','descuento','ajuste') NOT NULL,
      origen ENUM('compra','canje','admin','devolucion') NOT NULL,
      cantidad INT NOT NULL,
      descripcion VARCHAR(255) NULL,
      creado_por INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_mov_sabor_stock_sabor
        FOREIGN KEY (sabor_id) REFERENCES sabores(id)
        ON DELETE RESTRICT,
      CONSTRAINT fk_mov_sabor_stock_sucursal
        FOREIGN KEY (sucursal_id) REFERENCES sucursales(id)
        ON DELETE SET NULL,
      CONSTRAINT fk_mov_sabor_stock_orden
        FOREIGN KEY (orden_id) REFERENCES ordenes(id)
        ON DELETE SET NULL,
      CONSTRAINT fk_mov_sabor_stock_creado_por
        FOREIGN KEY (creado_por) REFERENCES usuarios(id)
        ON DELETE SET NULL,
      INDEX idx_mov_sabor_stock_sabor_fecha (sabor_id, created_at),
      INDEX idx_mov_sabor_stock_orden (orden_id)
    )`
  );

  if (!(await columnExists("productos", "configuracion_tipo"))) {
    await pool.query(
      "ALTER TABLE productos ADD COLUMN configuracion_tipo ENUM('simple','caja_sabores') NOT NULL DEFAULT 'simple' AFTER tipo_producto"
    );
  }

  if (!(await columnExists("productos", "capacidad_sabores"))) {
    await pool.query("ALTER TABLE productos ADD COLUMN capacidad_sabores INT NULL AFTER configuracion_tipo");
  }

  if (!(await columnExists("carrito_items", "config_hash"))) {
    await pool.query("ALTER TABLE carrito_items ADD COLUMN config_hash CHAR(64) NOT NULL DEFAULT '' AFTER modo_compra");
  }

  if (await indexExists("carrito_items", "uq_carrito_item_producto_modo")) {
    try {
      await pool.query("ALTER TABLE carrito_items DROP INDEX uq_carrito_item_producto_modo");
    } catch {
      // Si el indice fue renombrado manualmente, seguimos y creamos el nuevo cuando sea posible.
    }
  }

  if (!(await indexExists("carrito_items", "uq_carrito_item_producto_modo_config"))) {
    await pool.query(
      "ALTER TABLE carrito_items ADD UNIQUE INDEX uq_carrito_item_producto_modo_config (carrito_id, producto_id, modo_compra, config_hash)"
    );
  }

  if (!(await columnExists("orden_items", "config_hash"))) {
    await pool.query("ALTER TABLE orden_items ADD COLUMN config_hash CHAR(64) NOT NULL DEFAULT '' AFTER modo_compra");
  }

  if (await indexExists("orden_items", "uq_orden_item_producto_modo")) {
    try {
      await pool.query("ALTER TABLE orden_items DROP INDEX uq_orden_item_producto_modo");
    } catch {
      // Si el indice fue renombrado manualmente, seguimos y creamos el nuevo cuando sea posible.
    }
  }

  if (!(await indexExists("orden_items", "uq_orden_item_producto_modo_config"))) {
    await pool.query(
      "ALTER TABLE orden_items ADD UNIQUE INDEX uq_orden_item_producto_modo_config (orden_id, producto_id, modo_compra, config_hash)"
    );
  }
}

async function ensurePagosCheckoutSchema() {
  const [methodRows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pagos' AND COLUMN_NAME = 'metodo'
     LIMIT 1`
  ) as [any[], any[]];
  if (!methodRows.length) {
    await pool.query("ALTER TABLE pagos ADD COLUMN metodo VARCHAR(40) NULL AFTER proveedor");
  }

  const [checkoutUrlRows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pagos' AND COLUMN_NAME = 'checkout_url'
     LIMIT 1`
  ) as [any[], any[]];
  if (!checkoutUrlRows.length) {
    await pool.query("ALTER TABLE pagos ADD COLUMN checkout_url VARCHAR(500) NULL AFTER provider_payment_id");
  }

  const [comisionPctRows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pagos' AND COLUMN_NAME = 'comision_porcentaje'
     LIMIT 1`
  ) as [any[], any[]];
  if (!comisionPctRows.length) {
    await pool.query("ALTER TABLE pagos ADD COLUMN comision_porcentaje DECIMAL(5,2) NULL AFTER monto");
  }

  const [comisionMontoRows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pagos' AND COLUMN_NAME = 'comision_monto'
     LIMIT 1`
  ) as [any[], any[]];
  if (!comisionMontoRows.length) {
    await pool.query("ALTER TABLE pagos ADD COLUMN comision_monto DECIMAL(10,2) NULL AFTER comision_porcentaje");
  }

  const [montoNetoRows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pagos' AND COLUMN_NAME = 'monto_neto'
     LIMIT 1`
  ) as [any[], any[]];
  if (!montoNetoRows.length) {
    await pool.query("ALTER TABLE pagos ADD COLUMN monto_neto DECIMAL(10,2) NULL AFTER comision_monto");
  }

  await pool.query(
    `UPDATE pagos
     SET comision_porcentaje = COALESCE(comision_porcentaje, 0),
         comision_monto = COALESCE(comision_monto, 0),
         monto_neto = COALESCE(monto_neto, monto - COALESCE(comision_monto, 0))
     WHERE comision_porcentaje IS NULL
        OR comision_monto IS NULL
        OR monto_neto IS NULL`
  ).catch(() => {});

  try {
    const [idxRows] = await pool.query(
      `SELECT 1 FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pagos'
         AND INDEX_NAME = 'idx_pagos_proveedor_metodo'
       LIMIT 1`
    ) as [any[], any[]];
    if (!idxRows.length) {
      await pool.query("ALTER TABLE pagos ADD INDEX idx_pagos_proveedor_metodo (proveedor, metodo)");
    }
  } catch {
    // No-op
  }
}

async function ensureSupportInboxSchema() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS soporte_conversaciones (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      usuario_id INT NOT NULL,
      asunto VARCHAR(180) NULL,
      estado ENUM('abierta','respondida','cerrada','archivada') NOT NULL DEFAULT 'abierta',
      prioridad ENUM('normal','alta') NOT NULL DEFAULT 'normal',
      asignado_a INT NULL,
      ultimo_mensaje_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ultimo_staff_at DATETIME NULL,
      ultimo_cliente_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_soporte_conversacion_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_soporte_conversacion_asignado
        FOREIGN KEY (asignado_a) REFERENCES usuarios(id)
        ON DELETE SET NULL,
      INDEX idx_soporte_conversaciones_usuario_estado (usuario_id, estado, updated_at),
      INDEX idx_soporte_conversaciones_estado_fecha (estado, ultimo_mensaje_at)
    )`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS soporte_mensajes (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      conversacion_id BIGINT UNSIGNED NOT NULL,
      autor_usuario_id INT NULL,
      autor_tipo ENUM('cliente','staff','sistema') NOT NULL,
      cuerpo TEXT NOT NULL,
      es_interno TINYINT(1) NOT NULL DEFAULT 0,
      leido_por_cliente_at DATETIME NULL,
      leido_por_staff_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_soporte_mensaje_conversacion
        FOREIGN KEY (conversacion_id) REFERENCES soporte_conversaciones(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_soporte_mensaje_autor
        FOREIGN KEY (autor_usuario_id) REFERENCES usuarios(id)
        ON DELETE SET NULL,
      INDEX idx_soporte_mensajes_conversacion_fecha (conversacion_id, created_at),
      INDEX idx_soporte_mensajes_autor (autor_usuario_id)
    )`
  );

  try {
    await pool.query(
      "ALTER TABLE soporte_conversaciones MODIFY estado ENUM('abierta','respondida','cerrada','archivada') NOT NULL DEFAULT 'abierta'"
    );
  } catch {
    // No-op: algunos motores no permiten modificar el ENUM si la tabla aun no existe o no hubo cambios.
  }
}


async function ensureEventosSeguridadSchema() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS eventos_seguridad (
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
    )`
  );
}

async function ensurePostulacionesCvSchema() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS postulaciones_cv (
      id INT PRIMARY KEY AUTO_INCREMENT,
      nombre VARCHAR(160) NOT NULL,
      email VARCHAR(160) NOT NULL,
      telefono VARCHAR(40) NULL,
      mensaje TEXT NOT NULL,
      archivo_original VARCHAR(255) NOT NULL,
      archivo_guardado VARCHAR(255) NOT NULL,
      mime_type VARCHAR(120) NULL,
      size_bytes INT NOT NULL DEFAULT 0,
      estado ENUM('nueva','vista','archivada') NOT NULL DEFAULT 'nueva',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_postulaciones_estado_created_at (estado, created_at),
      INDEX idx_postulaciones_email_created_at (email, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
}

async function ensureUbicacionesArgentinaSchema() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS argentina_provincias (
      id CHAR(2) PRIMARY KEY,
      nombre VARCHAR(120) NOT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_argentina_provincias_nombre (nombre)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS argentina_localidades (
      id VARCHAR(16) PRIMARY KEY,
      provincia_id CHAR(2) NOT NULL,
      nombre VARCHAR(160) NOT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_argentina_localidades_provincia
        FOREIGN KEY (provincia_id) REFERENCES argentina_provincias(id)
        ON DELETE CASCADE,
      INDEX idx_argentina_localidades_provincia_nombre (provincia_id, nombre)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
}

async function ensureAcreditacionPuntosSchema() {
  await pool.query(
    `ALTER TABLE carrito_items ADD COLUMN IF NOT EXISTS puntaje_al_comprar_unitario INT NOT NULL DEFAULT 0`
  ).catch(() => {});
  await pool.query(
    `ALTER TABLE orden_items ADD COLUMN IF NOT EXISTS puntaje_al_comprar_unitario INT NOT NULL DEFAULT 0`
  ).catch(() => {});
  await pool.query(
    `ALTER TABLE movimientos_puntos MODIFY COLUMN tipo ENUM('asignacion_manual','codigo_canje','referido_invitador','referido_invitado','canje_producto','devolucion_canje','acreditacion_compra','ajuste') NOT NULL`
  ).catch(() => {});
  await pool.query(
    `ALTER TABLE movimientos_puntos ADD CONSTRAINT uq_mov_referencia UNIQUE (referencia_tipo, referencia_id, tipo)`
  ).catch(() => {});
  // Backfill: carrito_items que quedaron en 0 antes de que se implementara el snapshot.
  // Usa el puntaje actual del producto como fallback seguro.
  await pool.query(
    `UPDATE carrito_items ci
     JOIN productos p ON p.id = ci.producto_id
     SET ci.puntaje_al_comprar_unitario = COALESCE(p.puntaje_al_comprar, 0)
     WHERE ci.modo_compra = 'dinero'
       AND ci.puntaje_al_comprar_unitario = 0
       AND COALESCE(p.puntaje_al_comprar, 0) > 0`
  ).catch(() => {});
}

async function ensureCashOperationsSchema() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS proveedores (
      id INT PRIMARY KEY AUTO_INCREMENT,
      nombre VARCHAR(160) NOT NULL,
      contacto VARCHAR(160) NULL,
      telefono VARCHAR(25) NULL,
      email VARCHAR(160) NULL,
      notas TEXT NULL,
      activo TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_proveedores_nombre (nombre),
      INDEX idx_proveedores_activo_nombre (activo, nombre)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS caja_sesiones (
      id INT PRIMARY KEY AUTO_INCREMENT,
      sucursal_id INT NOT NULL,
      usuario_id INT NOT NULL,
      fecha_operativa DATE NOT NULL,
      estado ENUM('abierta','cerrada') NOT NULL DEFAULT 'abierta',
      monto_apertura DECIMAL(12,2) NOT NULL DEFAULT 0,
      monto_cierre_sistema DECIMAL(12,2) NULL,
      monto_cierre_declarado DECIMAL(12,2) NULL,
      diferencia_cierre DECIMAL(12,2) NULL,
      observaciones_apertura TEXT NULL,
      observaciones_cierre TEXT NULL,
      apertura_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      cierre_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_caja_sesiones_sucursal
        FOREIGN KEY (sucursal_id) REFERENCES sucursales(id)
        ON DELETE RESTRICT,
      CONSTRAINT fk_caja_sesiones_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        ON DELETE RESTRICT,
      INDEX idx_caja_sesiones_estado_usuario (estado, usuario_id),
      INDEX idx_caja_sesiones_sucursal_fecha (sucursal_id, fecha_operativa),
      INDEX idx_caja_sesiones_usuario_fecha (usuario_id, fecha_operativa)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS caja_movimientos (
      id INT PRIMARY KEY AUTO_INCREMENT,
      caja_sesion_id INT NOT NULL,
      tipo ENUM('venta','gasto') NOT NULL,
      referencia_tipo VARCHAR(40) NULL,
      referencia_id INT NULL,
      medio_pago ENUM('cash','transferencia','tarjeta','qr','otro') NOT NULL DEFAULT 'cash',
      monto DECIMAL(12,2) NOT NULL,
      descripcion VARCHAR(255) NULL,
      creado_por INT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_caja_movimientos_sesion
        FOREIGN KEY (caja_sesion_id) REFERENCES caja_sesiones(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_caja_movimientos_creado_por
        FOREIGN KEY (creado_por) REFERENCES usuarios(id)
        ON DELETE RESTRICT,
      INDEX idx_caja_movimientos_sesion_tipo (caja_sesion_id, tipo),
      INDEX idx_caja_movimientos_referencia (referencia_tipo, referencia_id),
      INDEX idx_caja_movimientos_medio (caja_sesion_id, medio_pago)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  const [cancelledLocalSaleCashRows] = await pool.query(
    `SELECT cm.caja_sesion_id, cm.referencia_id, cm.medio_pago, cm.monto, cm.creado_por
     FROM caja_movimientos cm
     JOIN ordenes o ON o.id = cm.referencia_id
     LEFT JOIN caja_movimientos rev
       ON rev.referencia_tipo = 'ordenes_cancelacion'
      AND rev.referencia_id = cm.referencia_id
      AND rev.tipo = 'gasto'
     WHERE cm.referencia_tipo = 'ordenes'
       AND cm.tipo = 'venta'
       AND o.estado = 'cancelada'
       AND o.canal IN ('admin', 'vendedor')
       AND o.tipo_orden = 'venta'
       AND rev.id IS NULL`
  ) as [any[], any[]];
  for (const row of cancelledLocalSaleCashRows) {
    await pool.query(
      `INSERT INTO caja_movimientos
        (caja_sesion_id, tipo, referencia_tipo, referencia_id, medio_pago, monto, descripcion, creado_por)
       VALUES (?, 'gasto', 'ordenes_cancelacion', ?, ?, ?, ?, ?)`,
      [
        row.caja_sesion_id,
        row.referencia_id,
        row.medio_pago,
        row.monto,
        `Anulacion venta local #${row.referencia_id}`,
        row.creado_por,
      ],
    );
  }

  await pool.query(
    `CREATE TABLE IF NOT EXISTS gastos (
      id INT PRIMARY KEY AUTO_INCREMENT,
      sucursal_id INT NOT NULL,
      caja_sesion_id INT NOT NULL,
      proveedor_id INT NULL,
      tercero_nombre VARCHAR(160) NULL,
      categoria VARCHAR(120) NOT NULL,
      descripcion VARCHAR(255) NOT NULL,
      medio_pago ENUM('cash','transferencia','tarjeta','qr','otro') NOT NULL DEFAULT 'cash',
      monto DECIMAL(12,2) NOT NULL,
      fecha_gasto DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      notas TEXT NULL,
      creado_por INT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_gastos_sucursal
        FOREIGN KEY (sucursal_id) REFERENCES sucursales(id)
        ON DELETE RESTRICT,
      CONSTRAINT fk_gastos_caja_sesion
        FOREIGN KEY (caja_sesion_id) REFERENCES caja_sesiones(id)
        ON DELETE RESTRICT,
      CONSTRAINT fk_gastos_proveedor
        FOREIGN KEY (proveedor_id) REFERENCES proveedores(id)
        ON DELETE SET NULL,
      CONSTRAINT fk_gastos_creado_por
        FOREIGN KEY (creado_por) REFERENCES usuarios(id)
        ON DELETE RESTRICT,
      INDEX idx_gastos_sucursal_fecha (sucursal_id, fecha_gasto),
      INDEX idx_gastos_caja_sesion (caja_sesion_id),
      INDEX idx_gastos_proveedor (proveedor_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
}

pool
  .getConnection()
  .then(async (conn) => {
    console.log("✅ MySQL conectado");
    conn.release();
    try {
      await ensureUsuarioRolesSchema();
    } catch (err: any) {
      console.error("Migracion roles de usuarios:", err.message);
    }
    try {
      await ensureUsuarioCommercialSchema();
    } catch (err: any) {
      console.error("Migracion perfil comercial de usuarios:", err.message);
    }
    try {
      await ensureUsuarioTelefonoSchema();
    } catch (err: any) {
      console.error("Migracion telefono:", err.message);
    }
    try {
      await ensureUsuarioDemographicsSchema();
    } catch (err: any) {
      console.error("Migracion datos demograficos de usuarios:", err.message);
    }
    try {
      await ensureUsuarioDireccionesSchema();
    } catch (err: any) {
      console.error("Migracion direcciones de usuario:", err.message);
    }
    try {
      await ensureEnvioZonasSchema();
    } catch (err: any) {
      console.error("Migracion zonas de envio:", err.message);
    }
    try {
      await ensureEmailVerificationSchema();
    } catch (err: any) {
      console.error("Migracion verificacion de email:", err.message);
    }
    try {
      await ensureAuthProtectionSchema();
    } catch (err: any) {
      console.error("Migracion proteccion auth:", err.message);
    }
    try {
      await ensureUbicacionesArgentinaSchema();
    } catch (err: any) {
      console.error("Migracion ubicaciones Argentina:", err.message);
    }
    try {
      await ensureCanjeRedeemCodeSchema();
    } catch (err: any) {
      console.error("⚠️  Migración códigos de canje:", err.message);
    }
    try {
      await ensureCanjeItemsSchema();
    } catch (err: any) {
      console.error("⚠️  Migración detalle de canjes:", err.message);
    }
    try {
      await ensureProductoImagenesSchema();
    } catch (err: any) {
      console.error("⚠️  Migración imágenes de productos:", err.message);
    }
    try {
      await ensureSucursalesSchema();
    } catch (err: any) {
      console.error("⚠️  Migración sucursales:", err.message);
    }
    try {
      await ensureGlobalConfigurationSchema();
    } catch (err: any) {
      console.error("Migracion configuracion global:", err.message);
    }
    try {
      await ensureCategoriasSchema();
    } catch (err: any) {
      console.error("Migracion categorias:", err.message);
    }
    try {
      await ensureProductosEcommerceSchema();
    } catch (err: any) {
      console.error("⚠️  Migración productos e-commerce:", err.message);
    }
    try {
      await ensureClientesLocalesSchema();
    } catch (err: any) {
      console.error("Migracion clientes locales:", err.message);
    }
    try {
      await ensurePricingDiscountSchema();
    } catch (err: any) {
      console.error("Migracion descuentos por tipo y categoria:", err.message);
    }
    try {
      await ensurePaymentFeeRulesSchema();
    } catch (err: any) {
      console.error("Migracion costos de cobro:", err.message);
    }
    try {
      await ensureInventarioSucursalSchema();
    } catch (err: any) {
      console.error("⚠️  Migración inventario por sucursal:", err.message);
    }
    try {
      await ensureOrderCoreSchema();
    } catch (err: any) {
      console.error("⚠️  Migración carrito/ordenes/pagos:", err.message);
    }
    try {
      await ensureSaboresSchema();
    } catch (err: any) {
      console.error("Migracion sabores y cajas configurables:", err.message);
    }
    try {
      await ensurePagosCheckoutSchema();
    } catch (err: any) {
      console.error("⚠️  Migración columnas de pagos checkout:", err.message);
    }
    try {
      await ensureSupportInboxSchema();
    } catch (err: any) {
      console.error("⚠️  Migración inbox de soporte:", err.message);
    }
    try {
      await ensureEventosSeguridadSchema();
    } catch (err: any) {
      console.error("⚠️  Migración eventos de seguridad:", err.message);
    }
    try {
      await ensurePostulacionesCvSchema();
    } catch (err: any) {
      console.error("Migracion postulaciones CV:", err.message);
    }
    try {
      await ensureAcreditacionPuntosSchema();
    } catch (err: any) {
      console.error("⚠️  Migración acreditación puntos:", err.message);
    }
    try {
      await ensureCashOperationsSchema();
    } catch (err: any) {
      console.error("Migracion proveedores/gastos/caja:", err.message);
    }
  })
  .catch((err) => {
    // No detenemos el proceso: permitimos que /diagnostico reporte estado degradado.
    console.error("❌ MySQL:", err.message);
  });

export type Queryable = Pool | PoolConnection;

/** Devuelve todas las filas de un SELECT */
export async function qAll<T = any>(
  q: Queryable, sql: string, params?: any[]
): Promise<T[]> {
  const [rows] = await q.query(sql, params) as [any[], any[]];
  return rows as T[];
}

/** Devuelve la primera fila de un SELECT (o undefined) */
export async function qOne<T = any>(
  q: Queryable, sql: string, params?: any[]
): Promise<T | undefined> {
  const [rows] = await q.query(sql, params) as [any[], any[]];
  return (rows as T[])[0];
}

/** Ejecuta INSERT/UPDATE/DELETE y devuelve insertId y affectedRows */
export async function qRun(
  q: Queryable, sql: string, params?: any[]
): Promise<{ insertId: number; affectedRows: number }> {
  const [result] = await q.query(sql, params) as [any, any];
  return { insertId: result.insertId ?? 0, affectedRows: result.affectedRows ?? 0 };
}


