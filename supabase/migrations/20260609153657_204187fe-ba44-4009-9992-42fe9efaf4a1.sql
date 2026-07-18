
-- Reviews: restrict SELECT to participants only
DO $$
BEGIN
  IF to_regclass('public.reviews') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Reviews viewable by authenticated" ON public.reviews;
    CREATE POLICY "Reviews viewable by participants"
      ON public.reviews FOR SELECT
      TO authenticated
      USING (auth.uid() = buyer_id OR auth.uid() = farmer_id);
  END IF;
END
$$;

-- user_roles: prevent any client-side INSERT/UPDATE/DELETE.
-- Role assignment happens server-side via handle_new_user() trigger (SECURITY DEFINER).
REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM anon, authenticated;
