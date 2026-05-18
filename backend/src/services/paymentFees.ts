import { qAll, type Queryable } from "../db";

export type PaymentFeeRule = {
  id: number;
  proveedor: string;
  metodo: string;
  descripcion: string;
  porcentaje: number;
  activo: boolean;
};

export type PaymentFeeSnapshot = {
  porcentaje: number;
  montoComision: number;
  montoNeto: number;
  descripcion: string | null;
};

function toMoney(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function normalizeKeyPart(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function ruleKey(proveedor: string | null | undefined, metodo: string | null | undefined): string {
  return `${normalizeKeyPart(proveedor)}:${normalizeKeyPart(metodo)}`;
}

export async function getPaymentFeeRules(conn: Queryable): Promise<PaymentFeeRule[]> {
  const rows = await qAll<PaymentFeeRule>(
    conn,
    `SELECT id, proveedor, metodo, descripcion, porcentaje, activo
     FROM costos_cobro
     ORDER BY proveedor ASC, metodo ASC, id ASC`,
  ).catch(() => []);
  return rows.map((row) => ({
    id: Number(row.id),
    proveedor: normalizeKeyPart(row.proveedor),
    metodo: normalizeKeyPart(row.metodo),
    descripcion: row.descripcion,
    porcentaje: Number(row.porcentaje ?? 0),
    activo: Boolean(row.activo),
  }));
}

export function buildPaymentFeeRuleMap(rules: PaymentFeeRule[]): Map<string, PaymentFeeRule> {
  return new Map(rules.map((rule) => [ruleKey(rule.proveedor, rule.metodo), rule]));
}

export function resolvePaymentFeeFromRuleMap(
  ruleMap: Map<string, PaymentFeeRule>,
  input: {
    proveedor?: string | null;
    metodo?: string | null;
    monto: number;
  },
): PaymentFeeSnapshot {
  const gross = toMoney(Number(input.monto ?? 0));
  if (!Number.isFinite(gross) || gross <= 0) {
    return {
      porcentaje: 0,
      montoComision: 0,
      montoNeto: 0,
      descripcion: null,
    };
  }

  const rule = ruleMap.get(ruleKey(input.proveedor, input.metodo));
  const porcentaje = rule?.activo ? Math.max(0, Math.min(100, Number(rule.porcentaje ?? 0))) : 0;
  const montoComision = toMoney((gross * porcentaje) / 100);
  return {
    porcentaje,
    montoComision,
    montoNeto: toMoney(gross - montoComision),
    descripcion: rule?.descripcion ?? null,
  };
}

export async function resolvePaymentFee(
  conn: Queryable,
  input: {
    proveedor?: string | null;
    metodo?: string | null;
    monto: number;
  },
): Promise<PaymentFeeSnapshot> {
  const rules = await getPaymentFeeRules(conn);
  return resolvePaymentFeeFromRuleMap(buildPaymentFeeRuleMap(rules), input);
}
