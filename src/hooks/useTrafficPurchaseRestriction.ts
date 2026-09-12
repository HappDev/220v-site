import { useEffect, useState } from "react";
import { TRAFFIC_MIN_REMAINING_MS, trafficPurchaseRestriction } from "../../api/billing/trafficEligibility.mjs";

export { trafficPurchaseRestriction };

export function useTrafficPurchaseRestriction(user: unknown): string | null {
  const [now, setNow] = useState(Date.now);
  const expiry = user && typeof user === "object" && "expireAt" in user
    ? Date.parse(String(user.expireAt))
    : NaN;

  useEffect(() => {
    const refresh = () => setNow(Date.now());
    // Recheck at the boundary even if the payment page remains open.
    const delay = expiry - TRAFFIC_MIN_REMAINING_MS - Date.now() + 1;
    const timer = Number.isFinite(delay) && delay > 0
      ? window.setTimeout(refresh, Math.min(delay, 2_147_483_647))
      : undefined;
    window.addEventListener("focus", refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [expiry, now]);

  return trafficPurchaseRestriction(user, Math.max(now, Date.now()));
}
