/**
 * Auth module — server-side service.
 * NestJS equivalent: auth.service.ts
 *
 * Wraps Supabase Auth admin operations. Never import this from client code:
 * it depends on `supabaseAdmin` (service-role key).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { AuthUserDto, SignUpDto } from "./dto";

export class AuthService {
  /**
   * Provision a new user with a role. Mirrors the public sign-up flow but
   * is intended to be called from a trusted server context.
   */
  static async signUp(input: SignUpDto): Promise<AuthUserDto> {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: false,
      user_metadata: {
        full_name: input.fullName,
        role: input.role,
      },
      // Only trusted server-side provisioning can set this flag. The DB
      // trigger uses it to allow admin role assignment.
      app_metadata: {
        allow_admin_role: input.role === "admin",
      },
    });
    if (error || !data.user) {
      throw new Error(error?.message ?? "Failed to create user");
    }
    return {
      id: data.user.id,
      email: data.user.email ?? null,
      role: input.role,
      fullName: input.fullName,
    };
  }

  /** Returns the authenticated user's enriched profile + role. */
  static async getMe(userId: string): Promise<AuthUserDto> {
    const [{ data: profile }, { data: roleRow }] = await Promise.all([
      supabaseAdmin.from("profiles").select("email, full_name").eq("id", userId).maybeSingle(),
      supabaseAdmin.from("user_roles").select("role").eq("user_id", userId).maybeSingle(),
    ]);
    return {
      id: userId,
      email: profile?.email ?? null,
      role: (roleRow?.role as AuthUserDto["role"]) ?? "buyer",
      fullName: profile?.full_name ?? null,
    };
  }
}
