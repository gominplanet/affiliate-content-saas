-- Migration 026: campaigns DELETE RLS policy
--
-- 023 created select/insert/update policies but no DELETE policy, so a
-- user-scoped client could never delete a campaign row — the delete
-- silently affected 0 rows and the campaign reappeared on refresh.
--
-- The delete API route now uses the service-role client (scoped by
-- user_id) so deletes work regardless, but this policy makes the RLS
-- model correct/complete. Idempotent.

drop policy if exists "campaigns_delete_own" on public.campaigns;
create policy "campaigns_delete_own" on public.campaigns
  for delete using (auth.uid() = user_id);
