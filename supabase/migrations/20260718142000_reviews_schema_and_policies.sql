-- Create reviews table expected by generated types and farmer dashboard.
CREATE TABLE IF NOT EXISTS public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  farmer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.reviews TO authenticated;
GRANT ALL ON public.reviews TO service_role;

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants view reviews" ON public.reviews;
CREATE POLICY "Participants view reviews"
  ON public.reviews FOR SELECT TO authenticated
  USING (
    auth.uid() = buyer_id
    OR auth.uid() = farmer_id
    OR public.has_role(auth.uid(), 'admin')
  );

DROP POLICY IF EXISTS "Buyer creates own review" ON public.reviews;
CREATE POLICY "Buyer creates own review"
  ON public.reviews FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = buyer_id);