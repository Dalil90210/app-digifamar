import { supabase } from "@/integrations/supabase/client";

/**
 * The minimal real-listing shape needed to open a negotiation chat. Matches the
 * fields on BrowseListing (and any real `listings` row).
 */
export interface ListingForChat {
  id: string;
  farmer_id: string;
  title: string;
  unit: string;
  price_cents: number;
  farm_name?: string | null;
}

/**
 * Find (or create) the buyer ↔ farmer 1-on-1 conversation and return its id. We
 * keep one conversation per buyer/farmer pair.
 *
 * Only the columns known to be client-insertable (buyer_id, farmer_id,
 * farm_name) are written here — any product context is filled in afterwards by
 * the chat route's seed effect through the granted UPDATE columns.
 */
export async function findOrCreateConversation(
  buyerId: string,
  farmerId: string,
  farmName: string | null,
): Promise<string | null> {
  const sb = supabase as any;

  const { data: existing } = await sb
    .from("conversations")
    .select("id")
    .eq("buyer_id", buyerId)
    .eq("farmer_id", farmerId)
    .maybeSingle();
  if (existing?.id) return existing.id as string;

  const { data: created } = await sb
    .from("conversations")
    .insert({ buyer_id: buyerId, farmer_id: farmerId, farm_name: farmName })
    .select("id")
    .single();
  return (created?.id as string | undefined) ?? null;
}

/**
 * Open the negotiation chat for a REAL listing — product context is carried to
 * the chat via the route search params and persisted onto the conversation there.
 */
export async function startListingChat(
  listing: ListingForChat,
  buyerId: string,
): Promise<string | null> {
  return findOrCreateConversation(buyerId, listing.farmer_id, listing.farm_name ?? null);
}
