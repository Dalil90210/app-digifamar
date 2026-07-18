
-- 1) Orders: column-restricted updates via trigger
CREATE OR REPLACE FUNCTION public.enforce_orders_update_restrictions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  -- Service role / no JWT bypass (server-side code)
  IF uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Immutable identity & financial fields
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.buyer_id IS DISTINCT FROM OLD.buyer_id
     OR NEW.farmer_id IS DISTINCT FROM OLD.farmer_id
     OR NEW.listing_id IS DISTINCT FROM OLD.listing_id
     OR NEW.qty IS DISTINCT FROM OLD.qty
     OR NEW.subtotal_cents IS DISTINCT FROM OLD.subtotal_cents
     OR NEW.total_cents IS DISTINCT FROM OLD.total_cents
     OR NEW.platform_fee_cents IS DISTINCT FROM OLD.platform_fee_cents
     OR NEW.escrow_fee_cents IS DISTINCT FROM OLD.escrow_fee_cents
     OR NEW.release_code_hash IS DISTINCT FROM OLD.release_code_hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Modification of protected order fields is not allowed';
  END IF;

  -- Status transitions: only the farmer may change status, with restricted transitions
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF uid <> OLD.farmer_id THEN
      RAISE EXCEPTION 'Only the farmer can change order status';
    END IF;
    IF NOT (
      (OLD.status = 'pending'    AND NEW.status IN ('accepted','cancelled')) OR
      (OLD.status = 'accepted'   AND NEW.status IN ('in_transit','cancelled')) OR
      (OLD.status = 'in_transit' AND NEW.status IN ('delivered','cancelled')) OR
      (OLD.status = 'delivered'  AND NEW.status = 'released')
    ) THEN
      RAISE EXCEPTION 'Invalid order status transition: % -> %', OLD.status, NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_orders_update_restrictions ON public.orders;
CREATE TRIGGER enforce_orders_update_restrictions
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.enforce_orders_update_restrictions();

-- 2) order_events: explicitly block direct client INSERTs
DROP POLICY IF EXISTS "No direct client inserts on order events" ON public.order_events;
CREATE POLICY "No direct client inserts on order events"
ON public.order_events
FOR INSERT
TO authenticated
WITH CHECK (false);

-- 3) reviews: allow any authenticated user to read (marketplace browsing)
DO $$
BEGIN
  IF to_regclass('public.reviews') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Reviews viewable by participants" ON public.reviews;
    DROP POLICY IF EXISTS "Reviews viewable by authenticated" ON public.reviews;
    CREATE POLICY "Reviews viewable by authenticated"
    ON public.reviews
    FOR SELECT
    TO authenticated
    USING (true);
  END IF;
END
$$;

-- 4) realtime authorization for conversation channels
-- Allow subscribers to a conversation:<id> topic only if they are a participant.
DROP POLICY IF EXISTS "Authenticated can subscribe to own conversation channels" ON realtime.messages;
CREATE POLICY "Authenticated can subscribe to own conversation channels"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  CASE
    WHEN realtime.topic() LIKE 'conversation:%' THEN EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id::text = substring(realtime.topic() from 14)
        AND (auth.uid() = c.buyer_id OR auth.uid() = c.farmer_id)
    )
    WHEN realtime.topic() LIKE 'chat:%' THEN EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id::text = substring(realtime.topic() from 6)
        AND (auth.uid() = c.buyer_id OR auth.uid() = c.farmer_id)
    )
    ELSE false
  END
);
