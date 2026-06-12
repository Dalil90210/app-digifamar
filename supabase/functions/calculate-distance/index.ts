// calculate-distance
// -----------------------------------------------------------------------------
// Computes the great-circle distance between a farmer and a buyer and the
// resulting delivery fee. Pure math — no DB access — but still requires a valid
// JWT so it isn't an open endpoint.
//
// Request  (POST, requires JWT): { farmer_lat, farmer_lng, buyer_lat, buyer_lng }
// Response: { success, data: { distance_miles, delivery_fee_cents, delivery_fee_usd } }
import { preflight, ok, fail } from "../_shared/http.ts";
import { getAuthedUser } from "../_shared/auth.ts";

// Delivery pricing, in cents: a flat dispatch fee plus a per-mile rate, with the
// first few miles included in the base.
const BASE_FEE_CENTS = 500;     // $5.00 dispatch
const PER_MILE_CENTS = 75;      // $0.75 / mile beyond the free radius
const FREE_RADIUS_MILES = 3;    // first 3 miles covered by the base fee

/** Great-circle distance between two lat/lng points, in miles. */
function haversineMiles(
  aLat: number, aLng: number, bLat: number, bLng: number,
): number {
  const R = 3958.7613; // Earth radius in miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const isLat = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= -90 && n <= 90;
const isLng = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= -180 && n <= 180;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const origin = req.headers.get("origin");
  if (req.method !== "POST") return fail("Method not allowed", 405, origin);

  if (!(await getAuthedUser(req))) return fail("Unauthorized", 401, origin);

  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return fail("Invalid JSON body", 400, origin);
  }

  const fLat = b.farmer_lat, fLng = b.farmer_lng;
  const uLat = b.buyer_lat, uLng = b.buyer_lng;
  if (!isLat(fLat) || !isLat(uLat) || !isLng(fLng) || !isLng(uLng)) {
    return fail(
      "farmer_lat/farmer_lng and buyer_lat/buyer_lng must be valid coordinates",
      400,
      origin,
    );
  }

  const miles = haversineMiles(fLat, fLng, uLat, uLng);
  const billableMiles = Math.max(0, miles - FREE_RADIUS_MILES);
  const deliveryFeeCents = BASE_FEE_CENTS + Math.round(billableMiles * PER_MILE_CENTS);

  return ok({
    distance_miles: Math.round(miles * 100) / 100,
    delivery_fee_cents: deliveryFeeCents,
    delivery_fee_usd: deliveryFeeCents / 100,
  }, origin);
});
