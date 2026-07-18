
-- Restrict farmer_profiles SELECT: owner and admin only.
-- Public/aggregate browse already uses the service-role admin client, which bypasses RLS.
DROP POLICY IF EXISTS "Farmer profiles viewable by authenticated" ON public.farmer_profiles;

CREATE POLICY "Farmers view own profile"
  ON public.farmer_profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- Restrict reviews SELECT: buyer who wrote it, farmer being reviewed, or admin.
-- Aggregate ratings shown publicly should be fetched via a server function using the admin client.
DO $$
BEGIN
  IF to_regclass('public.reviews') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Reviews viewable by authenticated" ON public.reviews;

    CREATE POLICY "Participants view reviews"
      ON public.reviews FOR SELECT
      TO authenticated
      USING (
        auth.uid() = buyer_id
        OR auth.uid() = farmer_id
        OR public.has_role(auth.uid(), 'admin')
      );
  END IF;
END
$$;
