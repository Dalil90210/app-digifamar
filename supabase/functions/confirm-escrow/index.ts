// confirm-escrow
// -----------------------------------------------------------------------------
// Confirms that a buyer has paid and moves their order's funds into escrow
// (status: pending -> in_escrow). This is the trusted, server-side counterpart
// to the client "Pay into Escrow" action: clients cannot flip this status
// themselves (the orders UPDATE guard forbids it), so the transition runs here
// with the service role.
//
// Payment authorisation is simulated for now — wire a real Card/PayPal/Bank or
// Escrow.com confirmation in front of the status flip when a gateway is added.
//
// Request  (POST, requires buyer JWT): { order_id }
// Response: { success, data: { status, already_held } }
import { preflight, ok, fail } from "../_shared/http.ts";
import { serviceClient, getAuthedUser } from "../_shared/auth.ts";
import { logAction } from "../_shared/log.ts";

// Statuses that already represent funds-in-escrow-or-beyond — treat as a no-op.
const ALREADY_HELD = ["in_escrow", "paid", "shipped", "delivered", "released"];

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const origin = req.headers.get("origin");
  if (req.method !== "POST") return fail("Method not allowed", 405, origin);

  const user = await getAuthedUser(req);
  if (!user) return fail("Unauthorized", 401, origin);

  let body: { order_id?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body", 400, origin);
  }
  const orderId = body.order_id?.trim();
  if (!orderId) return fail("order_id is required", 400, origin);

  const svc = serviceClient();

  // --- Ownership check: only the order's buyer may confirm payment ----------
  const { data: order, error: orderErr } = await svc
    .from("orders")
    .select("id, buyer_id, status, total_cents")
    .eq("id", orderId)
    .maybeSingle();
  if (orderErr) return fail(orderErr.message, 500, origin);
  if (!order) return fail("Order not found", 404, origin);
  if (order.buyer_id !== user.id) return fail("Forbidden", 403, origin);

  // Idempotent: a re-submitted payment leaves the order untouched.
  if (ALREADY_HELD.includes(order.status)) {
    return ok({ status: order.status, already_held: true }, origin);
  }
  if (order.status !== "pending") {
    return fail(`Order in status '${order.status}' cannot enter escrow`, 409, origin);
  }

  const { error: updErr } = await svc
    .from("orders")
    .update({ status: "in_escrow" })
    .eq("id", orderId);
  if (updErr) return fail(updErr.message, 500, origin);

  await logAction(svc, {
    actorId: user.id,
    action: "escrow.held",
    entityType: "order",
    entityId: orderId,
    metadata: { total_cents: order.total_cents, simulated_payment: true },
  });

  return ok({ status: "in_escrow", already_held: false }, origin);
});
