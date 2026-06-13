import { describe, expect, it } from "vitest";
import {
  computeFees,
  dollarsToCents,
  ESCROW_FEE_RATE,
  formatCents,
  formatRate,
  PLATFORM_FEE_RATE,
} from "./fees";

describe("checkout fees", () => {
  it("uses a 10% platform fee and a 3.25% escrow fee", () => {
    expect(PLATFORM_FEE_RATE).toBe(0.1);
    expect(ESCROW_FEE_RATE).toBe(0.0325);
  });

  it("computes platform + escrow fees on the subtotal", () => {
    const f = computeFees(10_000); // $100.00
    expect(f.platformFeeCents).toBe(1_000); // 10%
    expect(f.escrowFeeCents).toBe(325); // 3.25%
    expect(f.totalCents).toBe(11_325);
  });

  it("rounds fees to the nearest cent", () => {
    const f = computeFees(550); // $5.50
    expect(f.platformFeeCents).toBe(55); // round(55.0)
    expect(f.escrowFeeCents).toBe(18); // round(17.875)
    expect(f.totalCents).toBe(550 + 55 + 18);
  });

  it("total always equals subtotal + both fees", () => {
    for (const subtotal of [0, 1, 999, 12_345, 9_999_999]) {
      const f = computeFees(subtotal);
      expect(f.totalCents).toBe(f.subtotalCents + f.platformFeeCents + f.escrowFeeCents);
    }
  });

  it("clamps negative subtotals to zero", () => {
    expect(computeFees(-500).totalCents).toBe(0);
  });

  it("converts dollars to integer cents without float drift", () => {
    expect(dollarsToCents(5.5)).toBe(550);
    expect(dollarsToCents(0.1 + 0.2)).toBe(30);
  });

  it("formats cents and rates for display", () => {
    expect(formatCents(11_325)).toBe("$113.25");
    expect(formatRate(PLATFORM_FEE_RATE)).toBe("10%");
    expect(formatRate(ESCROW_FEE_RATE)).toBe("3.25%");
  });
});
