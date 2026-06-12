// Server-side payout math for escrow release. Mirrors src/lib/cart/fees.ts.
//
// RATE NOTE: DiGiFaMaR checkout (src/lib/cart/fees.ts) charges the BUYER an 8%
// platform fee and a 3.25% Escrow.com fee on top of the item subtotal. The
// product spec asked for a 10% platform fee. To switch to 10%, change
// PLATFORM_FEE_RATE below AND in src/lib/cart/fees.ts so checkout and payout
// stay consistent. We default to the 8% already shown to buyers.
//
// Release deducts the platform fee and the payment-gateway fee from the item
// subtotal; the farmer nets the remainder. (The Escrow.com fee is their cut,
// paid to them, and is not part of the farmer's net.)
export const PLATFORM_FEE_RATE = 0.08;

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
