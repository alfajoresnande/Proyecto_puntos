import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { createWriteStream } from "fs";
import fs from "fs/promises";
import os from "os";
import path from "path";

type SpawnResult = {
  code: number;
  stderr: string;
};

export type FullBackupResult = {
  archivePath: string;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
};

const DEFAULT_KEEP_FILES = 8;
const DEFAULT_MYSQLDUMP_BIN = "mysqldump";
const DEFAULT_TAR_BIN = "tar";

function formatTimestamp(date = new Date()): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function isCommandMissingError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: string }).code;
  return code === "ENOENT";
}

function runCommand(command: string, args: string[], options?: { env?: NodeJS.ProcessEnv }): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: options?.env ?? process.env,
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stderr: stderr.trim() }));
  });
}

async function runMysqlDumpToFile(outputPath: string): Promise<void> {
  const mysqlDumpBin = (process.env.MYSQLDUMP_BIN || DEFAULT_MYSQLDUMP_BIN).trim() || DEFAULT_MYSQLDUMP_BIN;
  const host = process.env.MYSQL_HOST || "localhost";
  const port = process.env.MYSQL_PORT || "3306";
  const database = process.env.MYSQL_DATABASE || "nande_puntos";
  const user = process.env.MYSQL_USER || "nande_user";
  const password = process.env.MYSQL_PASSWORD || "";

  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  await new Promise<void>((resolve, reject) => {
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

    const child = spawn(mysqlDumpBin, args, {
      env: {
        ...process.env,
        MYSQL_PWD: password,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    const output = createWriteStream(outputPath, { encoding: "utf8" });
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

function resolveBackupsDir(backendRoot: string): string {
  const configured = (process.env.BACKUP_OUTPUT_DIR || "backups").trim();
  if (!configured) return path.join(backendRoot, "backups");
  return path.isAbsolute(configured) ? configured : path.resolve(backendRoot, configured);
}

function resolveBackendRoot(): string {
  const candidate = path.resolve(__dirname, "..", "..");
  const base = path.basename(candidate).toLowerCase();
  if (base === "src" || base === "dist") {
    return path.dirname(candidate);
  }
  return process.cwd();
}

async function pruneOldBackups(backupsDir: string): Promise<void> {
  const parsed = Number(process.env.BACKUP_KEEP_FILES || DEFAULT_KEEP_FILES);
  const keepFiles = Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, 100)) : DEFAULT_KEEP_FILES;

  const entries = await fs.readdir(backupsDir, { withFileTypes: true });
  const files = (
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && /^backup-full-\d{8}-\d{6}\.tar\.gz$/.test(entry.name))
        .map(async (entry) => {
          const fullPath = path.join(backupsDir, entry.name);
          const stat = await fs.stat(fullPath);
          return { name: entry.name, fullPath, mtimeMs: stat.mtimeMs };
        }),
    )
  ).sort((a, b) => b.mtimeMs - a.mtimeMs);

  const toDelete = files.slice(keepFiles);
  await Promise.all(toDelete.map((item) => fs.unlink(item.fullPath).catch(() => undefined)));
}

export async function createFullBackupArchive(): Promise<FullBackupResult> {
  const tarBin = (process.env.TAR_BIN || DEFAULT_TAR_BIN).trim() || DEFAULT_TAR_BIN;
  const backendRoot = resolveBackendRoot();
  const uploadsDir = path.join(backendRoot, "uploads");
  const backupsDir = resolveBackupsDir(backendRoot);

  const timestamp = formatTimestamp();
  const fileName = `backup-full-${timestamp}.tar.gz`;
  const archivePath = path.join(backupsDir, fileName);
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nande-backup-"));
  const tempWorkingDir = path.join(tmpRoot, randomUUID());

  try {
    await fs.mkdir(tempWorkingDir, { recursive: true });
    await fs.mkdir(backupsDir, { recursive: true });

    const sqlDumpPath = path.join(tempWorkingDir, "database.sql");
    await runMysqlDumpToFile(sqlDumpPath);

    const uploadsExists = await fs
      .stat(uploadsDir)
      .then((stats) => stats.isDirectory())
      .catch(() => false);

    const metadata = {
      created_at: new Date().toISOString(),
      mysql_database: process.env.MYSQL_DATABASE || "nande_puntos",
      includes_uploads: uploadsExists,
    };
    await fs.writeFile(path.join(tempWorkingDir, "backup-meta.json"), JSON.stringify(metadata, null, 2), "utf8");

    const tarArgs = ["-czf", archivePath, "-C", tempWorkingDir, "database.sql", "backup-meta.json"];
    if (uploadsExists) {
      tarArgs.push("-C", backendRoot, "uploads");
    }

    const tarResult = await runCommand(tarBin, tarArgs);
    if (tarResult.code !== 0) {
      throw new Error(`tar fallo: ${tarResult.stderr || `codigo ${tarResult.code}`}`);
    }

    const archiveStat = await fs.stat(archivePath);
    await pruneOldBackups(backupsDir);

    return {
      archivePath,
      fileName,
      sizeBytes: archiveStat.size,
      createdAt: new Date().toISOString(),
    };
  } catch (error) {
    if (isCommandMissingError(error)) {
      throw new Error("Falta comando de sistema para backups. Configura MYSQLDUMP_BIN/TAR_BIN o instala mysqldump/tar.");
    }
    throw error;
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}
