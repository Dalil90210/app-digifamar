// send-otp
// -----------------------------------------------------------------------------
// Generates a 6-digit delivery-confirmation OTP for an order and texts it to the
// buyer. The plaintext code is never stored or returned (except in dev mode);
// only its SHA-256 hash is persisted with a 10-minute expiry.
//
// Request  (POST, requires buyer JWT): { phone_number, order_id }
// Response: { success, data: { message, expires_at, dev_code? } }
import { preflight, ok, fail } from "../_shared/http.ts";
import { serviceClient, getAuthedUser } from "../_shared/auth.ts";
import { logAction } from "../_shared/log.ts";
import { sha256Hex } from "../_shared/escrow.ts";
import { sendSms } from "../_shared/sms.ts";

const OTP_TTL_MINUTES = 10;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const origin = req.headers.get("origin");
  if (req.method !== "POST") return fail("Method not allowed", 405, origin);

  // --- Auth: only an authenticated user may request an OTP ------------------
  const user = await getAuthedUser(req);
  if (!user) return fail("Unauthorized", 401, origin);

  let body: { phone_number?: string; order_id?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body", 400, origin);
  }
  const phone = body.phone_number?.trim();
  const orderId = body.order_id?.trim();
  if (!phone || !orderId) {
    return fail("phone_number and order_id are required", 400, origin);
  }

  const svc = serviceClient();

  // --- Ownership check: the caller must be the order's buyer ----------------
  const { data: order, error: orderErr } = await svc
    .from("orders").select("id, buyer_id, status").eq("id", orderId).maybeSingle();
  if (orderErr) return fail(orderErr.message, 500, origin);
  if (!order) return fail("Order not found", 404, origin);
  if (order.buyer_id !== user.id) return fail("Forbidden", 403, origin);

  // --- Generate + persist a hashed 6-digit code -----------------------------
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = await sha256Hex(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000).toISOString();

  // Invalidate any earlier unconsumed codes for this order so only one is live.
  await svc.from("order_otps")
    .update({ consumed_at: new Date().toISOString() })
    .eq("order_id", orderId).is("consumed_at", null);

  const { error: insErr } = await svc.from("order_otps").insert({
    order_id: orderId,
    phone,
    code_hash: codeHash,
    expires_at: expiresAt,
  });
  if (insErr) return fail(insErr.message, 500, origin);

  // --- Deliver via SMS ------------------------------------------------------
  let sms;
  try {
    sms = await sendSms(
      phone,
      `Your DiGiFaMaR delivery code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes.`,
    );
  } catch (e) {
    return fail(`Could not send OTP: ${(e as Error).message}`, 502, origin);
  }

  await logAction(svc, {
    actorId: user.id,
    action: "otp.sent",
    entityType: "order",
    entityId: orderId,
    metadata: {
      phone_last4: phone.slice(-4),
      provider: sms.provider,
      simulated: !!sms.simulated,
    },
  });

  // Only echo the code when no real SMS gateway is configured (dev/staging), so
  // the flow stays testable. In production `dev_code` is undefined.
  const devCode = sms.simulated ? code : undefined;
  return ok({ message: "OTP sent", expires_at: expiresAt, dev_code: devCode }, origin);
});
