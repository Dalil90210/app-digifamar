-- Allow trusted server-created admin users while still blocking self-assigned
-- admin role from client-controlled user metadata.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meta JSONB := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  app_meta JSONB := COALESCE(NEW.raw_app_meta_data, '{}'::jsonb);
  chosen_role public.app_role;
BEGIN
  INSERT INTO public.profiles (id, full_name, email, phone)
  VALUES (
    NEW.id,
    COALESCE(meta->>'full_name', meta->>'name', NEW.email),
    NEW.email,
    meta->>'phone'
  )
  ON CONFLICT (id) DO NOTHING;

  BEGIN
    chosen_role := COALESCE(meta->>'role', 'buyer')::public.app_role;
  EXCEPTION WHEN others THEN
    chosen_role := 'buyer';
  END;

  IF chosen_role = 'admin'
     AND COALESCE(app_meta->>'allow_admin_role', 'false') <> 'true' THEN
    chosen_role := 'buyer';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, chosen_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;