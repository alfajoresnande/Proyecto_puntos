"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Bootstrap administrativo de un solo uso.
 *
 * Reemplaza al seed de admins que estaba en database/schema.sql con la
 * contrasena en texto claro (SEC-02).
 *
 * Uso:
 *   ADMIN_BOOTSTRAP_EMAIL=... ADMIN_BOOTSTRAP_PASSWORD=... \
 *     npm run admin:bootstrap --prefix backend
 *
 * Propiedades:
 * - Toma la credencial de variables de entorno; nunca la genera ni la imprime.
 * - Es de un solo uso: si ya existe algun admin/superAdmin, no hace nada.
 *   Con ADMIN_BOOTSTRAP_FORCE=true se puede rotar una cuenta existente.
 * - No deja rastro de la clave en el repositorio ni en el log.
 */
require("dotenv/config");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const db_1 = require("../db");
const MIN_PASSWORD_LENGTH = 12;
function fail(message) {
    console.error(`[admin:bootstrap] ${message}`);
    process.exit(1);
}
function isEnabled(raw) {
    return ["1", "true", "yes", "on"].includes((raw || "").trim().toLowerCase());
}
/**
 * Requisitos minimos. Deliberadamente no se sugiere ni se genera ninguna
 * contrasena: la elige la persona que opera y viaja por el entorno.
 */
function validatePassword(password) {
    if (password.length < MIN_PASSWORD_LENGTH) {
        return `La contrasena debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
    }
    if (!/[a-z]/.test(password))
        return "La contrasena debe incluir minusculas.";
    if (!/[A-Z]/.test(password))
        return "La contrasena debe incluir mayusculas.";
    if (!/[0-9]/.test(password))
        return "La contrasena debe incluir numeros.";
    if (!/[^A-Za-z0-9]/.test(password))
        return "La contrasena debe incluir un simbolo.";
    return null;
}
async function main() {
    const email = (process.env.ADMIN_BOOTSTRAP_EMAIL || "").trim().toLowerCase();
    const password = process.env.ADMIN_BOOTSTRAP_PASSWORD || "";
    const nombre = (process.env.ADMIN_BOOTSTRAP_NOMBRE || "Administrador").trim();
    const rol = (process.env.ADMIN_BOOTSTRAP_ROL || "superAdmin").trim();
    const force = isEnabled(process.env.ADMIN_BOOTSTRAP_FORCE);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        fail("Defini ADMIN_BOOTSTRAP_EMAIL con un email valido.");
    }
    if (!password) {
        fail("Defini ADMIN_BOOTSTRAP_PASSWORD. El script no genera contrasenas.");
    }
    if (!["admin", "superAdmin"].includes(rol)) {
        fail("ADMIN_BOOTSTRAP_ROL debe ser 'admin' o 'superAdmin'.");
    }
    const passwordProblem = validatePassword(password);
    if (passwordProblem)
        fail(passwordProblem);
    const existente = await (0, db_1.qOne)(db_1.pool, "SELECT COUNT(*) AS total FROM usuarios WHERE rol IN ('admin','superAdmin')");
    const yaHayAdmins = Number(existente?.total ?? 0) > 0;
    if (yaHayAdmins && !force) {
        console.error("[admin:bootstrap] Ya existe al menos una cuenta administrativa. " +
            "El bootstrap es de un solo uso. Para rotar una cuenta concreta, " +
            "corre de nuevo con ADMIN_BOOTSTRAP_FORCE=true.");
        process.exit(2);
    }
    const hash = await bcryptjs_1.default.hash(password, 12);
    const usuario = await (0, db_1.qOne)(db_1.pool, "SELECT id FROM usuarios WHERE email = ?", [email]);
    if (usuario) {
        // Rotacion: cambia la clave, reafirma el rol y corta todas las sesiones
        // vivas de esa cuenta subiendo token_version.
        await (0, db_1.qRun)(db_1.pool, `UPDATE usuarios
       SET password_hash = ?, rol = ?, activo = 1, email_verificado = 1,
           email_verificado_at = COALESCE(email_verificado_at, NOW()),
           token_version = token_version + 1
       WHERE id = ?`, [hash, rol, usuario.id]);
        await (0, db_1.qRun)(db_1.pool, "UPDATE password_reset_tokens SET used_at = NOW() WHERE usuario_id = ? AND used_at IS NULL", [
            usuario.id,
        ]);
        console.log(`[admin:bootstrap] Cuenta actualizada (id ${usuario.id}, rol ${rol}). Sesiones previas invalidadas.`);
    }
    else {
        const { insertId } = await (0, db_1.qRun)(db_1.pool, `INSERT INTO usuarios (nombre, email, email_verificado, email_verificado_at, password_hash, rol, activo)
       VALUES (?, ?, 1, NOW(), ?, ?, 1)`, [nombre, email, hash, rol]);
        console.log(`[admin:bootstrap] Cuenta creada (id ${insertId}, rol ${rol}).`);
    }
    console.log("[admin:bootstrap] Listo. Borra ADMIN_BOOTSTRAP_PASSWORD del entorno y del historial del shell.");
}
main()
    .catch((error) => {
    console.error("[admin:bootstrap] Error:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
})
    .finally(async () => {
    await db_1.pool.end().catch(() => { });
});
