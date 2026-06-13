-- Unify the order/escrow layer onto a SINGLE release mechanism.
--
-- Background: three overlapping systems had accumulated on the one public.orders
-- table:
--   * order_otps table + edge functions (send-otp / verify-otp / release-escrow)
--     — the mechanism we are keeping.
--   * orders.release_code_hash column + trigger references — a rival OTP scheme,
--     unused by any runtime code. Removed here.
--   * TWO competing BEFORE UPDATE triggers with conflicting state machines:
--       - enforce_order_update_policy()        (no service-role bypass)
--       - enforce_orders_update_restrictions() (has service-role bypass)
--     Both fired on every UPDATE, so the first one BLOCKED the service-role
--     escrow release performed by verify-otp/release-escrow. Collapsed into one.
--
-- This migration:
--   1. Rewrites validate_order_insert() — drops release_code_hash, charges the
--      unified 10% platform + 3.25% escrow fee (matches src/lib/cart/fees.ts).
--   2. Rewrites enforce_orders_update_restrictions() as the single canonical
--      update guard — keeps the service-role bypass so the edge functions can
--      flip an order to 'released', drops release_code_hash from the immutable
--      set, and uses enum-valid status transitions.
--   3. Drops the redundant enforce_order_update_policy() trigger + function.
--   4. Drops the now-unreferenced orders.release_code_hash column.

-- 1) Insert validator — no release_code_hash, unified fee rates. ----------------
CREATE OR REPLACE FUNCTION public.validate_order_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_price integer;
  v_farmer uuid;
BEGIN
  NEW.status := 'pending';

  SELECT price_cents, farmer_id INTO v_price, v_farmer
  FROM public.listings WHERE id = NEW.listing_id;
  IF v_price IS NULL THEN
    RAISE EXCEPTION 'Listing % not found', NEW.listing_id;
  END IF;

  NEW.farmer_id := v_farmer;
  NEW.subtotal_cents := v_price * NEW.qty;
  -- Unified fee model: 10% platform + 3.25% Escrow.com (mirrors src/lib/cart/fees.ts).
  NEW.platform_fee_cents := GREATEST(0, ROUND(NEW.subtotal_cents * 0.10))::int;
  NEW.escrow_fee_cents   := GREATEST(0, ROUND(NEW.subtotal_cents * 0.0325))::int;
  NEW.total_cents := NEW.subtotal_cents + NEW.platform_fee_cents + NEW.escrow_fee_cents;

  RETURN NEW;
END;
$$;

-- 2) Single canonical update guard. --------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_orders_update_restrictions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  -- Service role / server-side (edge functions releasing escrow) bypass entirely.
  IF uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Immutable identity & financial fields (release_code_hash intentionally gone).
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.buyer_id IS DISTINCT FROM OLD.buyer_id
     OR NEW.farmer_id IS DISTINCT FROM OLD.farmer_id
     OR NEW.listing_id IS DISTINCT FROM OLD.listing_id
     OR NEW.qty IS DISTINCT FROM OLD.qty
     OR NEW.subtotal_cents IS DISTINCT FROM OLD.subtotal_cents
     OR NEW.total_cents IS DISTINCT FROM OLD.total_cents
     OR NEW.platform_fee_cents IS DISTINCT FROM OLD.platform_fee_cents
     OR NEW.escrow_fee_cents IS DISTINCT FROM OLD.escrow_fee_cents
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Modification of protected order fields is not allowed';
  END IF;

  -- Client-initiated status transitions (enum-aligned). Escrow release to
  -- 'released' is done by the service role above and is NOT client-reachable.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF uid = OLD.farmer_id
       AND OLD.status IN ('paid','in_escrow')
       AND NEW.status = 'shipped' THEN
      NULL;
    ELSIF uid = OLD.buyer_id
       AND OLD.status = 'shipped'
       AND NEW.status = 'delivered' THEN
      NULL;
    ELSIF (uid = OLD.buyer_id OR uid = OLD.farmer_id)
       AND OLD.status = 'pending'
       AND NEW.status = 'cancelled' THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Disallowed order status transition % -> %', OLD.status, NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 3) Drop the redundant/​conflicting second update trigger + function. ----------
DROP TRIGGER IF EXISTS enforce_order_update_policy_trg ON public.orders;
DROP FUNCTION IF EXISTS public.enforce_order_update_policy();

-- 4) Drop the now-unreferenced rival OTP column. -------------------------------
ALTER TABLE public.orders DROP COLUMN IF EXISTS release_code_hash;
