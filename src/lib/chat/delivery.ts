/**
 * Client-side delivery-fee math for the chat → escrow flow.
 *
 * These constants MUST stay in sync with the authoritative server copy in
 * supabase/functions/calculate-distance/index.ts. We recompute on the client so
 * the buyer sees the fee and grand total instantly when they accept a price; the
 * edge function remains the source of truth when an order is actually created.
 */

export const BASE_FEE_CENTS = 500; //  $5.00 flat dispatch
export const PER_MILE_CENTS = 75; //   $0.75 per mile beyond the free radius
export const FREE_RADIUS_MILES = 3; // first 3 miles covered by the base fee

/** Great-circle distance between two lat/lng points, in miles. */
export function haversineMiles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 3958.7613; // Earth radius in miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Delivery fee (integer cents) for a given distance in miles. */
export function deliveryFeeCents(distanceMiles: number | null): number {
  if (distanceMiles == null || !Number.isFinite(distanceMiles)) {
    return BASE_FEE_CENTS;
  }
  const billable = Math.max(0, distanceMiles - FREE_RADIUS_MILES);
  return BASE_FEE_CENTS + Math.round(billable * PER_MILE_CENTS);
}
