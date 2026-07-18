-- Fix has_role execute permissions so RLS policies on orders can evaluate.
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated;

-- Enforce row-level security on listings with buyer/farmer/admin scoping.
GRANT SELECT, INSERT, UPDATE ON public.listings TO authenticated;
GRANT ALL ON public.listings TO service_role;

ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Listings read scope" ON public.listings;
CREATE POLICY "Listings read scope"
  ON public.listings FOR SELECT TO authenticated
  USING (
    status = 'active'
    OR auth.uid() = farmer_id
    OR public.has_role(auth.uid(), 'admin')
  );

DROP POLICY IF EXISTS "Farmers insert own listings" ON public.listings;
CREATE POLICY "Farmers insert own listings"
  ON public.listings FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = farmer_id
    OR public.has_role(auth.uid(), 'admin')
  );

DROP POLICY IF EXISTS "Farmers update own listings" ON public.listings;
CREATE POLICY "Farmers update own listings"
  ON public.listings FOR UPDATE TO authenticated
  USING (
    auth.uid() = farmer_id
    OR public.has_role(auth.uid(), 'admin')
  )
  WITH CHECK (
    auth.uid() = farmer_id
    OR public.has_role(auth.uid(), 'admin')
  );