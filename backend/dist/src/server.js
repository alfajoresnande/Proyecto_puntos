"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const path_1 = __importDefault(require("path"));
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
const securityMonitor_1 = require("./securityMonitor");
const app = (0, express_1.default)();
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
function parseOrigins(raw, fallback) {
    return (raw ?? fallback)
        .split(",")
        .map((origin) => {
        const trimmed = origin.trim();
        if (!trimmed)
            return "";
        return toOrigin(trimmed) ?? trimmed.replace(/\/+$/, "");
    })
        .filter(Boolean);
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
const allowedOrigins = addLoopbackAliases(parseOrigins(process.env.FRONTEND_URL, "http://localhost:5173"));
const trustedCsrfOrigins = new Set(addLoopbackAliases(parseOrigins(process.env.CSRF_TRUSTED_ORIGINS, allowedOrigins.join(","))));
function csrfProtection(req, res, next) {
    if (SAFE_METHODS.has(req.method.toUpperCase())) {
        next();
        return;
    }
    const csrfToken = req.get("x-csrf-token")?.trim() || "";
    if (csrfToken.length < 16) {
        (0, securityMonitor_1.recordSecurityEvent)("csrf_token_faltante_o_invalido", req);
        res.status(403).json({ error: "CSRF token faltante o invalido" });
        return;
    }
    // Browser hint: reject cross-site mutation requests early.
    const fetchSite = (req.get("sec-fetch-site") || "").toLowerCase();
    if (fetchSite === "cross-site") {
        (0, securityMonitor_1.recordSecurityEvent)("csrf_bloqueado_sitio_cruzado", req, { fetchSite });
        res.status(403).json({ error: "Solicitud bloqueada por politica CSRF" });
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
    next();
}
// Proxy: req.ip real cuando corremos detras de Nginx/Docker/CF
// Con un unico hop de proxy; aumentar si hay mas capas.
const TRUST_PROXY = process.env.TRUST_PROXY;
if (TRUST_PROXY) {
    app.set("trust proxy", Number.isNaN(Number(TRUST_PROXY)) ? TRUST_PROXY : Number(TRUST_PROXY));
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
    if (!origin || allowedOrigins.includes(origin)) {
        cb(null, { origin: origin || false, credentials: true });
        return;
    }
    (0, securityMonitor_1.recordSecurityEvent)("cors_bloqueado_origen", req, { origin });
    cb(new Error("CORS no permitido para este origen"));
}));
app.use(express_1.default.json({ limit: "1mb" }));
// Servir imagenes subidas estaticamente
const uploadsPath = path_1.default.join(__dirname, "../uploads");
const uploadsStatic = express_1.default.static(uploadsPath, {
    setHeaders: (res) => {
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Cache-Control", "public, max-age=3600");
    },
});
app.use("/uploads", uploadsStatic);
app.use("/api/uploads", uploadsStatic);
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
app.use("/api/cliente", cliente_1.default);
app.use("/api/vendedor", vendedor_1.default);
app.use("/api/admin", admin_1.default);
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
app.listen(PORT, () => console.log(`API en http://localhost:${PORT}`));
