export const PAID_TARIFF_CODES = new Set(["1month", "6month", "12month"]);
export const PAID_PLAN_LABELS = new Set(["1 месяц", "6 месяцев", "12 месяцев"]);

export function resolveIsPremium(user: unknown): boolean {
  if (!user || typeof user !== "object") return false;
  const raw = user as Record<string, unknown>;
  const tariff = typeof raw.tariff === "string" ? raw.tariff.toLowerCase() : "";
  const plan = typeof raw.plan === "string" ? raw.plan.toLowerCase() : "";
  const expireAt = typeof raw.expireAt === "string" ? raw.expireAt : "";
  
  const hasPaidTariff =
    PAID_TARIFF_CODES.has(tariff) ||
    plan === "premium" ||
    PAID_PLAN_LABELS.has(plan);

  if (!hasPaidTariff) return false;

  if (expireAt) {
    const expDate = new Date(expireAt);
    if (!Number.isNaN(expDate.getTime())) {
      return expDate.getTime() > Date.now();
    }
  }

  return true;
}
