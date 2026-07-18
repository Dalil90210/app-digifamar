-- Align listings schema with fields currently read/written by app code.
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS images text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS qty_available integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS unit text;

-- Backfill safe defaults for pre-existing rows.
UPDATE public.listings
SET
  title = COALESCE(title, 'Untitled listing'),
  slug = COALESCE(slug, id::text),
  category = COALESCE(category, 'general'),
  unit = COALESCE(unit, 'unit')
WHERE title IS NULL
   OR slug IS NULL
   OR category IS NULL
   OR unit IS NULL;

ALTER TABLE public.listings
  ALTER COLUMN title SET NOT NULL,
  ALTER COLUMN slug SET NOT NULL,
  ALTER COLUMN category SET NOT NULL,
  ALTER COLUMN unit SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS listings_slug_key ON public.listings (slug);