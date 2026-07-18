
-- 1. Tighten orders UPDATE: split policies and use column-level GRANTs
DROP POLICY IF EXISTS "Participants update orders" ON public.orders;

CREATE POLICY "Farmers update their orders"
  ON public.orders FOR UPDATE
  USING (auth.uid() = farmer_id)
  WITH CHECK (auth.uid() = farmer_id);

CREATE POLICY "Buyers update their orders"
  ON public.orders FOR UPDATE
  USING (auth.uid() = buyer_id)
  WITH CHECK (auth.uid() = buyer_id);

-- Column-level privileges: prevent buyers/farmers from updating financial/identity columns at all.
-- Defense in depth alongside enforce_orders_update_restrictions trigger.
REVOKE UPDATE ON public.orders FROM authenticated;
GRANT UPDATE (status, shipping_address, notes, delivery_deadline, updated_at)
  ON public.orders TO authenticated;

-- 2. Ensure update-protection trigger exists
DROP TRIGGER IF EXISTS trg_enforce_orders_update_restrictions ON public.orders;
CREATE TRIGGER trg_enforce_orders_update_restrictions
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_orders_update_restrictions();

-- 3. Remove conversations from realtime publication (no client subscribes to it;
--    only messages channel is used for chat). Prevents unauthorized realtime
--    subscriptions to conversation metadata.
DO $$
BEGIN
  IF to_regclass('public.conversations') IS NOT NULL THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime DROP TABLE public.conversations;
    EXCEPTION
      WHEN undefined_object OR invalid_parameter_value THEN
        NULL;
    END;
  END IF;
END
$$;
