// Shared CORS configuration for all DiGiFaMaR edge functions.
//
// The production web app is served from https://app.digifamar.com. The native
// (Capacitor) Android/iOS shells call the same functions from capacitor:// and
// http://localhost origins, so those are allowed too. Add new front-end
// origins here as they come online.
const ALLOWED_ORIGINS = [
  "https://app.digifamar.com",
  "https://www.digifamar.com",
  "https://digifamar.com",
  "capacitor://localhost",
  "http://localhost",
];

/**
 * Build CORS response headers for the given request origin. Unknown origins
 * fall back to the canonical app origin so we never echo an arbitrary site.
 */
export function corsHeaders(origin: string | null): Record<string, string> {
  const allow =
    origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}
