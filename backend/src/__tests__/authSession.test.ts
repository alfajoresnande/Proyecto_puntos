/**
 * Emision y revocacion de sesiones (SEC-03 / SEC-04) con la base mockeada.
 */
import jwt from "jsonwebtoken";
import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const JWT_SECRET = "x".repeat(96);
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV = "test";
delete process.env.AUTH_COOKIE_NAME;
delete process.env.AUTH_COOKIE_SECURE;

type CuentaFalsa = { id: number; email: string; rol: string; activo: number; token_version: number };

const baseFalsa = {
  usuarios: new Map<number, CuentaFalsa>(),
  jtisRevocados: new Set<string>(),
};

vi.mock("../db", () => ({
  pool: {},
  qOne: vi.fn(async (_q: unknown, sql: string, params: unknown[]) => {
    if (sql.includes("FROM usuarios")) return baseFalsa.usuarios.get(Number(params[0]));
    if (sql.includes("FROM sesiones_revocadas")) {
      return baseFalsa.jtisRevocados.has(String(params[0])) ? { jti: params[0] } : undefined;
    }
    return undefined;
  }),
  qRun: vi.fn(async () => ({ insertId: 0, affectedRows: 1 })),
}));

const {
  JWT_AUDIENCE,
  JWT_ISSUER,
  authCookiePolicy,
  getAuthPayload,
  resolveVerifiedUser,
  setAuthCookie,
  signToken,
  verifyToken,
} = await import("../auth");

function requestConCookie(token: string | null): Request {
  return {
    headers: { cookie: token ? `${authCookiePolicy.name}=${token}` : "" },
  } as unknown as Request;
}

beforeEach(() => {
  baseFalsa.usuarios.clear();
  baseFalsa.jtisRevocados.clear();
  baseFalsa.usuarios.set(1, { id: 1, email: "cliente@example.invalid", rol: "cliente", activo: 1, token_version: 0 });
  baseFalsa.usuarios.set(2, { id: 2, email: "admin@example.invalid", rol: "admin", activo: 1, token_version: 0 });
});

describe("SEC-04 · claims del JWT", () => {
  it("fija algoritmo, issuer, audience y jti", () => {
    const token = signToken({ id: 1, rol: "cliente", email: "cliente@example.invalid", tv: 0 });
    const decoded = jwt.decode(token, { complete: true });
    expect(decoded?.header.alg).toBe("HS256");
    const payload = decoded?.payload as Record<string, unknown>;
    expect(payload.iss).toBe(JWT_ISSUER);
    expect(payload.aud).toBe(JWT_AUDIENCE);
    expect(typeof payload.jti).toBe("string");
    expect(payload.tv).toBe(0);
  });

  it("el TTL de staff es mas corto que el de cliente", () => {
    const staff = jwt.decode(signToken({ id: 2, rol: "admin", email: "a@b.c", tv: 0 })) as any;
    const cliente = jwt.decode(signToken({ id: 1, rol: "cliente", email: "c@b.c", tv: 0 })) as any;
    expect(staff.exp - staff.iat).toBe(8 * 60 * 60);
    expect(cliente.exp - cliente.iat).toBe(7 * 24 * 60 * 60);
  });

  it("rechaza alg:none", () => {
    const none = jwt.sign({ id: 1, rol: "superAdmin", email: "x@y.z" }, "", {
      algorithm: "none",
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    expect(verifyToken(none)).toBeNull();
  });

  it("rechaza un token con otro issuer o audience", () => {
    const otro = jwt.sign({ id: 1, rol: "superAdmin", email: "x@y.z", tv: 0 }, JWT_SECRET, {
      algorithm: "HS256",
      issuer: "otra-api",
      audience: JWT_AUDIENCE,
      expiresIn: "1h",
    });
    expect(verifyToken(otro)).toBeNull();
  });

  it("rechaza un token firmado con otro secret", () => {
    const otro = jwt.sign({ id: 1, rol: "superAdmin", email: "x@y.z", tv: 0 }, "y".repeat(96), {
      algorithm: "HS256",
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      expiresIn: "1h",
    });
    expect(verifyToken(otro)).toBeNull();
  });
});

describe("SEC-03 · el token solo se lee de la cookie", () => {
  it("no acepta el token por header Authorization", async () => {
    const token = signToken({ id: 1, rol: "cliente", email: "cliente@example.invalid", tv: 0 });
    const req = { headers: { authorization: `Bearer ${token}`, cookie: "" } } as unknown as Request;
    expect(getAuthPayload(req)).toBeNull();
    expect((await resolveVerifiedUser(req)).ok).toBe(false);
  });

  it("acepta el token por cookie", async () => {
    const token = signToken({ id: 1, rol: "cliente", email: "cliente@example.invalid", tv: 0 });
    expect((await resolveVerifiedUser(requestConCookie(token))).ok).toBe(true);
  });
});

describe("SEC-04 · revocacion de sesiones", () => {
  it("una sesion valida pasa", async () => {
    const token = signToken({ id: 1, rol: "cliente", email: "cliente@example.invalid", tv: 0 });
    const r = await resolveVerifiedUser(requestConCookie(token));
    expect(r.ok).toBe(true);
    expect(r.ok && r.user.id).toBe(1);
  });

  it("cambiar la contrasena (token_version + 1) invalida el token viejo", async () => {
    const token = signToken({ id: 1, rol: "cliente", email: "cliente@example.invalid", tv: 0 });
    baseFalsa.usuarios.get(1)!.token_version = 1;
    const r = await resolveVerifiedUser(requestConCookie(token));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.status).toBe(401);
  });

  it("desactivar la cuenta invalida el token en el acto", async () => {
    const token = signToken({ id: 2, rol: "admin", email: "admin@example.invalid", tv: 0 });
    baseFalsa.usuarios.get(2)!.activo = 0;
    const r = await resolveVerifiedUser(requestConCookie(token));
    expect(r.ok === false && r.status).toBe(403);
  });

  it("borrar el usuario invalida el token", async () => {
    const token = signToken({ id: 1, rol: "cliente", email: "cliente@example.invalid", tv: 0 });
    baseFalsa.usuarios.delete(1);
    expect((await resolveVerifiedUser(requestConCookie(token))).ok).toBe(false);
  });

  it("el logout revoca el jti de ese dispositivo", async () => {
    const token = signToken({ id: 1, rol: "cliente", email: "cliente@example.invalid", tv: 0 });
    const jti = (jwt.decode(token) as any).jti as string;
    expect((await resolveVerifiedUser(requestConCookie(token))).ok).toBe(true);

    baseFalsa.jtisRevocados.add(jti);
    expect((await resolveVerifiedUser(requestConCookie(token))).ok).toBe(false);
  });

  it("revocar un jti NO cierra las otras sesiones del mismo usuario", async () => {
    const tokenA = signToken({ id: 1, rol: "cliente", email: "cliente@example.invalid", tv: 0 });
    const tokenB = signToken({ id: 1, rol: "cliente", email: "cliente@example.invalid", tv: 0 });
    baseFalsa.jtisRevocados.add((jwt.decode(tokenA) as any).jti);

    expect((await resolveVerifiedUser(requestConCookie(tokenA))).ok).toBe(false);
    expect((await resolveVerifiedUser(requestConCookie(tokenB))).ok).toBe(true);
  });
});

describe("SEC-04 · el rol sale de la base, no del JWT", () => {
  it("un JWT que dice superAdmin no otorga superAdmin si la base dice cliente", async () => {
    // Token bien firmado por nosotros pero con un rol que ya no corresponde
    // (por ejemplo emitido antes de degradar la cuenta).
    const token = jwt.sign({ id: 1, rol: "superAdmin", email: "cliente@example.invalid", tv: 0 }, JWT_SECRET, {
      algorithm: "HS256",
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      expiresIn: "1h",
      jwtid: "jti-forjado",
    });
    const r = await resolveVerifiedUser(requestConCookie(token));
    expect(r.ok).toBe(true);
    expect(r.ok && r.user.rol).toBe("cliente");
  });

  it("una promocion en base se refleja sin reloguear", async () => {
    const token = signToken({ id: 1, rol: "cliente", email: "cliente@example.invalid", tv: 0 });
    baseFalsa.usuarios.get(1)!.rol = "vendedor";
    const r = await resolveVerifiedUser(requestConCookie(token));
    expect(r.ok && r.user.rol).toBe("vendedor");
  });
});

describe("SEC-03 · la cookie que se emite", () => {
  it("es HttpOnly, con Path=/ y sin Domain", () => {
    const capturada: Record<string, unknown> = {};
    const res = {
      cookie: (name: string, _value: string, options: Record<string, unknown>) => {
        capturada.name = name;
        capturada.options = options;
      },
    } as unknown as Response;

    setAuthCookie(res, signToken({ id: 1, rol: "cliente", email: "c@d.e", tv: 0 }));

    const options = capturada.options as Record<string, unknown>;
    expect(options.httpOnly).toBe(true);
    expect(options.path).toBe("/");
    expect(options.domain).toBeUndefined();
    expect(["lax", "strict", "none"]).toContain(options.sameSite);
  });
});
