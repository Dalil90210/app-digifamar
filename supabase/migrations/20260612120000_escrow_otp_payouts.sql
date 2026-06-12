-- DiGiFaMaR escrow-release pipeline: delivery OTPs, farmer payouts, and an
-- admin-facing audit log. These back the send-otp / verify-otp / release-escrow
-- edge functions. All three new tables are written only by edge functions
-- running with the service role, so authenticated users get no write grants.

-- --------------------------------------------------------------------------
-- orders: link each order to the farmer who gets paid, capture the gateway fee
-- the processor charges, and record when escrow was released.
-- --------------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS farmer_id         UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS gateway_fee_cents INTEGER NOT NULL DEFAULT 0
                                             CHECK (gateway_fee_cents >= 0),
  ADD COLUMN IF NOT EXISTS released_at       TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS orders_farmer_idx
  ON public.orders (farmer_id, created_at DESC);

-- Farmers may read the orders they are selling on (for their dashboard/payouts).
DROP POLICY IF EXISTS "Farmers read their own sales" ON public.orders;
CREATE POLICY "Farmers read their own sales"
  ON public.orders FOR SELECT TO authenticated
  USING (auth.uid() = farmer_id);

-- --------------------------------------------------------------------------
-- order_otps: one-time delivery-confirmation codes. We store only a SHA-256
-- hash of the code, never the plaintext, and expire/limit attempts.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_otps (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  phone       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,                 -- SHA-256 hex of the 6-digit code
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_otps_lookup_idx
  ON public.order_otps (order_id, created_at DESC);

GRANT ALL ON public.order_otps TO service_role;
ALTER TABLE public.order_otps ENABLE ROW LEVEL SECURITY;
-- No policies for `authenticated`: only the service role (edge functions)
-- reads or writes OTPs. RLS-enabled + zero policies = no client access.

-- --------------------------------------------------------------------------
-- payouts: the money owed to a farmer once an order's escrow is released.
-- UNIQUE(order_id) makes the release operation idempotent.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payouts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  farmer_id          UUID NOT NULL REFERENCES auth.users(id),
  gross_cents        INTEGER NOT NULL CHECK (gross_cents >= 0),
  platform_fee_cents INTEGER NOT NULL CHECK (platform_fee_cents >= 0),
  gateway_fee_cents  INTEGER NOT NULL CHECK (gateway_fee_cents >= 0),
  net_cents          INTEGER NOT NULL CHECK (net_cents >= 0),
  status             TEXT NOT NULL DEFAULT 'pending',   -- pending | paid | failed
  provider           TEXT,
  provider_ref       TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id)
);
CREATE INDEX IF NOT EXISTS payouts_farmer_idx
  ON public.payouts (farmer_id, created_at DESC);

GRANT SELECT ON public.payouts TO authenticated;
GRANT ALL ON public.payouts TO service_role;
ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Farmers read their own payouts"
  ON public.payouts FOR SELECT TO authenticated
  USING (auth.uid() = farmer_id OR public.has_role(auth.uid(), 'admin'));

-- --------------------------------------------------------------------------
-- admin_audit_log: append-only trail of sensitive actions, surfaced on the
-- admin dashboard. Readable by admins only; written by the service role.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    UUID REFERENCES auth.users(id),   -- null = system/service action
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx
  ON public.admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_entity_idx
  ON public.admin_audit_log (entity_type, entity_id);

GRANT SELECT ON public.admin_audit_log TO authenticated;
GRANT ALL ON public.admin_audit_log TO service_role;
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read the audit log"
  ON public.admin_audit_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Keep payouts.updated_at fresh on every write.
CREATE OR REPLACE FUNCTION public.touch_payouts_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payouts_set_updated_at ON public.payouts;
CREATE TRIGGER payouts_set_updated_at
  BEFORE UPDATE ON public.payouts
  FOR EACH ROW EXECUTE FUNCTION public.touch_payouts_updated_at();
