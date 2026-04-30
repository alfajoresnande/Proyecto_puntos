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

pool
  .getConnection()
  .then(async (conn) => {
    console.log("✅ MySQL conectado");
    conn.release();
    try {
      await ensureUsuarioTelefonoSchema();
    } catch (err: any) {
      console.error("Migracion telefono:", err.message);
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
      await ensureEventosSeguridadSchema();
    } catch (err: any) {
      console.error("⚠️  Migración eventos de seguridad:", err.message);
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


