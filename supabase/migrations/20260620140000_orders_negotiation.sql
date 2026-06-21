-- Link chat negotiations to real orders.
--
-- We EXTEND the canonical public.orders table (the one backing order_otps,
-- payouts, and the send-otp / verify-otp / release-escrow pipeline) rather than
-- introducing a rival table. A buyer accepting a price in chat now creates a
-- real order whose item price is the negotiated amount and whose total includes
-- the chat-computed delivery fee. Everything is additive and idempotent.

ALTER TABLE public.orders
  -- Agreed item price from the chat (overrides the listing price for subtotal).
  ADD COLUMN IF NOT EXISTS negotiated_price_cents integer
    CHECK (negotiated_price_cents IS NULL OR negotiated_price_cents >= 0),
  -- Distance-based delivery fee shown to the buyer at accept time.
  ADD COLUMN IF NOT EXISTS delivery_fee_cents integer NOT NULL DEFAULT 0
    CHECK (delivery_fee_cents >= 0),
  ADD COLUMN IF NOT EXISTS distance_mi numeric,
  -- Back-link to the conversation the order was negotiated in.
  ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES public.conversations(id),
  -- Buyer phone captured for the delivery OTP (the code itself lives hashed in
  -- public.order_otps — never in plaintext on the order).
  ADD COLUMN IF NOT EXISTS phone text;

CREATE INDEX IF NOT EXISTS orders_conversation_idx
  ON public.orders (conversation_id);

-- Recompute the order total from the negotiated price + delivery fee, keeping
-- the unified 10% platform + 3.25% escrow fee model. farmer_id and the listing
-- fallback price are still resolved server-side so the client cannot spoof them.
CREATE OR REPLACE FUNCTION public.validate_order_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_price    integer;
  v_farmer   uuid;
  v_subtotal integer;
BEGIN
  NEW.status := 'pending';

  SELECT price_cents, farmer_id INTO v_price, v_farmer
  FROM public.listings WHERE id = NEW.listing_id;
  IF v_price IS NULL THEN
    RAISE EXCEPTION 'Listing % not found', NEW.listing_id;
  END IF;

  NEW.farmer_id := v_farmer;

  -- Negotiated price (agreed in chat) sets the item subtotal when provided;
  -- otherwise fall back to the listing price × quantity.
  v_subtotal := GREATEST(0, COALESCE(NEW.negotiated_price_cents, v_price * NEW.qty));
  NEW.subtotal_cents     := v_subtotal;
  NEW.platform_fee_cents := GREATEST(0, ROUND(v_subtotal * 0.10))::int;
  NEW.escrow_fee_cents   := GREATEST(0, ROUND(v_subtotal * 0.0325))::int;
  NEW.delivery_fee_cents := GREATEST(0, COALESCE(NEW.delivery_fee_cents, 0));
  NEW.total_cents :=
    v_subtotal + NEW.platform_fee_cents + NEW.escrow_fee_cents + NEW.delivery_fee_cents;

  RETURN NEW;
END;
$$;
