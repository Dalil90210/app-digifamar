/**
 * DiGiFaMaR checkout pricing.
 *
 * Every order carries two fees on top of the item subtotal, both shown to the
 * buyer at checkout and both computed on the item subtotal:
 *   - Platform fee: 10%  (DiGiFaMaR marketplace fee — the farmer nets the rest)
 *   - Escrow fee:   3.25% (Escrow.com-protected settlement)
 *
 * This 10% platform rate is the single source of truth for the unified
 * order/escrow flow and is mirrored by:
 *   - supabase/functions/_shared/fees.ts (payout math), and
 *   - the validate_order_insert() DB trigger (authoritative server recompute).
 * Keep all three in sync.
 *
 * All math is done in integer cents to avoid floating-point drift, then
 * formatted for display at the edges.
 */

export const PLATFORM_FEE_RATE = 0.1;
export const ESCROW_FEE_RATE = 0.0325;

export type FeeBreakdown = {
  subtotalCents: number;
  platformFeeCents: number;
  escrowFeeCents: number;
  totalCents: number;
};

/** Compute the platform + escrow fees and grand total from an item subtotal. */
export function computeFees(subtotalCents: number): FeeBreakdown {
  const subtotal = Math.max(0, Math.round(subtotalCents));
  const platformFeeCents = Math.round(subtotal * PLATFORM_FEE_RATE);
  const escrowFeeCents = Math.round(subtotal * ESCROW_FEE_RATE);
  return {
    subtotalCents: subtotal,
    platformFeeCents,
    escrowFeeCents,
    totalCents: subtotal + platformFeeCents + escrowFeeCents,
  };
}

/** Dollars (e.g. 5.5) → integer cents (550), rounding half-up. */
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/** Integer cents → "$1,234.56" for display. */
export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

/** Human-readable fee rate, e.g. 0.08 → "8%". */
export function formatRate(rate: number): string {
  return `${(rate * 100)
    .toFixed(2)
    .replace(/\.?0+$/, "")}%`;
}
