// verify-otp
// -----------------------------------------------------------------------------
// Verifies a buyer's delivery OTP and, on success, releases the order's escrow
// to the farmer (deducting platform + gateway fees). The code is checked against
// its stored hash; expired, consumed, or over-attempted codes are rejected.
//
// Request  (POST, requires buyer JWT): { order_id, otp, user_id? }
// Response: { success, data: { message, payout } }
import { preflight, ok, fail } from "../_shared/http.ts";
import { serviceClient, getAuthedUser } from "../_shared/auth.ts";
import { logAction } from "../_shared/log.ts";
import { sha256Hex, releaseEscrow } from "../_shared/escrow.ts";

const MAX_ATTEMPTS = 5;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const origin = req.headers.get("origin");
  if (req.method !== "POST") return fail("Method not allowed", 405, origin);

  const user = await getAuthedUser(req);
  if (!user) return fail("Unauthorized", 401, origin);

  let body: { order_id?: string; otp?: string; user_id?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body", 400, origin);
  }
  const orderId = body.order_id?.trim();
  const otp = body.otp?.trim();
  if (!orderId || !otp) return fail("order_id and otp are required", 400, origin);
  // Defence in depth: a supplied user_id must match the token's owner.
  if (body.user_id && body.user_id !== user.id) {
    return fail("Forbidden", 403, origin);
  }

  const svc = serviceClient();

  // --- Ownership check ------------------------------------------------------
  const { data: order } = await svc
    .from("orders").select("id, buyer_id").eq("id", orderId).maybeSingle();
  if (!order) return fail("Order not found", 404, origin);
  if (order.buyer_id !== user.id) return fail("Forbidden", 403, origin);

  // --- Load the latest unconsumed code --------------------------------------
  const { data: record } = await svc
    .from("order_otps").select("*")
    .eq("order_id", orderId).is("consumed_at", null)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  if (!record) return fail("No active code. Request a new one.", 404, origin);
  if (record.attempts >= MAX_ATTEMPTS) {
    return fail("Too many attempts. Request a new code.", 429, origin);
  }
  if (new Date(record.expires_at).getTime() < Date.now()) {
    return fail("Code expired. Request a new one.", 410, origin);
  }

  // --- Constant-shape hash comparison ---------------------------------------
  const matches = (await sha256Hex(otp)) === record.code_hash;
  if (!matches) {
    await svc.from("order_otps")
      .update({ attempts: record.attempts + 1 }).eq("id", record.id);
    await logAction(svc, {
      actorId: user.id, action: "otp.failed",
      entityType: "order", entityId: orderId,
      metadata: { attempts: record.attempts + 1 },
    });
    return fail("Incorrect code", 401, origin);
  }

  // Mark consumed BEFORE releasing so a valid code cannot be replayed.
  await svc.from("order_otps")
    .update({ consumed_at: new Date().toISOString() }).eq("id", record.id);
  await logAction(svc, {
    actorId: user.id, action: "otp.verified",
    entityType: "order", entityId: orderId,
  });

  // --- OTP good -> release escrow to the farmer -----------------------------
  const result = await releaseEscrow(svc, orderId, user.id);
  if (!result.ok) return fail(result.error, result.status, origin);

  return ok({
    message: result.alreadyReleased
      ? "Already released"
      : "Delivery confirmed; escrow released",
    payout: result.payout,
  }, origin);
});
