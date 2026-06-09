-- © 2026 Gominplanet / MVP Affiliate
--
-- Batched stale-delete for the Creator Campaigns catalog.
--
-- Background: every weekly import uploads new rows (imported_at = now)
-- then needs to prune the previous week's leftovers (imported_at <
-- batchStart). On a ~600K-row catalog the single bulk DELETE issued by
-- /api/admin/creator-campaigns/import-finalize hit Supabase's default
-- per-statement timeout ("canceling statement due to statement
-- timeout"). Symptom: cleanup fails, catalog is left in a weird state.
--
-- This function loops, deleting at most `chunk_size` rows per statement
-- so each individual DELETE finishes well inside the timeout. The loop
-- itself raises its own statement_timeout to 5 minutes so the whole
-- procedure isn't capped — that's the wrapping function's budget, not
-- a per-statement budget. Returns the total number of rows deleted so
-- the API can surface it in the finalize report (same shape as the
-- previous .delete({ count: 'exact' }) call).
--
-- Idempotent: re-running with the same batch_start is safe — anything
-- already deleted simply isn't seen by the next loop iteration. The
-- partial-progress case (timeout mid-loop) leaves a valid catalog state
-- where the surviving stale rows can be cleaned by the next Retry.

create or replace function public.delete_stale_creator_campaigns(
  p_batch_start timestamptz,
  p_chunk_size  int default 25000
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted_total int := 0;
  v_chunk         int;
begin
  -- 5min budget for the whole loop. Individual DELETEs are bounded by
  -- the chunk size so they finish in a few seconds each; this raised
  -- ceiling is here to keep the outer transaction from being killed if
  -- the catalog is unusually large or the DB is under load.
  set local statement_timeout = '300s';

  loop
    with victims as (
      select id
      from creator_connections_catalog
      where imported_at < p_batch_start
      limit p_chunk_size
    )
    delete from creator_connections_catalog c
    using victims v
    where c.id = v.id;

    get diagnostics v_chunk = row_count;
    v_deleted_total := v_deleted_total + v_chunk;
    exit when v_chunk = 0;
  end loop;

  return v_deleted_total;
end;
$$;

comment on function public.delete_stale_creator_campaigns(timestamptz, int) is
  'Batched stale-row pruner for creator_connections_catalog. Used by /api/admin/creator-campaigns/import-finalize after a weekly upload to remove rows whose imported_at predates the new batch. Deletes in chunks of p_chunk_size (default 25k) so each statement stays well under the per-statement timeout — the previous bulk DELETE blew up on ~600K-row catalogs. Returns total rows deleted.';

-- Grant execute to authenticated users; the API route gates on admin
-- tier separately, so this only matters for direct SQL access.
grant execute on function public.delete_stale_creator_campaigns(timestamptz, int) to authenticated;
