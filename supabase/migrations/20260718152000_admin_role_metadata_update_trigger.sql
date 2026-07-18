-- Ensure trusted app metadata can promote a server-created user to admin even
-- when metadata is finalized after the initial auth.users insert.
CREATE OR REPLACE FUNCTION public.handle_user_app_metadata_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.raw_app_meta_data->>'allow_admin_role', 'false') = 'true'
     AND COALESCE(NEW.raw_app_meta_data->>'role', '') = 'admin' THEN
    DELETE FROM public.user_roles
    WHERE user_id = NEW.id
      AND role = 'buyer';

    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_app_metadata_updated ON auth.users;
CREATE TRIGGER on_auth_user_app_metadata_updated
  AFTER UPDATE OF raw_app_meta_data ON auth.users
  FOR EACH ROW
  WHEN (NEW.raw_app_meta_data IS DISTINCT FROM OLD.raw_app_meta_data)
  EXECUTE FUNCTION public.handle_user_app_metadata_update();