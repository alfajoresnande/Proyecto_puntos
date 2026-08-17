"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const http_1 = __importDefault(require("http"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
require("./db");
const auth_1 = __importDefault(require("./routes/auth"));
const cliente_1 = __importDefault(require("./routes/cliente"));
const vendedor_1 = __importDefault(require("./routes/vendedor"));
const admin_1 = __importDefault(require("./routes/admin"));
const productos_1 = __importDefault(require("./routes/productos"));
const paginas_1 = __importDefault(require("./routes/paginas"));
const diagnostico_1 = __importDefault(require("./routes/diagnostico"));
const pagos_1 = __importDefault(require("./routes/pagos"));
const soporte_1 = __importDefault(require("./routes/soporte"));
const ubicaciones_1 = __importDefault(require("./routes/ubicaciones"));
const postulaciones_1 = __importDefault(require("./routes/postulaciones"));
const arrepentimiento_1 = __importDefault(require("./routes/arrepentimiento"));
const meAddresses_1 = __importDefault(require("./routes/meAddresses"));
const presencia_1 = __importDefault(require("./routes/presencia"));
const aiChat_routes_1 = __importDefault(require("./routes/aiChat.routes"));
const layout_1 = __importDefault(require("./routes/layout"));
const securityMonitor_1 = require("./securityMonitor");
const realtime_1 = require("./realtime");
const expirations_1 = require("./services/expirations");
const fs_1 = __importDefault(require("fs"));
const paths_1 = require("./paths");
const startupBackfills_1 = require("./services/startupBackfills");
const imageVariants_1 = require("./services/imageVariants");
const app = (0, express_1.default)();
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const DEFAULT_FRONTEND_ORIGINS = [
    "http://localhost:5173",
    "https://alfajorescorrentinos.com",
    "https://www.alfajorescorrentinos.com",
].join(",");
function parseOrigins(raw, fallback) {
    const origins = (raw ?? fallback)
        .split(",")
        .map((origin) => {
        const trimmed = origin.trim();
        if (!trimmed)
            return "";
        return toOrigin(trimmed) ?? trimmed.replace(/\/+$/, "");
    })
        .filter(Boolean);
    return Array.from(new Set(origins));
}
function toOrigin(input) {
    if (!input)
        return null;
    try {
        return new URL(input).origin;
    }
    catch {
        return null;
    }
}
function addLoopbackAliases(origins) {
    const expanded = new Set(origins);
    for (const origin of origins) {
        const normalized = toOrigin(origin);
        if (!normalized)
            continue;
        const url = new URL(normalized);
        const port = url.port ? `:${url.port}` : "";
        if (url.hostname === "localhost") {
            expanded.add(`${url.protocol}//127.0.0.1${port}`);
        }
        else if (url.hostname === "127.0.0.1") {
            expanded.add(`${url.protocol}//localhost${port}`);
        }
    }
    return [...expanded];
}
function addWebAliases(origins) {
    const expanded = new Set(origins);
    for (const origin of origins) {
        const normalized = toOrigin(origin);
        if (!normalized)
            continue;
        const url = new URL(normalized);
        const port = url.port ? `:${url.port}` : "";
        if (url.hostname.startsWith("www.")) {
            expanded.add(`${url.protocol}//${url.hostname.replace(/^www\./, "")}${port}`);
        }
        else if (!url.hostname.includes("localhost") && url.hostname !== "127.0.0.1") {
            expanded.add(`${url.protocol}//www.${url.hostname}${port}`);
        }
    }
    return [...expanded];
}
function buildAllowedOrigins() {
    return new Set(addWebAliases(addLoopbackAliases([
        ...parseOrigins(DEFAULT_FRONTEND_ORIGINS, ""),
        ...parseOrigins(process.env.FRONTEND_URL, ""),
        ...parseOrigins(process.env.CORS_ALLOWED_ORIGINS, ""),
        ...parseOrigins(process.env.ALLOWED_ORIGINS, ""),
        ...parseOrigins(process.env.ALLOWED_FRONTEND_ORIGINS, ""),
    ])));
}
const allowedOrigins = buildAllowedOrigins();
const allowedOriginsList = [...allowedOrigins];
const isAllowedOrigin = (origin) => {
    const normalized = toOrigin(origin);
    return !!normalized && allowedOrigins.has(normalized);
};
const trustedCsrfOrigins = new Set(addLoopbackAliases([
    ...allowedOriginsList,
    ...parseOrigins(process.env.CSRF_TRUSTED_ORIGINS, ""),
]));
function csrfProtection(req, res, next) {
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
        (0, securityMonitor_1.recordSecurityEvent)("csrf_token_faltante_o_invalido", req);
        res.status(403).json({ error: "CSRF token faltante o invalido" });
        return;
    }
    // Validate browser origin when present. Non-browser clients usually omit it.
    const originHeader = req.get("origin");
    const refererHeader = req.get("referer");
    const requestOrigin = toOrigin(originHeader) ?? toOrigin(refererHeader);
    if (requestOrigin && !trustedCsrfOrigins.has(requestOrigin)) {
        (0, securityMonitor_1.recordSecurityEvent)("csrf_bloqueado_origen_no_confiable", req, { requestOrigin });
        res.status(403).json({ error: "Origen no permitido para metodos mutables" });
        return;
    }
    // Browser hint: reject cross-site mutation requests only when the origin
    // was not explicitly trusted above.
    const fetchSite = (req.get("sec-fetch-site") || "").toLowerCase();
    if (fetchSite === "cross-site" && !requestOrigin) {
        (0, securityMonitor_1.recordSecurityEvent)("csrf_bloqueado_sitio_cruzado", req, { fetchSite });
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
app.use((0, helmet_1.default)({
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
}));
// CORS: solo dominios permitidos
app.use((0, cors_1.default)((req, cb) => {
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
    (0, securityMonitor_1.recordSecurityEvent)("cors_bloqueado_origen", req, { origin });
    cb(new Error("CORS no permitido para este origen"));
}));
app.use(express_1.default.json({ limit: "1mb" }));
// Servir imagenes subidas estaticamente
// Usa UPLOADS_DIR de paths.ts para que funcione tanto en dev (src/) como en prod (dist/src/)
const uploadsPath = paths_1.UPLOADS_DIR;
console.log(`[uploads] Sirviendo archivos estáticos desde: ${uploadsPath} (origen: ${paths_1.UPLOADS_DIR_SOURCE})`);
// Diagnostico de arranque: sin consola en el hosting, este resumen en el log
// es la unica forma de saber si el backend esta mirando la carpeta correcta.
if (paths_1.UPLOADS_DIR_AMBIGUOUS) {
    console.warn(`[uploads] ATENCION: tambien existe ${paths_1.UPLOADS_DIR_AMBIGUOUS}. Se esta usando ${uploadsPath}. ` +
        "Si la carpeta buena es la otra, defini UPLOADS_DIR en el entorno o las subidas nuevas se pierden en el proximo deploy.");
}
try {
    if (!fs_1.default.existsSync(uploadsPath)) {
        console.error(`[uploads] ATENCION: la carpeta ${uploadsPath} NO existia. Defini UPLOADS_DIR en el entorno.`);
        // Se crea igual para que las subidas no fallen mientras tanto.
        fs_1.default.mkdirSync(uploadsPath, { recursive: true });
    }
    else {
        const archivos = fs_1.default.readdirSync(uploadsPath).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
        const canonicos = archivos.filter((f) => !/-(card|thumb)\.webp$/i.test(f));
        const variantes = archivos.length - canonicos.length;
        console.log(`[uploads] ${canonicos.length} imagen(es) canonica(s), ${variantes} variante(s) generada(s).`);
    }
}
catch (error) {
    console.error("[uploads] No se pudo inspeccionar la carpeta:", error instanceof Error ? error.message : error);
}
// sharp es nativo y puede no cargar en algunos hostings. El server arranca
// igual (solo se caen las subidas), pero conviene que se vea en los logs.
const imageProcessing = (0, imageVariants_1.checkImageProcessingAvailable)();
if (!imageProcessing.ok) {
    console.error(`[uploads] ATENCION: sharp no se pudo cargar, la subida de imagenes va a fallar. Motivo: ${imageProcessing.reason}`);
}
const uploadsStatic = express_1.default.static(uploadsPath, {
    setHeaders: (res) => {
        res.setHeader("X-Content-Type-Options", "nosniff");
        // Los nombres de archivo son únicos por contenido (uuid+timestamp),
        // así que el contenido de una URL nunca cambia: cache inmutable de 1 año.
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        // Permitir que el frontend (otro dominio) cargue las imágenes en <img> tags
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    },
});
app.use("/uploads", uploadsStatic);
app.use("/api/uploads", uploadsStatic);
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
app.use("/diagnostico", diagnostico_1.default);
app.use("/api/diagnostico", diagnostico_1.default);
app.use("/api/auth", auth_1.default);
app.use("/api/productos", productos_1.default); // publico (catalogo)
app.use("/api/paginas", paginas_1.default); // publico (sobre nosotros, terminos)
app.use("/api/layout", layout_1.default);
app.use("/api/ubicaciones", ubicaciones_1.default);
app.use("/api/presencia", presencia_1.default);
app.use("/api/me/addresses", meAddresses_1.default);
app.use("/api/ai", aiChat_routes_1.default);
app.use("/api/cliente", cliente_1.default);
app.use("/api/vendedor", vendedor_1.default);
app.use("/api/admin", admin_1.default);
app.use("/api/pagos", pagos_1.default);
app.use("/api/soporte", soporte_1.default);
app.use("/api/postulaciones", postulaciones_1.default);
app.use("/api/arrepentimiento", arrepentimiento_1.default);
// Manejo global de errores
app.use((err, req, res, _next) => {
    if (err instanceof Error && err.message === "CORS no permitido para este origen") {
        res.status(403).json({ error: err.message });
        return;
    }
    (0, securityMonitor_1.recordSecurityEvent)("api_error_no_controlado", req, {
        message: err instanceof Error ? err.message : "unknown",
    });
    console.error(err);
    res.status(500).json({ error: "Error interno del servidor" });
});
const PORT = Number(process.env.PORT) || 4000;
const server = http_1.default.createServer(app);
(0, realtime_1.attachRealtimeServer)(server, allowedOrigins);
server.listen(PORT, () => {
    console.log("BUILD_VERSION puntos-fix-2026-05-12");
    console.log(`API en http://localhost:${PORT}`);
    (0, expirations_1.startReservationExpirationWorker)();
    void (0, startupBackfills_1.runOneTimeWebCheckoutPointsBackfill)().catch((error) => {
        console.error("[startup-backfill] Error ejecutando backfill unico de puntos web:", error instanceof Error ? error.message : error);
    });
    // Migracion unica de imagenes viejas a WebP. Si falla, solo quedan las
    // imagenes como estaban: el servidor arranca igual.
    void (0, startupBackfills_1.runOneTimeUploadsWebpMigration)().catch((error) => {
        console.error("[uploads-webp] Error ejecutando la migracion unica a WebP:", error instanceof Error ? error.message : error);
    });
});
