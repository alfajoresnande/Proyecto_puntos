import "express-async-errors";
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
import { authCookiePolicy } from "./auth";
import {
  CSRF_HEADER_NAME,
  csrfSessionBinding,
  emitCsrfToken,
  readCsrfCookie,
  setCsrfCookie,
  verifyCsrfToken,
} from "./csrf";
import { readTokenFromCookies } from "./authCookie";
import { buildReadinessReport } from "./readiness";
import { attachRealtimeServer } from "./realtime";
import { startReservationExpirationWorker } from "./services/expirations";
import fs from "fs";
import { UPLOADS_DIR, UPLOADS_DIR_SOURCE, UPLOADS_DIR_AMBIGUOUS } from "./paths";
import { createVariantOnDemandMiddleware } from "./services/variantOnDemand";
import { runOneTimeWebCheckoutPointsBackfill } from "./services/startupBackfills";
import { checkImageProcessingAvailable } from "./services/imageVariants";

const app = express();
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const IS_PRODUCTION = (process.env.NODE_ENV || "").trim().toLowerCase() === "production";

// SEC-06: `http://localhost:5173` estaba en la lista incluso en produccion, o
// sea que una app local podia hacer peticiones con credenciales contra la API
// de produccion. Ahora los origenes loopback solo se confian en desarrollo.
const PRODUCTION_FRONTEND_ORIGINS = [
  "https://alfajorescorrentinos.com",
  "https://www.alfajorescorrentinos.com",
];
const DEVELOPMENT_FRONTEND_ORIGINS = ["http://localhost:5173"];
const DEFAULT_FRONTEND_ORIGINS = (
  IS_PRODUCTION ? PRODUCTION_FRONTEND_ORIGINS : [...DEVELOPMENT_FRONTEND_ORIGINS, ...PRODUCTION_FRONTEND_ORIGINS]
).join(",");

function isLoopbackOrigin(origin: string): boolean {
  const normalized = toOrigin(origin);
  if (!normalized) return false;
  const hostname = new URL(normalized).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

/** En produccion se descarta cualquier origen loopback venga de donde venga. */
function dropLoopbackInProduction(origins: string[]): string[] {
  if (!IS_PRODUCTION) return origins;
  const kept: string[] = [];
  for (const origin of origins) {
    if (isLoopbackOrigin(origin)) {
      console.warn(`[cors] Origen loopback ignorado en produccion: ${origin}`);
      continue;
    }
    kept.push(origin);
  }
  return kept;
}

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
  const declared = [
    ...parseOrigins(DEFAULT_FRONTEND_ORIGINS, ""),
    ...parseOrigins(process.env.FRONTEND_URL, ""),
    ...parseOrigins(process.env.CORS_ALLOWED_ORIGINS, ""),
    ...parseOrigins(process.env.ALLOWED_ORIGINS, ""),
    ...parseOrigins(process.env.ALLOWED_FRONTEND_ORIGINS, ""),
  ];
  // Los alias loopback (localhost <-> 127.0.0.1) solo tienen sentido en dev.
  const expanded = IS_PRODUCTION ? declared : addLoopbackAliases(declared);
  return new Set(addWebAliases(dropLoopbackInProduction(expanded)));
}

let readinessDegradedLogged = false;

const allowedOrigins = buildAllowedOrigins();
const allowedOriginsList = [...allowedOrigins];
const isAllowedOrigin = (origin: string | undefined) => {
  const normalized = toOrigin(origin);
  return !!normalized && allowedOrigins.has(normalized);
};
const trustedCsrfOrigins = new Set(
  dropLoopbackInProduction(
    IS_PRODUCTION
      ? [...allowedOriginsList, ...parseOrigins(process.env.CSRF_TRUSTED_ORIGINS, "")]
      : addLoopbackAliases([...allowedOriginsList, ...parseOrigins(process.env.CSRF_TRUSTED_ORIGINS, "")]),
  ),
);

const CSRF_SECRET = process.env.CSRF_SECRET?.trim() || process.env.JWT_SECRET || "";

/** Ata el token CSRF a la sesion actual del navegador. */
function bindingForRequest(req: Request): string {
  const sessionToken = readTokenFromCookies(req.headers.cookie, authCookiePolicy);
  return csrfSessionBinding(sessionToken, CSRF_SECRET);
}

function issueCsrfToken(req: Request, res: Response): string {
  const token = emitCsrfToken(bindingForRequest(req), { secret: CSRF_SECRET });
  setCsrfCookie(res, token, { secure: authCookiePolicy.secure, sameSite: authCookiePolicy.sameSite });
  return token;
}

/**
 * CSRF: double-submit firmado con HMAC y ligado a la sesion (SEC-07).
 *
 * Antes solo se comprobaba que el header midiera >= 16 caracteres, asi que
 * cualquier valor inventado pasaba. Ahora el token lo emite el servidor,
 * lleva firma propia y solo vale para la sesion que lo pidio.
 *
 * Se conserva la validacion estricta de Origin y de Fetch Metadata: son
 * capas independientes, no sustitutas.
 */
function csrfProtection(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    // En una peticion segura se aprovecha para sembrar la cookie del
    // double-submit, pero solo si falta o dejo de ser valida para esta sesion.
    // Rotarla en cada GET haria fallar los POST que ya estan en vuelo.
    const binding = bindingForRequest(req);
    const actual = readCsrfCookie(req);
    if (verifyCsrfToken(actual, actual, binding, { secret: CSRF_SECRET }).ok) {
      res.locals.csrfToken = actual;
    } else {
      // Se deja en res.locals para que GET /api/csrf devuelva EXACTAMENTE el
      // mismo valor y no emita una segunda cookie distinta.
      res.locals.csrfToken = issueCsrfToken(req, res);
    }
    next();
    return;
  }

  // Excepcion de webhooks: SOLO vale porque esa ruta se autentica con la firma
  // propia del proveedor (ver routes/pagos.ts). Sin esa firma no habria motivo
  // para eximirla.
  if (req.path.startsWith("/pagos/webhook/")) {
    next();
    return;
  }

  const originHeader = req.get("origin");
  const refererHeader = req.get("referer");
  const requestOrigin = toOrigin(originHeader) ?? toOrigin(refererHeader);
  if (requestOrigin && !trustedCsrfOrigins.has(requestOrigin)) {
    recordSecurityEvent("csrf_bloqueado_origen_no_confiable", req, { requestOrigin });
    res.status(403).json({ error: "Origen no permitido para metodos mutables" });
    return;
  }

  const fetchSite = (req.get("sec-fetch-site") || "").toLowerCase();
  if (fetchSite === "cross-site" && !requestOrigin) {
    recordSecurityEvent("csrf_bloqueado_sitio_cruzado", req, { fetchSite });
    res.status(403).json({ error: "Solicitud bloqueada por politica CSRF" });
    return;
  }

  const resultado = verifyCsrfToken(req.get(CSRF_HEADER_NAME), readCsrfCookie(req), bindingForRequest(req), {
    secret: CSRF_SECRET,
  });
  if (!resultado.ok) {
    recordSecurityEvent("csrf_token_faltante_o_invalido", req, { reason: resultado.reason });
    res.status(403).json({ error: "CSRF token faltante o invalido" });
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

// Liveness: solo dice que el proceso responde. No mira dependencias.
app.get("/api/health", (_req, res) => res.json({ ok: true, ts: new Date() }));
app.get("/api/live", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Readiness: 503 si MySQL no responde. Sin base no hay autenticacion, ni rate
// limiting, ni persistencia de eventos de seguridad: la instancia no puede
// anunciarse lista (SEC-05).
app.get("/api/ready", async (_req, res) => {
  const report = await buildReadinessReport();
  if (!report.ready) {
    if (!readinessDegradedLogged) {
      readinessDegradedLogged = true;
      console.error("[readiness] La instancia NO esta lista: MySQL no responde.", report.checks.db);
    }
    res.status(503).json(report);
    return;
  }
  if (readinessDegradedLogged) {
    readinessDegradedLogged = false;
    console.log("[readiness] MySQL volvio a responder. Instancia lista.");
  }
  res.json(report);
});

/**
 * Emite el token CSRF. El frontend lo pide una vez y despues lo reenvia en
 * el header; la cookie del double-submit se setea aca.
 */
app.get("/api/csrf", (req, res) => {
  // csrfProtection ya sembro o valido la cookie en este mismo request.
  const token = (res.locals.csrfToken as string | undefined) || issueCsrfToken(req, res);
  res.json({ token });
});
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
  // La migracion masiva a WebP NO corre automaticamente: reescribia las
  // referencias de la base y, al restaurarse la carpeta uploads desde un
  // backup anterior, quedaban apuntando a archivos inexistentes. Ahora cada
  // imagen se resuelve al vuelo en variantOnDemand.ts. Para migrar en serio,
  // usar scripts/migrateUploadsToWebp.ts a mano.
});
