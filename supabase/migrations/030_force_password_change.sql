-- ============================================================
-- Migration 030: Audit S8 — invited users must change the emailed temp
-- password on first login, and that temp password must expire.
-- Applied live to zabfuqxjjunsppotfrel on 2026-07-20.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS password_set_at TIMESTAMPTZ;

COMMENT ON COLUMN users.must_change_password IS
  'True while the user still holds an emailed temporary password. Cleared when they set their own.';
COMMENT ON COLUMN users.password_set_at IS
  'When the current password was issued/changed. Used to expire unused temp credentials.';

CREATE OR REPLACE FUNCTION public.protect_password_flags()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.id <> auth.uid() AND NOT public.is_super_admin() THEN
    NEW.must_change_password := OLD.must_change_password;
    NEW.password_set_at      := OLD.password_set_at;
    RETURN NEW;
  END IF;

  IF NEW.must_change_password IS TRUE AND OLD.must_change_password IS FALSE THEN
    NEW.must_change_password := FALSE;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_password_flags ON users;
CREATE TRIGGER trg_protect_password_flags
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION public.protect_password_flags();

REVOKE EXECUTE ON FUNCTION public.protect_password_flags() FROM authenticated, anon;

UPDATE users SET password_set_at = COALESCE(password_set_at, created_at)
WHERE password_set_at IS NULL;
