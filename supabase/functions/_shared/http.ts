// Shared HTTP helpers for DiGiFaMaR edge functions: a consistent JSON
// success/error envelope and CORS-aware responses, so every function returns
// the same shape ({ success, data } | { success, error }).
import { corsHeaders } from "./cors.ts";

/** JSON response with CORS headers merged in. */
export function json(
  body: unknown,
  status: number,
  origin: string | null,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

/** 200 success envelope: { success: true, data }. */
export function ok(data: unknown, origin: string | null): Response {
  return json({ success: true, data }, 200, origin);
}

/** Error envelope: { success: false, error }. `status` defaults to 400. */
export function fail(
  message: string,
  status = 400,
  origin: string | null = null,
  extra: Record<string, unknown> = {},
): Response {
  return json({ success: false, error: message, ...extra }, status, origin);
}

/**
 * Handle the CORS preflight. Returns a Response for an OPTIONS request,
 * otherwise null so the caller can continue processing.
 */
export function preflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders(req.headers.get("origin")),
    });
  }
  return null;
}
