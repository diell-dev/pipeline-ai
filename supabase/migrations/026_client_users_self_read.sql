-- Migration 026: let a client login read ONLY its own users row.
-- Migration 025 added a RESTRICTIVE block-client-read on `users`, which also
-- blocked a client from reading their OWN profile — breaking session load
-- (providers.tsx / root redirect do `.from('users').eq('id', auth.uid())`).
-- Allow self-read while still hiding every other user from clients.
DROP POLICY IF EXISTS "portal_block_client_read" ON public.users;
CREATE POLICY "portal_block_client_read" ON public.users
  AS RESTRICTIVE FOR SELECT TO public
  USING (public.get_user_role() <> 'client' OR id = auth.uid());
