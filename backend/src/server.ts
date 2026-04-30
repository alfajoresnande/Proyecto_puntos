import "dotenv/config";
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
import { recordSecurityEvent } from "./securityMonitor";

const app = express();
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function parseOrigins(raw: string | undefined, fallback: string): string[] {
  return (raw ?? fallback)
    .split(",")
    .map((origin) => {
      const trimmed = origin.trim();
      if (!trimmed) return "";
      return toOrigin(trimmed) ?? trimmed.replace(/\/+$/, "");
    })
    .filter(Boolean);
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

const allowedOrigins = addLoopbackAliases(parseOrigins(process.env.FRONTEND_URL, "http://localhost:5173"));
const trustedCsrfOrigins = new Set(
  addLoopbackAliases(parseOrigins(process.env.CSRF_TRUSTED_ORIGINS, allowedOrigins.join(",")))
);

function csrfProtection(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    next();
    return;
  }

  const csrfToken = req.get("x-csrf-token")?.trim() || "";
  if (csrfToken.length < 16) {
    recordSecurityEvent("csrf_token_faltante_o_invalido", req);
    res.status(403).json({ error: "CSRF token faltante o invalido" });
    return;
  }

  // Browser hint: reject cross-site mutation requests early.
  const fetchSite = (req.get("sec-fetch-site") || "").toLowerCase();
  if (fetchSite === "cross-site") {
    recordSecurityEvent("csrf_bloqueado_sitio_cruzado", req, { fetchSite });
    res.status(403).json({ error: "Solicitud bloqueada por politica CSRF" });
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

  next();
}

// Proxy: req.ip real cuando corremos detras de Nginx/Docker/CF
// Con un unico hop de proxy; aumentar si hay mas capas.
const TRUST_PROXY = process.env.TRUST_PROXY;
if (TRUST_PROXY) {
  app.set("trust proxy", Number.isNaN(Number(TRUST_PROXY)) ? TRUST_PROXY : Number(TRUST_PROXY));
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
    if (!origin || allowedOrigins.includes(origin)) {
      cb(null, { origin: origin || false, credentials: true });
      return;
    }
    recordSecurityEvent("cors_bloqueado_origen", req, { origin });
    cb(new Error("CORS no permitido para este origen"));
  })
);

app.use(express.json({ limit: "1mb" }));

// Servir imagenes subidas estaticamente
const uploadsPath = path.join(__dirname, "../uploads");
const uploadsStatic = express.static(uploadsPath, {
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
app.use("/diagnostico", diagnosticoRoutes);
app.use("/api/diagnostico", diagnosticoRoutes);

app.use("/api/auth", authRoutes);
app.use("/api/productos", productosRoutes); // publico (catalogo)
app.use("/api/paginas", paginasRoutes); // publico (sobre nosotros, terminos)
app.use("/api/cliente", clienteRoutes);
app.use("/api/vendedor", vendedorRoutes);
app.use("/api/admin", adminRoutes);

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
app.listen(PORT, () => console.log(`API en http://localhost:${PORT}`));
