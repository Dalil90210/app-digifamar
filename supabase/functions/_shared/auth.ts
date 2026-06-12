// Supabase client + auth helpers shared by the edge functions.
//
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are injected
// into the Edge runtime automatically; you do not set them yourself.
import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

/**
 * Service-role client: bypasses RLS. Use ONLY inside edge functions for trusted
 * writes (OTP storage, payouts, audit log, escrow release). Never expose the
 * service-role key to the browser.
 */
export function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type AuthedUser = { id: string; email: string | null };

/**
 * Resolve the caller from their `Authorization: Bearer <jwt>` header. The JWT
 * is validated server-side by Supabase auth. Returns null when the token is
 * missing or invalid so callers can respond 401.
 */
export async function getAuthedUser(req: Request): Promise<AuthedUser | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length);

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

/** True when the user holds the 'admin' role in public.user_roles. */
export async function isAdmin(
  svc: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data } = await svc
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  return !!data;
}
