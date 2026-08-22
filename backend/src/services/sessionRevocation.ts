import { pool, qOne, qRun, type Queryable } from "../db";
import type { Rol } from "../auth";

/**
 * Revocacion de sesiones (SEC-04).
 *
 * Alternativa elegida: JWT corto + `token_version` consultado en base.
 * Justificacion: la sesion ya esta cableada como JWT en cookie a lo largo de
 * ~20 routers, del WebSocket y del rate limiting; una sesion opaca obligaria a
 * reescribir todo ese camino. Con `token_version` alcanza una columna y una
 * consulta (que casi toda ruta autenticada ya hace igual) para cubrir los
 * cuatro disparadores: cambio de contrasena, cambio de rol, desactivacion y
 * logout.
 *
 * El logout usa ademas `sesiones_revocadas` para invalidar un unico `jti`,
 * porque subir `token_version` cerraria la sesion en todos los dispositivos.
 */

export type CuentaVigente = {
  id: number;
  email: string;
  rol: Rol;
  activo: boolean;
  tokenVersion: number;
};

type UsuarioRow = {
  id: number;
  email: string;
  rol: Rol;
  activo: number;
  token_version: number | null;
};

export async function cargarCuentaVigente(usuarioId: number, q: Queryable = pool): Promise<CuentaVigente | null> {
  const row = await qOne<UsuarioRow>(
    q,
    "SELECT id, email, rol, activo, token_version FROM usuarios WHERE id = ? LIMIT 1",
    [usuarioId],
  );
  if (!row) return null;
  return {
    id: Number(row.id),
    email: String(row.email),
    rol: row.rol,
    activo: Number(row.activo) === 1,
    tokenVersion: Number(row.token_version ?? 0),
  };
}

export async function estaRevocadoElJti(jti: string, q: Queryable = pool): Promise<boolean> {
  if (!jti) return false;
  const row = await qOne<{ jti: string }>(q, "SELECT jti FROM sesiones_revocadas WHERE jti = ? LIMIT 1", [jti]);
  return Boolean(row);
}

/** Logout de un dispositivo: invalida solo ese token. */
export async function revocarJti(
  jti: string,
  usuarioId: number,
  expiraEn: Date,
  q: Queryable = pool,
): Promise<void> {
  if (!jti) return;
  await qRun(
    q,
    `INSERT INTO sesiones_revocadas (jti, usuario_id, expires_at)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE revocado_en = CURRENT_TIMESTAMP`,
    [jti, usuarioId, expiraEn],
  );
}

/**
 * Invalida TODAS las sesiones del usuario. Se llama al cambiar contrasena,
 * cambiar rol o desactivar la cuenta.
 */
export async function invalidarTodasLasSesiones(usuarioId: number, q: Queryable = pool): Promise<void> {
  await qRun(q, "UPDATE usuarios SET token_version = token_version + 1 WHERE id = ?", [usuarioId]);
}

/** Limpieza de filas vencidas: un jti caducado ya no puede usarse. */
export async function purgarSesionesRevocadasVencidas(q: Queryable = pool): Promise<number> {
  const { affectedRows } = await qRun(q, "DELETE FROM sesiones_revocadas WHERE expires_at < NOW()");
  return affectedRows;
}
