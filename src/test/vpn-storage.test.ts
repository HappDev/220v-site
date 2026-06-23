import { afterEach, describe, expect, it, vi } from "vitest";

import {
  consumePendingPromoCode,
  normalizePromoCode,
  peekPendingPromoCode,
  setPendingPromoCode,
} from "@/lib/vpnStorage";

describe("vpnStorage promo helpers", () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.useRealTimers();
  });

  it("normalizes supported promo codes", () => {
    expect(normalizePromoCode(" free7days ")).toBe("FREE7DAYS");
    expect(normalizePromoCode("SUMMER_2026")).toBe("SUMMER_2026");
    expect(normalizePromoCode("bad code")).toBe("");
  });

  it("stores, peeks, and consumes a pending promo code", () => {
    setPendingPromoCode(" free7days ");

    expect(peekPendingPromoCode()).toBe("FREE7DAYS");
    expect(consumePendingPromoCode()).toBe("FREE7DAYS");
    expect(peekPendingPromoCode()).toBe("");
  });

  it("expires a pending promo code after 24 hours", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-23T00:00:00Z"));
    setPendingPromoCode("FREE7DAYS");

    vi.setSystemTime(new Date("2026-06-24T00:00:01Z"));

    expect(peekPendingPromoCode()).toBe("");
  });
});
