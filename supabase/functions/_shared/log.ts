// Audit logging for the admin dashboard. Every sensitive action (OTP sent,
// OTP verified/failed, escrow released) records a row in admin_audit_log.
import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

/**
 * Append an entry to admin_audit_log. Best-effort by design: logging must never
 * break the request it describes, so a failed insert is reported to the function
 * logs but not thrown.
 */
export async function logAction(
  svc: SupabaseClient,
  entry: {
    actorId?: string | null;
    action: string;
    entityType?: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await svc.from("admin_audit_log").insert({
    actor_id: entry.actorId ?? null,
    action: entry.action,
    entity_type: entry.entityType ?? null,
    entity_id: entry.entityId ?? null,
    metadata: entry.metadata ?? {},
  });
  if (error) console.error("admin_audit_log insert failed:", error.message);
}
