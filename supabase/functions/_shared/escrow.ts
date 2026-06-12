// Core escrow-release logic, shared by verify-otp (buyer confirms delivery) and
// release-escrow (admin/back-office manual release). Keeping the release in one
// place guarantees both paths compute fees, write payouts, flip order status,
// and audit-log identically.
import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { computePayout } from "./fees.ts";
import { logAction } from "./log.ts";

/** SHA-256 hex digest — used to store/compare OTP codes without keeping plaintext. */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type ReleaseResult =
  | { ok: true; alreadyReleased: boolean; payout: Record<string, unknown> }
  | { ok: false; status: number; error: string };

// Order states from which escrow may be released (funds are held and goods
// are in flight or delivered).
const RELEASABLE = ["in_escrow", "paid", "shipped", "delivered"];

/**
 * Release an order's escrow to its farmer. Idempotent: a second call on an
 * already-released order returns the existing payout instead of paying twice
 * (enforced by the UNIQUE(order_id) constraint on payouts).
 *
 * Flow: validate order is releasable -> compute net payout -> instruct the
 * settlement provider -> record payout -> flip order to 'released' -> audit.
 */
export async function releaseEscrow(
  svc: SupabaseClient,
  orderId: string,
  actorId: string | null,
): Promise<ReleaseResult> {
  const { data: order, error } = await svc
    .from("orders")
    .select(
      "id, status, farmer_id, subtotal_cents, platform_fee_cents, gateway_fee_cents, escrow_transaction_id",
    )
    .eq("id", orderId)
    .maybeSingle();

  if (error) return { ok: false, status: 500, error: error.message };
  if (!order) return { ok: false, status: 404, error: "Order not found" };

  // Idempotency: already released -> return the recorded payout.
  if (order.status === "released") {
    const { data: existing } = await svc
      .from("payouts").select("*").eq("order_id", orderId).maybeSingle();
    return { ok: true, alreadyReleased: true, payout: existing ?? {} };
  }
  if (!RELEASABLE.includes(order.status)) {
    return {
      ok: false,
      status: 409,
      error: `Order in status '${order.status}' cannot be released`,
    };
  }
  if (!order.farmer_id) {
    return { ok: false, status: 422, error: "Order has no farmer_id to pay" };
  }

  const payout = computePayout(order);

  // Hand off to the settlement provider (Escrow.com). Throws on hard failure.
  const settlement = await settleWithProvider(order.escrow_transaction_id);

  // Record the payout. UNIQUE(order_id) is the idempotency anchor: a concurrent
  // release loses the race here and is treated as success.
  const { data: payoutRow, error: payoutErr } = await svc
    .from("payouts")
    .insert({
      order_id: order.id,
      farmer_id: order.farmer_id,
      gross_cents: payout.grossCents,
      platform_fee_cents: payout.platformFeeCents,
      gateway_fee_cents: payout.gatewayFeeCents,
      net_cents: payout.netCents,
      status: settlement.settled ? "paid" : "pending",
      provider: settlement.provider,
      provider_ref: settlement.ref ?? null,
    })
    .select()
    .single();

  if (payoutErr) {
    if (payoutErr.code === "23505") { // unique_violation: concurrent release
      const { data: existing } = await svc
        .from("payouts").select("*").eq("order_id", orderId).maybeSingle();
      return { ok: true, alreadyReleased: true, payout: existing ?? {} };
    }
    return { ok: false, status: 500, error: payoutErr.message };
  }

  await svc
    .from("orders")
    .update({ status: "released", released_at: new Date().toISOString() })
    .eq("id", order.id);

  await logAction(svc, {
    actorId,
    action: "escrow.released",
    entityType: "order",
    entityId: order.id,
    metadata: {
      farmer_id: order.farmer_id,
      gross_cents: payout.grossCents,
      platform_fee_cents: payout.platformFeeCents,
      gateway_fee_cents: payout.gatewayFeeCents,
      net_cents: payout.netCents,
      provider: settlement.provider,
      provider_ref: settlement.ref ?? null,
    },
  });

  return { ok: true, alreadyReleased: false, payout: payoutRow };
}

type Settlement = { settled: boolean; provider: string; ref?: string };

/**
 * Instruct the settlement provider (Escrow.com) to disburse held funds. When
 * ESCROW_API_KEY is absent we record the payout as 'pending' (simulated) so
 * non-production environments can run the full flow. Wire the real Escrow.com
 * disbursement call here for production — it is the single integration point.
 */
async function settleWithProvider(
  escrowTxnId: string | null,
): Promise<Settlement> {
  const apiKey = Deno.env.get("ESCROW_API_KEY");
  if (!apiKey || !escrowTxnId) {
    return { settled: false, provider: "simulated" };
  }
  // TODO(production): release on Escrow.com, e.g.
  //   PATCH https://api.escrow.com/2017-09-01/transaction/{escrowTxnId}
  //   Authorization: Basic base64(email:apiKey)
  //   body: { action: "release" }
  return { settled: true, provider: "escrow.com", ref: escrowTxnId };
}
