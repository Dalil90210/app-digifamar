import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const inputSchema = z.object({
  id: z.string().uuid(),
});

export type FarmListing = {
  id: string;
  farmer_id: string;
  title: string;
  price_cents: number;
  unit: string;
  category: string;
  image: string | null;
};

export type FarmDetail = {
  farmerId: string;
  name: string;
  description: string | null;
  city: string | null;
  state: string | null;
  certifications: string[];
  verified: boolean;
  yearsFarming: number | null;
  listings: FarmListing[];
};

/**
 * Public farm profile + its active listings, by farmer user_id. Read with the
 * service role (like searchBrowse) so it works for any visitor; only public,
 * non-sensitive fields are returned. Returns null when no profile exists.
 */
export const getFarmDetail = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }): Promise<FarmDetail | null> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: profile, error: profErr } = await supabaseAdmin
      .from("farmer_profiles")
      .select(
        "user_id, farm_name, description, city, state, certifications, verification_status, years_farming",
      )
      .eq("user_id", data.id)
      .maybeSingle();
    if (profErr) throw new Error(profErr.message);
    if (!profile) return null;

    const { data: listingRows, error: listErr } = await supabaseAdmin
      .from("listings")
      .select("id, farmer_id, title, price_cents, unit, category, images")
      .eq("farmer_id", data.id)
      .eq("status", "active")
      .order("created_at", { ascending: false });
    if (listErr) throw new Error(listErr.message);

    const listings: FarmListing[] = (
      (listingRows ?? []) as Array<{
        id: string;
        farmer_id: string;
        title: string;
        price_cents: number;
        unit: string;
        category: string;
        images: string[] | null;
      }>
    ).map((r) => ({
      id: r.id,
      farmer_id: r.farmer_id,
      title: r.title,
      price_cents: r.price_cents,
      unit: r.unit,
      category: r.category,
      image: r.images?.[0] ?? null,
    }));

    return {
      farmerId: profile.user_id,
      name: profile.farm_name,
      description: profile.description,
      city: profile.city,
      state: profile.state,
      certifications: profile.certifications ?? [],
      verified: profile.verification_status === "verified",
      yearsFarming: profile.years_farming,
      listings,
    };
  });
