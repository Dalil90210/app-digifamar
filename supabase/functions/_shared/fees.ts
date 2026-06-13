// Server-side payout math for escrow release. Mirrors src/lib/cart/fees.ts.
//
// RATE NOTE: the unified order/escrow flow uses a 10% platform fee. This rate is
// kept in sync across three layers: src/lib/cart/fees.ts (checkout display), the
// validate_order_insert() DB trigger (authoritative server recompute), and here
// (payout fallback). computePayout prefers the platform_fee_cents captured on
// the order, so this constant is only the fallback for legacy rows.
//
// Release deducts the platform fee and the payment-gateway fee from the item
// subtotal; the farmer nets the remainder. (The Escrow.com fee is their cut,
// paid to them, and is not part of the farmer's net.)
export const PLATFORM_FEE_RATE = 0.1;

export type Payout = {
  grossCents: number;        // item subtotal the farmer sold
  platformFeeCents: number;  // DiGiFaMaR's platform cut
  gatewayFeeCents: number;   // payment-processor fee passed through
  netCents: number;          // what actually lands in the farmer's account
};

/**
 * Compute a farmer payout from an order. Prefers the fee figures captured on the
 * order at checkout (authoritative, drift-free); falls back to recomputing the
 * platform fee from the subtotal for older orders that predate the columns.
 */
export function computePayout(order: {
  subtotal_cents: number;
  platform_fee_cents?: number | null;
  gateway_fee_cents?: number | null;
}): Payout {
  const gross = Math.max(0, Math.round(order.subtotal_cents));
  const platformFee =
    order.platform_fee_cents ?? Math.round(gross * PLATFORM_FEE_RATE);
  const gatewayFee = Math.max(0, Math.round(order.gateway_fee_cents ?? 0));
  const net = Math.max(0, gross - platformFee - gatewayFee);
  return {
    grossCents: gross,
    platformFeeCents: platformFee,
    gatewayFeeCents: gatewayFee,
    netCents: net,
  };
}
