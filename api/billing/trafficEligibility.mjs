export const TRAFFIC_MIN_REMAINING_MS = 6 * 60 * 60 * 1000;

// Shared by checkout and the browser. Use the exact expiry, never rounded daysLeft.
export function trafficPurchaseRestriction(user, now = Date.now()) {
  if (!user || typeof user !== "object") {
    return "Не удалось проверить тариф. Обновите страницу и попробуйте снова.";
  }
  const tariff = typeof user.tariff === "string" ? user.tariff.trim().toLowerCase() : "";
  const plan = typeof user.plan === "string" ? user.plan.trim().toLowerCase() : "";
  if (tariff === "trial" || (!tariff && ["trial", "test", "тестовый"].includes(plan))) {
    return "На тестовом тарифе нельзя докупить трафик. Сначала купите платный тариф.";
  }
  const expiresAt = typeof user.expireAt === "string" ? Date.parse(user.expireAt) : NaN;
  if (!Number.isFinite(expiresAt)) {
    return "Не удалось проверить срок тарифа. Обновите страницу и попробуйте снова.";
  }
  if (expiresAt - now < TRAFFIC_MIN_REMAINING_MS) {
    return "Докупка трафика недоступна: до окончания тарифа осталось меньше 6 часов. Сначала продлите тариф.";
  }
  return null;
}
