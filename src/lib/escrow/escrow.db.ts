/**
 * src/lib/escrow/escrow.db.ts
 *
 * Persistence layer for the escrow state machine.
 *
 * ⚠️  SERVER-ONLY. This module performs state transitions that move real money,
 * so it MUST be constructed with the Supabase *service-role* client and must
 * never run in the browser. RLS blocks every client-side write; only the service
 * role can create escrows or call escrow_transition(). Keep SUPABASE_SERVICE_ROLE_KEY
 * as a server-only secret — never VITE_-prefixed, never committed to the repo.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type EscrowState = "held" | "released" | "refunded" | "disputed";

/** Public DTO shape (matches ESCROW_SPECIFICATION.md). */
export interface EscrowDto {
  id: string;
  orderId: string;
  amountCents: number;
  state: EscrowState;
  heldAt: string; // ISO timestamp
  resolvedAt: string | null; // ISO timestamp, set on released/refunded
}

/** Full DB row — superset of the DTO (internal use only). */
interface EscrowRow {
  id: string;
  order_id: string;
  buyer_id: string;
  farmer_id: string;
  amount_cents: number;
  state: EscrowState;
  stripe_payment_intent_id: string | null;
  stripe_transfer_id: string | null;
  stripe_refund_id: string | null;
  held_at: string;
  resolved_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

function toDto(r: EscrowRow): EscrowDto {
  return {
    id: r.id,
    orderId: r.order_id,
    amountCents: r.amount_cents,
    state: r.state,
    heldAt: r.held_at,
    resolvedAt: r.resolved_at,
  };
}

export interface CreateEscrowInput {
  orderId: string;
  buyerId: string;
  farmerId: string;
  amountCents: number;
  stripePaymentIntentId?: string;
}

export class EscrowDb {
  constructor(private readonly db: SupabaseClient) {}

  /** Create a new escrow in the `held` state. */
  async create(input: CreateEscrowInput): Promise<EscrowDto> {
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new Error("amountCents must be a positive integer (cents)");
    }
    const { data, error } = await this.db
      .from("escrows")
      .insert({
        order_id: input.orderId,
        buyer_id: input.buyerId,
        farmer_id: input.farmerId,
        amount_cents: input.amountCents,
        stripe_payment_intent_id: input.stripePaymentIntentId ?? null,
        state: "held",
      })
      .select()
      .single();
    if (error) throw error;
    return toDto(data as EscrowRow);
  }

  async getById(id: string): Promise<EscrowDto | null> {
    const { data, error } = await this.db
      .from("escrows")
      .select()
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? toDto(data as EscrowRow) : null;
  }

  async findByOrderId(orderId: string): Promise<EscrowDto | null> {
    const { data, error } = await this.db
      .from("escrows")
      .select()
      .eq("order_id", orderId)
      .maybeSingle();
    if (error) throw error;
    return data ? toDto(data as EscrowRow) : null;
  }

  async listByState(state: EscrowState): Promise<EscrowDto[]> {
    const { data, error } = await this.db
      .from("escrows")
      .select()
      .eq("state", state)
      .order("held_at", { ascending: true });
    if (error) throw error;
    return (data as EscrowRow[]).map(toDto);
  }

  /**
   * Atomic, race-safe state change via the SECURITY DEFINER SQL function.
   * `expected` must be the escrow's current state — if it isn't (already
   * released, concurrent request, etc.) the call throws instead of double-moving
   * funds. This is the idempotency guard the payment layer relies on.
   */
  async transition(args: {
    id: string;
    expected: EscrowState;
    next: EscrowState;
    actor: string;
    reason?: string;
    metadata?: Record<string, unknown>;
  }): Promise<EscrowDto> {
    const { data, error } = await this.db.rpc("escrow_transition", {
      p_escrow_id: args.id,
      p_expected_state: args.expected,
      p_new_state: args.next,
      p_actor: args.actor,
      p_reason: args.reason ?? null,
      p_metadata: args.metadata ?? {},
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return toDto(row as EscrowRow);
  }

  // ── Semantic helpers: each encodes the expected from-state ────────────────
  /** Buyer entered a valid OTP on delivery → release to farmer. */
  release(id: string, actor: string, metadata?: Record<string, unknown>) {
    return this.transition({
      id,
      expected: "held",
      next: "released",
      actor,
      reason: "otp_release",
      metadata,
    });
  }
  /** Window elapsed with no OTP, or buyer cancelled → refund buyer. */
  refund(id: string, actor: string, metadata?: Record<string, unknown>) {
    return this.transition({
      id,
      expected: "held",
      next: "refunded",
      actor,
      reason: "refund",
      metadata,
    });
  }
  /** Buyer or farmer opened a dispute → freeze for admin review. */
  dispute(id: string, actor: string, metadata?: Record<string, unknown>) {
    return this.transition({
      id,
      expected: "held",
      next: "disputed",
      actor,
      reason: "dispute_opened",
      metadata,
    });
  }
  /** Admin resolves a frozen escrow to either party. */
  resolveDispute(
    id: string,
    to: "released" | "refunded",
    actor: string,
    metadata?: Record<string, unknown>
  ) {
    return this.transition({
      id,
      expected: "disputed",
      next: to,
      actor,
      reason: "dispute_resolved",
      metadata,
    });
  }
}

/**
 * Convenience factory. Reads the SERVER-ONLY service-role key — do not call this
 * anywhere that ships to the browser.
 */
export function createEscrowDb(): EscrowDb {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (server-only)."
    );
  }
  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return new EscrowDb(client);
}
