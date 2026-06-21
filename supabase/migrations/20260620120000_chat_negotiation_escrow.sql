-- In-app chat → price negotiation → escrow.
--
-- The chat layer (public.conversations + public.messages) was created in the
-- Lovable dashboard. This migration extends it so a single conversation row
-- carries the whole deal state: the product being negotiated, the agreed price,
-- the computed delivery fee, and the escrow status — all readable/writable by
-- the two participants and broadcast over Supabase Realtime via the messages
-- channel. Everything here is additive and idempotent.

-- ── conversations: product context + negotiation + escrow state ───────────────
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS farm_name             text,
  ADD COLUMN IF NOT EXISTS updated_at            timestamptz NOT NULL DEFAULT now(),
  -- Product being negotiated (mirrors the listing/product the buyer arrived from).
  ADD COLUMN IF NOT EXISTS product_name          text,
  ADD COLUMN IF NOT EXISTS qty                   integer,
  ADD COLUMN IF NOT EXISTS unit                  text,
  ADD COLUMN IF NOT EXISTS unit_price_cents       integer,
  -- Negotiation outcome.
  ADD COLUMN IF NOT EXISTS negotiation_status     text NOT NULL DEFAULT 'negotiating'
    CHECK (negotiation_status IN ('negotiating','accepted')),
  ADD COLUMN IF NOT EXISTS negotiated_price_cents integer,
  -- Delivery (distance is computed from farmer ↔ buyer coordinates).
  ADD COLUMN IF NOT EXISTS distance_mi            numeric,
  ADD COLUMN IF NOT EXISTS delivery_fee_cents     integer,
  -- Escrow.
  ADD COLUMN IF NOT EXISTS escrow_status          text NOT NULL DEFAULT 'none'
    CHECK (escrow_status IN ('none','held','released')),
  ADD COLUMN IF NOT EXISTS escrow_total_cents     integer,
  ADD COLUMN IF NOT EXISTS payment_method         text
    CHECK (payment_method IN ('card','paypal','bank')),
  ADD COLUMN IF NOT EXISTS order_id               text;

-- ── messages: distinguish chat bubbles from negotiation/escrow system cards ───
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS kind     text NOT NULL DEFAULT 'text'
    CHECK (kind IN ('text','system','prefill')),
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_read  boolean NOT NULL DEFAULT false;

-- ── Let the two participants update the deal state on their conversation ──────
-- (Reads/inserts already exist from the dashboard-created policies.)
DROP POLICY IF EXISTS "Participants update their conversation" ON public.conversations;
CREATE POLICY "Participants update their conversation"
  ON public.conversations FOR UPDATE TO authenticated
  USING (auth.uid() = buyer_id OR auth.uid() = farmer_id)
  WITH CHECK (auth.uid() = buyer_id OR auth.uid() = farmer_id);

-- Column-scoped UPDATE grant: participants may move the deal forward but never
-- rewrite who the buyer/farmer are or when the row was created.
GRANT UPDATE (
  farm_name, updated_at, product_name, qty, unit, unit_price_cents,
  negotiation_status, negotiated_price_cents, distance_mi, delivery_fee_cents,
  escrow_status, escrow_total_cents, payment_method, order_id, last_message_at,
  product_id
) ON public.conversations TO authenticated;

GRANT UPDATE (is_read) ON public.messages TO authenticated;

-- Keep conversations.updated_at fresh on every write.
CREATE OR REPLACE FUNCTION public.touch_conversations_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS conversations_set_updated_at ON public.conversations;
CREATE TRIGGER conversations_set_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.touch_conversations_updated_at();
