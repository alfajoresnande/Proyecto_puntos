"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFullBackupArchive = createFullBackupArchive;
const child_process_1 = require("child_process");
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const promises_1 = __importDefault(require("fs/promises"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const DEFAULT_KEEP_FILES = 8;
const DEFAULT_MYSQLDUMP_BIN = "mysqldump";
const DEFAULT_TAR_BIN = "tar";
function formatTimestamp(date = new Date()) {
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(date.getUTCDate()).padStart(2, "0");
    const hh = String(date.getUTCHours()).padStart(2, "0");
    const mi = String(date.getUTCMinutes()).padStart(2, "0");
    const ss = String(date.getUTCSeconds()).padStart(2, "0");
    return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}
function isCommandMissingError(error) {
    if (!error || typeof error !== "object")
        return false;
    const code = error.code;
    return code === "ENOENT";
}
function runCommand(command, args, options) {
    return new Promise((resolve, reject) => {
        const child = (0, child_process_1.spawn)(command, args, {
            env: options?.env ?? process.env,
            stdio: ["ignore", "ignore", "pipe"],
        });
        let stderr = "";
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        child.on("error", reject);
        child.on("close", (code) => resolve({ code: code ?? -1, stderr: stderr.trim() }));
    });
}
async function runMysqlDumpToFile(outputPath) {
    const mysqlDumpBin = (process.env.MYSQLDUMP_BIN || DEFAULT_MYSQLDUMP_BIN).trim() || DEFAULT_MYSQLDUMP_BIN;
    const host = process.env.MYSQL_HOST || "localhost";
    const port = process.env.MYSQL_PORT || "3306";
    const database = process.env.MYSQL_DATABASE || "nande_puntos";
    const user = process.env.MYSQL_USER || "nande_user";
    const password = process.env.MYSQL_PASSWORD || "";
    await promises_1.default.mkdir(path_1.default.dirname(outputPath), { recursive: true });
    await new Promise((resolve, reject) => {
        const args = [
            "--single-transaction",
            "--quick",
            "--routines",
            "--triggers",
            `--host=${host}`,
            `--port=${port}`,
            `--user=${user}`,
            database,
        ];
        const child = (0, child_process_1.spawn)(mysqlDumpBin, args, {
            env: {
                ...process.env,
                MYSQL_PWD: password,
            },
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stderr = "";
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        const output = (0, fs_1.createWriteStream)(outputPath, { encoding: "utf8" });
        child.stdout.pipe(output);
        output.on("error", reject);
        child.on("error", (error) => {
            output.destroy();
            reject(error);
        });
        child.on("close", (code) => {
            output.end();
            if (code === 0) {
                resolve();
                return;
            }
            const detail = stderr.trim() || `codigo ${code ?? -1}`;
            reject(new Error(`mysqldump fallo: ${detail}`));
        });
    });
}
function resolveBackupsDir(backendRoot) {
    const configured = (process.env.BACKUP_OUTPUT_DIR || "backups").trim();
    if (!configured)
        return path_1.default.join(backendRoot, "backups");
    return path_1.default.isAbsolute(configured) ? configured : path_1.default.resolve(backendRoot, configured);
}
function resolveBackendRoot() {
    const candidate = path_1.default.resolve(__dirname, "..", "..");
    const base = path_1.default.basename(candidate).toLowerCase();
    if (base === "src" || base === "dist") {
        return path_1.default.dirname(candidate);
    }
    return process.cwd();
}
async function pruneOldBackups(backupsDir) {
    const parsed = Number(process.env.BACKUP_KEEP_FILES || DEFAULT_KEEP_FILES);
    const keepFiles = Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, 100)) : DEFAULT_KEEP_FILES;
    const entries = await promises_1.default.readdir(backupsDir, { withFileTypes: true });
    const files = (await Promise.all(entries
        .filter((entry) => entry.isFile() && /^backup-full-\d{8}-\d{6}\.tar\.gz$/.test(entry.name))
        .map(async (entry) => {
        const fullPath = path_1.default.join(backupsDir, entry.name);
        const stat = await promises_1.default.stat(fullPath);
        return { name: entry.name, fullPath, mtimeMs: stat.mtimeMs };
    }))).sort((a, b) => b.mtimeMs - a.mtimeMs);
    const toDelete = files.slice(keepFiles);
    await Promise.all(toDelete.map((item) => promises_1.default.unlink(item.fullPath).catch(() => undefined)));
}
async function createFullBackupArchive() {
    const tarBin = (process.env.TAR_BIN || DEFAULT_TAR_BIN).trim() || DEFAULT_TAR_BIN;
    const backendRoot = resolveBackendRoot();
    const uploadsDir = path_1.default.join(backendRoot, "uploads");
    const backupsDir = resolveBackupsDir(backendRoot);
    const timestamp = formatTimestamp();
    const fileName = `backup-full-${timestamp}.tar.gz`;
    const archivePath = path_1.default.join(backupsDir, fileName);
    const tmpRoot = await promises_1.default.mkdtemp(path_1.default.join(os_1.default.tmpdir(), "nande-backup-"));
    const tempWorkingDir = path_1.default.join(tmpRoot, (0, crypto_1.randomUUID)());
    try {
        await promises_1.default.mkdir(tempWorkingDir, { recursive: true });
        await promises_1.default.mkdir(backupsDir, { recursive: true });
        const sqlDumpPath = path_1.default.join(tempWorkingDir, "database.sql");
        await runMysqlDumpToFile(sqlDumpPath);
        const uploadsExists = await promises_1.default
            .stat(uploadsDir)
            .then((stats) => stats.isDirectory())
            .catch(() => false);
        const metadata = {
            created_at: new Date().toISOString(),
            mysql_database: process.env.MYSQL_DATABASE || "nande_puntos",
            includes_uploads: uploadsExists,
        };
        await promises_1.default.writeFile(path_1.default.join(tempWorkingDir, "backup-meta.json"), JSON.stringify(metadata, null, 2), "utf8");
        const tarArgs = ["-czf", archivePath, "-C", tempWorkingDir, "database.sql", "backup-meta.json"];
        if (uploadsExists) {
            tarArgs.push("-C", backendRoot, "uploads");
        }
        const tarResult = await runCommand(tarBin, tarArgs);
        if (tarResult.code !== 0) {
            throw new Error(`tar fallo: ${tarResult.stderr || `codigo ${tarResult.code}`}`);
        }
        const archiveStat = await promises_1.default.stat(archivePath);
        await pruneOldBackups(backupsDir);
        return {
            archivePath,
            fileName,
            sizeBytes: archiveStat.size,
            createdAt: new Date().toISOString(),
        };
    }
    catch (error) {
        if (isCommandMissingError(error)) {
            throw new Error("Falta comando de sistema para backups. Configura MYSQLDUMP_BIN/TAR_BIN o instala mysqldump/tar.");
        }
        throw error;
    }
    finally {
        await promises_1.default.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
    }
}
