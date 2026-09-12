import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useTrafficPurchaseRestriction } from "@/hooks/useTrafficPurchaseRestriction";

afterEach(() => { vi.useRealTimers(); });

it("blocks an open payment page as soon as fewer than six hours remain", () => {
  vi.useFakeTimers();
  const now = new Date("2026-09-13T00:00:00Z");
  vi.setSystemTime(now);
  const user = { tariff: "1month", expireAt: new Date(now.getTime() + 6 * 3600_000 + 1000).toISOString() };
  const { result } = renderHook(() => useTrafficPurchaseRestriction(user));
  expect(result.current).toBeNull();
  act(() => { vi.advanceTimersByTime(1000); });
  expect(result.current).toBeNull();
  act(() => { vi.advanceTimersByTime(1); });
  expect(result.current).toContain("меньше 6 часов");
});

it("unblocks after the subscription is extended", () => {
  const { result, rerender } = renderHook(({ user }) => useTrafficPurchaseRestriction(user), {
    initialProps: { user: { tariff: "trial", expireAt: new Date().toISOString() } },
  });
  expect(result.current).toContain("тестовом");
  rerender({ user: { tariff: "1month", expireAt: new Date(Date.now() + 7 * 3600_000).toISOString() } });
  expect(result.current).toBeNull();
});
