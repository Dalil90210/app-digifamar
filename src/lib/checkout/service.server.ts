/**
 * Checkout module — server-side service.
 * NestJS equivalent: checkout.service.ts
 *
 * Orchestrates a checkout: recompute fees from the line items (never trust the
 * client total), open an Escrow.com transaction, then persist the order to the
 * Supabase `orders` table under the buyer's RLS context.
 */
import { computeFees } from "@/lib/cart/fees";
import { createEscrowTransaction } from "./escrowcom.server";
import type { CheckoutResultDto, CreateCheckoutDto } from "./dto";

// The `orders` table post-dates the generated Supabase types, so we narrow the
// client to just the insert shape we use (same pattern as the lender portal).
type OrdersInsertClient = {
  from: (table: "orders") => {
    insert: (values: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
  };
};

export type CheckoutContext = {
  supabase: unknown; // SupabaseClient scoped to the authenticated buyer (RLS)
  userId: string;
  buyerEmail: string | null;
};

export class CheckoutService {
  static async create(
    ctx: CheckoutContext,
    input: CreateCheckoutDto,
  ): Promise<CheckoutResultDto> {
    // 1. Recompute money server-side from the submitted line items.
    const subtotalCents = input.items.reduce(
      (sum, i) => sum + i.unitPriceCents * i.quantity,
      0,
    );
    const breakdown = computeFees(subtotalCents);

    // Resolve the farmer to pay on release. Only set when every line item names
    // the same seller (a single-farmer order); mixed or unknown sellers leave it
    // null, and the escrow-release flow flags such an order rather than mispay.
    // With the current mock catalog (slug farm ids, no farmerId) this is null.
    const farmerIds = new Set(
      input.items.map((i) => i.farmerId).filter((v): v is string => !!v),
    );
    const farmerId = farmerIds.size === 1 ? [...farmerIds][0] : null;

    const orderId = crypto.randomUUID();
    const itemCount = input.items.reduce((n, i) => n + i.quantity, 0);
    const description =
      input.items.length === 1
        ? `${input.items[0].name} (×${input.items[0].quantity})`
        : `DiGiFaMaR order — ${itemCount} item${itemCount === 1 ? "" : "s"}`;

    // 2. Open the Escrow.com transaction that will hold the buyer's funds.
    const escrow = await createEscrowTransaction({
      orderId,
      buyerEmail: ctx.buyerEmail,
      description,
      breakdown,
    });

    // 3. Persist the order. The escrow transaction is already open, so a DB
    //    failure shouldn't crash the buyer's checkout — record whether it stuck.
    let persisted = false;
    try {
      const db = ctx.supabase as OrdersInsertClient;
      const { error } = await db.from("orders").insert({
        id: orderId,
        buyer_id: ctx.userId,
        farmer_id: farmerId,
        status: "in_escrow",
        items: input.items,
        subtotal_cents: breakdown.subtotalCents,
        platform_fee_cents: breakdown.platformFeeCents,
        escrow_fee_cents: breakdown.escrowFeeCents,
        total_cents: breakdown.totalCents,
        escrow_provider: escrow.provider,
        escrow_transaction_id: escrow.transactionId,
        escrow_url: escrow.url,
        shipping_address: input.shippingAddress,
      });
      if (error) throw new Error(error.message);
      persisted = true;
    } catch (err) {
      console.error(`[checkout] failed to persist order ${orderId}:`, err);
    }

    return {
      orderId,
      status: "in_escrow",
      breakdown,
      escrow,
      persisted,
    };
  }
}
