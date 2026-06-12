// release-escrow
// -----------------------------------------------------------------------------
// Back-office / admin manual release of an order's escrow. The normal buyer flow
// releases via verify-otp (OTP confirms delivery); this endpoint exists for
// dispute resolution and admin overrides, so it is gated behind the admin role.
// The actual release logic is shared with verify-otp (see _shared/escrow.ts) and
// is idempotent.
//
// Request  (POST, requires admin JWT): { order_id }
// Response: { success, data: { message, payout } }
import { preflight, ok, fail } from "../_shared/http.ts";
import { serviceClient, getAuthedUser, isAdmin } from "../_shared/auth.ts";
import { releaseEscrow } from "../_shared/escrow.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const origin = req.headers.get("origin");
  if (req.method !== "POST") return fail("Method not allowed", 405, origin);

  const user = await getAuthedUser(req);
  if (!user) return fail("Unauthorized", 401, origin);

  const svc = serviceClient();
  // Manual fund movement is admin-only; buyers use verify-otp.
  if (!(await isAdmin(svc, user.id))) {
    return fail("Admin role required", 403, origin);
  }

  let body: { order_id?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body", 400, origin);
  }
  const orderId = body.order_id?.trim();
  if (!orderId) return fail("order_id is required", 400, origin);

  const result = await releaseEscrow(svc, orderId, user.id);
  if (!result.ok) return fail(result.error, result.status, origin);

  return ok({
    message: result.alreadyReleased ? "Already released" : "Escrow released",
    payout: result.payout,
  }, origin);
});
