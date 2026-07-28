// send-otp
// -----------------------------------------------------------------------------
// Generates a 6-digit delivery-confirmation OTP for an order and texts it to the
// buyer. The plaintext code is never stored or returned (except in dev mode);
// only its SHA-256 hash is persisted with a 10-minute expiry.
//
// Request  (POST, requires buyer JWT): { order_id }
// Response: { success, data: { message, expires_at, dev_code? } }
import { preflight, ok, fail } from "../_shared/http.ts";
import { serviceClient, getAuthedUser } from "../_shared/auth.ts";
import { logAction } from "../_shared/log.ts";
import { sha256Hex } from "../_shared/escrow.ts";
import { sendSms } from "../_shared/sms.ts";

const OTP_TTL_MINUTES = 10;
const MAX_OTP_SENDS_PER_HOUR = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;

function generateOtpCode(): string {
  // Rejection sampling avoids modulo bias for 6-digit code generation.
  const max = 0x1_0000_0000; // 2^32
  const limit = max - (max % 1_000_000);
  const buf = new Uint32Array(1);
  let n = 0;
  do {
    crypto.getRandomValues(buf);
    n = buf[0] ?? 0;
  } while (n >= limit);
  return String(n % 1_000_000).padStart(6, "0");
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const origin = req.headers.get("origin");
  if (req.method !== "POST") return fail("Method not allowed", 405, origin);

  // --- Auth: only an authenticated user may request an OTP ------------------
  const user = await getAuthedUser(req);
  if (!user) return fail("Unauthorized", 401, origin);

  let body: { order_id?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body", 400, origin);
  }
  const orderId = body.order_id?.trim();
  if (!orderId) {
    return fail("order_id is required", 400, origin);
  }

  const svc = serviceClient();

  // --- Account phone check: use only the caller's own verified phone --------
  const { data: authData, error: authErr } = await svc.auth.admin.getUserById(
    user.id,
  );
  if (authErr) return fail(authErr.message, 500, origin);

  const authPhone = authData.user?.phone?.trim() ?? null;
  const normalizedAuthPhone = normalizePhone(authPhone);
  const phoneConfirmed = !!(
    authData.user as { phone_confirmed_at?: string | null } | undefined
  )?.phone_confirmed_at;
  if (!authPhone || !normalizedAuthPhone) {
    return fail("No phone number on account", 400, origin);
  }
  if (!phoneConfirmed) {
    return fail("Phone number is not verified", 403, origin);
  }

  const { data: profile, error: profileErr } = await svc
    .from("profiles")
    .select("phone")
    .eq("id", user.id)
    .maybeSingle();
  if (profileErr) return fail(profileErr.message, 500, origin);
  const profilePhone = profile?.phone?.trim() ?? null;
  const normalizedProfilePhone = normalizePhone(profilePhone);
  if (!profilePhone || !normalizedProfilePhone) {
    return fail("No profile phone configured", 400, origin);
  }
  if (normalizedProfilePhone !== normalizedAuthPhone) {
    return fail("Profile phone mismatch; update your profile phone", 409, origin);
  }

  // --- Ownership check: the caller must be the order's buyer ----------------
  const { data: order, error: orderErr } = await svc
    .from("orders").select("id, buyer_id, status").eq("id", orderId).maybeSingle();
  if (orderErr) return fail(orderErr.message, 500, origin);
  if (!order) return fail("Order not found", 404, origin);
  if (order.buyer_id !== user.id) return fail("Forbidden", 403, origin);

  // --- Rate limit: max N sends per order per hour ----------------------------
  const windowStart = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const { count: sendCount, error: countErr } = await svc
    .from("order_otps")
    .select("id", { count: "exact", head: true })
    .eq("order_id", orderId)
    .gte("created_at", windowStart);
  if (countErr) return fail(countErr.message, 500, origin);

  if ((sendCount ?? 0) >= MAX_OTP_SENDS_PER_HOUR) {
    const { data: oldestRecent } = await svc
      .from("order_otps")
      .select("created_at")
      .eq("order_id", orderId)
      .gte("created_at", windowStart)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const retryAfterSeconds = oldestRecent?.created_at
      ? Math.max(
        1,
        Math.ceil(
          (new Date(oldestRecent.created_at).getTime() + RATE_WINDOW_MS -
            Date.now()) / 1000,
        ),
      )
      : 3600;
    return fail(
      "Too many OTP requests for this order. Try again later.",
      429,
      origin,
      { retry_after_seconds: retryAfterSeconds },
    );
  }

  // --- Generate + persist a hashed 6-digit code -----------------------------
  const code = generateOtpCode();
  const codeHash = await sha256Hex(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000).toISOString();

  // Invalidate any earlier unconsumed codes for this order so only one is live.
  await svc.from("order_otps")
    .update({ consumed_at: new Date().toISOString() })
    .eq("order_id", orderId).is("consumed_at", null);

  const { error: insErr } = await svc.from("order_otps").insert({
    order_id: orderId,
    phone: authPhone,
    code_hash: codeHash,
    expires_at: expiresAt,
  });
  if (insErr) return fail(insErr.message, 500, origin);

  // --- Deliver via Vonage SMS (through shared sender) -----------------------
  let sms;
  try {
    sms = await sendSms(
      authPhone,
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
      phone_last4: authPhone.slice(-4),
      provider: sms.provider,
      simulated: !!sms.simulated,
      send_count_in_last_hour: (sendCount ?? 0) + 1,
    },
  });

  // Only echo the code when no real SMS gateway is configured (dev/staging), so
  // the flow stays testable. In production `dev_code` is undefined.
  const devCode = sms.simulated ? code : undefined;
  return ok({ message: "OTP sent", expires_at: expiresAt, dev_code: devCode }, origin);
});
