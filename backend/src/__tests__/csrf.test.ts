import { describe, expect, it } from "vitest";
import { csrfSessionBinding, emitCsrfToken, verifyCsrfToken } from "../csrf";

const SECRET = "secreto-csrf-de-prueba-suficientemente-largo-0123456789";
const deps = { secret: SECRET };

const bindingAnon = csrfSessionBinding(null, SECRET);
const bindingSesionA = csrfSessionBinding("jwt-de-la-sesion-a", SECRET);
const bindingSesionB = csrfSessionBinding("jwt-de-la-sesion-b", SECRET);

describe("SEC-07 · el token CSRF ya no es cosmetico", () => {
  it("acepta un token emitido por el servidor", () => {
    const token = emitCsrfToken(bindingSesionA, deps);
    expect(verifyCsrfToken(token, token, bindingSesionA, deps).ok).toBe(true);
  });

  it("RECHAZA el valor arbitrario de 16 caracteres que antes pasaba", () => {
    const falso = "0123456789abcdef";
    const r = verifyCsrfToken(falso, falso, bindingSesionA, deps);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("formato_invalido");
  });

  it("rechaza un token fabricado con el formato correcto pero sin nuestra firma", () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const falso = `nonce-inventado.${exp}.${"a".repeat(64)}`;
    const r = verifyCsrfToken(falso, falso, bindingSesionA, deps);
    expect(r.ok === false && r.reason).toBe("firma_invalida");
  });

  it("rechaza si falta el header", () => {
    const token = emitCsrfToken(bindingSesionA, deps);
    expect(verifyCsrfToken(null, token, bindingSesionA, deps)).toEqual({ ok: false, reason: "token_ausente" });
  });

  it("rechaza si falta la cookie del double-submit", () => {
    const token = emitCsrfToken(bindingSesionA, deps);
    expect(verifyCsrfToken(token, null, bindingSesionA, deps)).toEqual({ ok: false, reason: "cookie_ausente" });
  });

  it("rechaza si el header y la cookie no coinciden", () => {
    const a = emitCsrfToken(bindingSesionA, deps);
    const b = emitCsrfToken(bindingSesionA, deps);
    expect(verifyCsrfToken(a, b, bindingSesionA, deps)).toEqual({ ok: false, reason: "no_coinciden" });
  });

  it("un token valido de OTRA sesion no sirve", () => {
    const tokenDeB = emitCsrfToken(bindingSesionB, deps);
    const r = verifyCsrfToken(tokenDeB, tokenDeB, bindingSesionA, deps);
    expect(r.ok === false && r.reason).toBe("firma_invalida");
  });

  it("un token emitido antes de iniciar sesion no sirve despues de iniciarla", () => {
    const tokenAnonimo = emitCsrfToken(bindingAnon, deps);
    expect(verifyCsrfToken(tokenAnonimo, tokenAnonimo, bindingAnon, deps).ok).toBe(true);
    expect(verifyCsrfToken(tokenAnonimo, tokenAnonimo, bindingSesionA, deps).ok).toBe(false);
  });

  it("rechaza un token vencido", () => {
    const ahora = 1_760_000_000_000;
    const token = emitCsrfToken(bindingSesionA, { secret: SECRET, nowMs: ahora });
    const muchoDespues = ahora + 13 * 60 * 60 * 1000;
    expect(verifyCsrfToken(token, token, bindingSesionA, { secret: SECRET, nowMs: muchoDespues })).toEqual({
      ok: false,
      reason: "vencido",
    });
  });

  it("rechaza un token firmado con otro secret", () => {
    const token = emitCsrfToken(bindingSesionA, { secret: "otro-secreto-distinto-igual-de-largo-000000" });
    expect(verifyCsrfToken(token, token, bindingSesionA, deps).ok).toBe(false);
  });

  it("no revienta con basura", () => {
    for (const basura of ["", ".", "..", "a.b", "a.b.c.d", "a.NaN.c"]) {
      expect(verifyCsrfToken(basura, basura, bindingSesionA, deps).ok).toBe(false);
    }
  });

  it("cada emision devuelve un token distinto", () => {
    const a = emitCsrfToken(bindingSesionA, deps);
    const b = emitCsrfToken(bindingSesionA, deps);
    expect(a).not.toBe(b);
  });

  it("el binding no expone el JWT", () => {
    expect(bindingSesionA).not.toContain("jwt-de-la-sesion-a");
    expect(bindingSesionA).toHaveLength(32);
  });
});
