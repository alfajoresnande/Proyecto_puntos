const DEFAULT_POINTS_AMOUNT_BASE = 1000;
const DEFAULT_POINTS_AMOUNT_REWARD = 20;

export function calculatePointsByAmount(
  amount: number,
  amountBase: number | string | null | undefined,
  pointsPerAmount: number | string | null | undefined,
): number {
  const total = Number(amount);
  const base = Number(amountBase ?? DEFAULT_POINTS_AMOUNT_BASE);
  const reward = Math.trunc(Number(pointsPerAmount ?? DEFAULT_POINTS_AMOUNT_REWARD));

  if (!Number.isFinite(total) || total <= 0) return 0;
  if (!Number.isFinite(base) || base <= 0) return 0;
  if (!Number.isFinite(reward) || reward <= 0) return 0;

  return Math.floor(total / base) * reward;
}
