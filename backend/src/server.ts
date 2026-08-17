import "dotenv/config";
import http from "http";
import path from "path";
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import "./db";

import authRoutes from "./routes/auth";
import clienteRoutes from "./routes/cliente";
import vendedorRoutes from "./routes/vendedor";
import adminRoutes from "./routes/admin";
import productosRoutes from "./routes/productos";
import paginasRoutes from "./routes/paginas";
import diagnosticoRoutes from "./routes/diagnostico";
import pagosRoutes from "./routes/pagos";
import soporteRoutes from "./routes/soporte";
import ubicacionesRoutes from "./routes/ubicaciones";
import postulacionesRoutes from "./routes/postulaciones";
import arrepentimientoRoutes from "./routes/arrepentimiento";
import meAddressesRoutes from "./routes/meAddresses";
import presenciaRoutes from "./routes/presencia";
import aiChatRoutes from "./routes/aiChat.routes";
import layoutRoutes from "./routes/layout";
import { recordSecurityEvent } from "./securityMonitor";
import { attachRealtimeServer } from "./realtime";
import { startReservationExpirationWorker } from "./services/expirations";
import fs from "fs";
import { UPLOADS_DIR, UPLOADS_DIR_SOURCE, UPLOADS_DIR_AMBIGUOUS } from "./paths";
import { createVariantOnDemandMiddleware } from "./services/variantOnDemand";
import { runOneTimeWebCheckoutPointsBackfill, runOneTimeUploadsWebpMigration } from "./services/startupBackfills";
import { checkImageProcessingAvailable } from "./services/imageVariants";

const app = express();
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const DEFAULT_FRONTEND_ORIGINS = [
  "http://localhost:5173",
  "https://alfajorescorrentinos.com",
  "https://www.alfajorescorrentinos.com",
].join(",");

function parseOrigins(raw: string | undefined, fallback: string): string[] {
  const origins = (raw ?? fallback)
    .split(",")
    .map((origin) => {
      const trimmed = origin.trim();
      if (!trimmed) return "";
      return toOrigin(trimmed) ?? trimmed.replace(/\/+$/, "");
    })
    .filter(Boolean);

  return Array.from(new Set(origins));
}

function toOrigin(input: string | undefined): string | null {
  if (!input) return null;
  try {
    return new URL(input).origin;
  } catch {
    return null;
  }
}

function addLoopbackAliases(origins: string[]): string[] {
  const expanded = new Set(origins);

  for (const origin of origins) {
    const normalized = toOrigin(origin);
    if (!normalized) continue;

    const url = new URL(normalized);
    const port = url.port ? `:${url.port}` : "";
    if (url.hostname === "localhost") {
      expanded.add(`${url.protocol}//127.0.0.1${port}`);
    } else if (url.hostname === "127.0.0.1") {
      expanded.add(`${url.protocol}//localhost${port}`);
    }
  }

  return [...expanded];
}

function addWebAliases(origins: string[]): string[] {
  const expanded = new Set(origins);

  for (const origin of origins) {
    const normalized = toOrigin(origin);
    if (!normalized) continue;

    const url = new URL(normalized);
    const port = url.port ? `:${url.port}` : "";
    if (url.hostname.startsWith("www.")) {
      expanded.add(`${url.protocol}//${url.hostname.replace(/^www\./, "")}${port}`);
    } else if (!url.hostname.includes("localhost") && url.hostname !== "127.0.0.1") {
      expanded.add(`${url.protocol}//www.${url.hostname}${port}`);
    }
  }

  return [...expanded];
}

function buildAllowedOrigins() {
  return new Set(
    addWebAliases(
      addLoopbackAliases([
        ...parseOrigins(DEFAULT_FRONTEND_ORIGINS, ""),
        ...parseOrigins(process.env.FRONTEND_URL, ""),
        ...parseOrigins(process.env.CORS_ALLOWED_ORIGINS, ""),
        ...parseOrigins(process.env.ALLOWED_ORIGINS, ""),
        ...parseOrigins(process.env.ALLOWED_FRONTEND_ORIGINS, ""),
      ])
    )
  );
}

const allowedOrigins = buildAllowedOrigins();
const allowedOriginsList = [...allowedOrigins];
const isAllowedOrigin = (origin: string | undefined) => {
  const normalized = toOrigin(origin);
  return !!normalized && allowedOrigins.has(normalized);
};
const trustedCsrfOrigins = new Set(
  addLoopbackAliases([
    ...allowedOriginsList,
    ...parseOrigins(process.env.CSRF_TRUSTED_ORIGINS, ""),
  ])
);

function csrfProtection(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    next();
    return;
  }

  if (req.path.startsWith("/pagos/webhook/")) {
    next();
    return;
  }

  const csrfToken = req.get("x-csrf-token")?.trim() || "";
  if (csrfToken.length < 16) {
    recordSecurityEvent("csrf_token_faltante_o_invalido", req);
    res.status(403).json({ error: "CSRF token faltante o invalido" });
    return;
  }

  // Validate browser origin when present. Non-browser clients usually omit it.
  const originHeader = req.get("origin");
  const refererHeader = req.get("referer");
  const requestOrigin = toOrigin(originHeader) ?? toOrigin(refererHeader);
  if (requestOrigin && !trustedCsrfOrigins.has(requestOrigin)) {
    recordSecurityEvent("csrf_bloqueado_origen_no_confiable", req, { requestOrigin });
    res.status(403).json({ error: "Origen no permitido para metodos mutables" });
    return;
  }

  // Browser hint: reject cross-site mutation requests only when the origin
  // was not explicitly trusted above.
  const fetchSite = (req.get("sec-fetch-site") || "").toLowerCase();
  if (fetchSite === "cross-site" && !requestOrigin) {
    recordSecurityEvent("csrf_bloqueado_sitio_cruzado", req, { fetchSite });
    res.status(403).json({ error: "Solicitud bloqueada por politica CSRF" });
    return;
  }

  next();
}

// Proxy: req.ip real cuando corremos detras de Nginx/Docker/CF
// Con un unico hop de proxy; aumentar si hay mas capas.
const TRUST_PROXY = process.env.TRUST_PROXY;
if (TRUST_PROXY) {
  const normalizedTrustProxy = TRUST_PROXY.trim().toLowerCase();
  if (!["0", "false", "off", "no"].includes(normalizedTrustProxy)) {
    app.set("trust proxy", Number.isNaN(Number(TRUST_PROXY)) ? TRUST_PROXY : Number(TRUST_PROXY));
  }
}

// Seguridad: headers HTTP seguros
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", "data:", "blob:", "https:", "http:"],
      },
    },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  })
);

// CORS: solo dominios permitidos
app.use(
  cors((req, cb) => {
    const origin = req.get("origin");
    // Permitir requests sin origin (Postman, apps moviles, curl)
    if (!origin || isAllowedOrigin(origin)) {
      cb(null, {
        origin: origin ? toOrigin(origin) || origin : false,
        credentials: true,
        methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token", "x-csrf-token"],
        optionsSuccessStatus: 204,
        maxAge: 86400,
      });
      return;
    }
    recordSecurityEvent("cors_bloqueado_origen", req, { origin });
    cb(new Error("CORS no permitido para este origen"));
  })
);

app.use(express.json({ limit: "1mb" }));

// Servir imagenes subidas estaticamente
// Usa UPLOADS_DIR de paths.ts para que funcione tanto en dev (src/) como en prod (dist/src/)
const uploadsPath = UPLOADS_DIR;
console.log(`[uploads] Sirviendo archivos estáticos desde: ${uploadsPath} (origen: ${UPLOADS_DIR_SOURCE})`);
// Diagnostico de arranque: sin consola en el hosting, este resumen en el log
// es la unica forma de saber si el backend esta mirando la carpeta correcta.
if (UPLOADS_DIR_AMBIGUOUS) {
  console.warn(
    `[uploads] ATENCION: tambien existe ${UPLOADS_DIR_AMBIGUOUS}. Se esta usando ${uploadsPath}. ` +
      "Si la carpeta buena es la otra, defini UPLOADS_DIR en el entorno o las subidas nuevas se pierden en el proximo deploy.",
  );
}
try {
  if (!fs.existsSync(uploadsPath)) {
    console.error(`[uploads] ATENCION: la carpeta ${uploadsPath} NO existia. Defini UPLOADS_DIR en el entorno.`);
    // Se crea igual para que las subidas no fallen mientras tanto.
    fs.mkdirSync(uploadsPath, { recursive: true });
  } else {
    const archivos = fs.readdirSync(uploadsPath).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
    const canonicos = archivos.filter((f) => !/-(card|thumb)\.webp$/i.test(f));
    const variantes = archivos.length - canonicos.length;
    console.log(`[uploads] ${canonicos.length} imagen(es) canonica(s), ${variantes} variante(s) generada(s).`);
  }
} catch (error) {
  console.error("[uploads] No se pudo inspeccionar la carpeta:", error instanceof Error ? error.message : error);
}

// sharp es nativo y puede no cargar en algunos hostings. El server arranca
// igual (solo se caen las subidas), pero conviene que se vea en los logs.
const imageProcessing = checkImageProcessingAvailable();
if (!imageProcessing.ok) {
  console.error(
    `[uploads] ATENCION: sharp no se pudo cargar, la subida de imagenes va a fallar. Motivo: ${imageProcessing.reason}`
  );
}
const uploadsStatic = express.static(uploadsPath, {
  setHeaders: (res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    // Los nombres de archivo son únicos por contenido (uuid+timestamp),
    // así que el contenido de una URL nunca cambia: cache inmutable de 1 año.
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    // Permitir que el frontend (otro dominio) cargue las imágenes en <img> tags
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  },
});
// Se registra ANTES del static: si falta una variante -card/-thumb la genera
// y la guarda, y recien despues el static la sirve. Necesario porque en el
// hosting la carpeta uploads se copia a mano despues del deploy, o sea que al
// arrancar el servidor todavia no estan las imagenes reales.
const variantOnDemand = createVariantOnDemandMiddleware(uploadsPath);
app.use("/uploads", variantOnDemand, uploadsStatic);
app.use("/api/uploads", variantOnDemand, uploadsStatic);

app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.use("/api", csrfProtection);

// Rutas
app.get("/", (_req, res) => {
  res.redirect(302, "/diagnostico");
});

app.get("/api/health", (_req, res) => res.json({ ok: true, ts: new Date() }));
app.use("/diagnostico", diagnosticoRoutes);
app.use("/api/diagnostico", diagnosticoRoutes);

app.use("/api/auth", authRoutes);
app.use("/api/productos", productosRoutes); // publico (catalogo)
app.use("/api/paginas", paginasRoutes); // publico (sobre nosotros, terminos)
app.use("/api/layout", layoutRoutes);
app.use("/api/ubicaciones", ubicacionesRoutes);
app.use("/api/presencia", presenciaRoutes);
app.use("/api/me/addresses", meAddressesRoutes);
app.use("/api/ai", aiChatRoutes);
app.use("/api/cliente", clienteRoutes);
app.use("/api/vendedor", vendedorRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/pagos", pagosRoutes);
app.use("/api/soporte", soporteRoutes);
app.use("/api/postulaciones", postulacionesRoutes);
app.use("/api/arrepentimiento", arrepentimientoRoutes);

// Manejo global de errores
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof Error && err.message === "CORS no permitido para este origen") {
    res.status(403).json({ error: err.message });
    return;
  }
  recordSecurityEvent("api_error_no_controlado", req, {
    message: err instanceof Error ? err.message : "unknown",
  });
  console.error(err);
  res.status(500).json({ error: "Error interno del servidor" });
});

const PORT = Number(process.env.PORT) || 4000;
const server = http.createServer(app);
attachRealtimeServer(server, allowedOrigins);

server.listen(PORT, () => {
  console.log("BUILD_VERSION puntos-fix-2026-05-12");
  console.log(`API en http://localhost:${PORT}`);
  startReservationExpirationWorker();
  void runOneTimeWebCheckoutPointsBackfill().catch((error) => {
    console.error(
      "[startup-backfill] Error ejecutando backfill unico de puntos web:",
      error instanceof Error ? error.message : error,
    );
  });
  // Migracion unica de imagenes viejas a WebP. Si falla, solo quedan las
  // imagenes como estaban: el servidor arranca igual.
  void runOneTimeUploadsWebpMigration().catch((error) => {
    console.error(
      "[uploads-webp] Error ejecutando la migracion unica a WebP:",
      error instanceof Error ? error.message : error,
    );
  });
});
