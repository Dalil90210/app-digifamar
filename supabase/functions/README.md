# DiGiFaMaR Edge Functions

Secure Supabase Edge Functions (Deno + TypeScript) backing the delivery-OTP and
escrow-release flow.

| Function             | Auth          | Purpose                                                                 |
| -------------------- | ------------- | ----------------------------------------------------------------------- |
| `send-otp`           | Buyer (owner) | Generate a 6-digit OTP, store its hash, SMS it to the buyer.            |
| `verify-otp`         | Buyer (owner) | Verify the OTP; on success release escrow to the farmer.               |
| `calculate-distance` | Any user      | Haversine distance (miles) + delivery fee between farmer and buyer.     |
| `release-escrow`     | Admin only    | Manual/back-office escrow release (dispute resolution, overrides).      |

Shared code lives in [`_shared/`](./_shared): `cors.ts`, `http.ts` (response
envelopes), `auth.ts` (clients + JWT/admin checks), `log.ts` (audit log),
`fees.ts` (payout math), `sms.ts` (Twilio), `escrow.ts` (release logic + hashing).

## Data model

The migration `supabase/migrations/20260612120000_escrow_otp_payouts.sql` adds:

- `orders.farmer_id`, `orders.gateway_fee_cents`, `orders.released_at`
- `order_otps` — hashed, expiring OTP codes (service-role only; no client access)
- `payouts` — one row per order (`UNIQUE(order_id)` ⇒ idempotent release)
- `admin_audit_log` — append-only action trail, readable by admins

> **`orders.farmer_id` must be set at checkout** (the farmer who receives the
> payout). `release-escrow`/`verify-otp` return 422 if it is null.

## Fees / payout

`computePayout()` deducts the **platform fee** and **gateway fee** from the item
subtotal; the farmer nets the rest. Rates mirror `src/lib/cart/fees.ts`, which
currently charges **8%** platform + **3.25%** Escrow.com. The spec mentioned
**10%** — to switch, change `PLATFORM_FEE_RATE` in **both** `_shared/fees.ts`
and `src/lib/cart/fees.ts` so checkout and payout stay in sync.

## Response shape

All functions return a consistent envelope:

```jsonc
{ "success": true,  "data":  { /* ... */ } }   // 2xx
{ "success": false, "error": "message" }       // 4xx / 5xx
```

## Deploy

```bash
# From the repo root. Project ref is in supabase/config.toml.
supabase login
supabase link --project-ref qegnvdgnlhnzfnzaifaw

# 1) Apply the migration (new tables + columns)
supabase db push

# 2) Set function secrets (SUPABASE_URL / *_KEY are injected automatically)
supabase secrets set \
  TWILIO_ACCOUNT_SID=ACxxxxxxxx \
  TWILIO_AUTH_TOKEN=xxxxxxxx \
  TWILIO_FROM_NUMBER=+1xxxxxxxxxx
# Optional: ESCROW_API_KEY=...   (real Escrow.com disbursement)
# Optional: OTP_DEV_MODE=true    (no SMS gateway; send-otp returns dev_code)

# 3) Deploy the functions
supabase functions deploy send-otp
supabase functions deploy verify-otp
supabase functions deploy calculate-distance
supabase functions deploy release-escrow
# (or deploy all at once)
supabase functions deploy
```

## Quick test (curl)

```bash
BASE="https://qegnvdgnlhnzfnzaifaw.supabase.co/functions/v1"
JWT="<a logged-in user's access token>"

# Send an OTP (dev mode echoes dev_code)
curl -sX POST "$BASE/send-otp" \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"phone_number":"+15551234567","order_id":"<order-uuid>"}'

# Verify + release escrow
curl -sX POST "$BASE/verify-otp" \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"order_id":"<order-uuid>","otp":"123456"}'

# Distance + delivery fee
curl -sX POST "$BASE/calculate-distance" \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"farmer_lat":34.05,"farmer_lng":-118.24,"buyer_lat":34.10,"buyer_lng":-118.33}'
```
