-- ============================================================================
-- SECURITY FIX: metric_latest() bypassed RLS (cross-tenant read).
--
-- 20260601000000 defined metric_latest() as SECURITY DEFINER, which runs with
-- the owner's rights and BYPASSES row-level security. Since the function did no
-- org check, any authenticated user could read ANY org's metric values by
-- passing a field id — a cross-tenant data leak (verified: a user in org B read
-- org A's NPS through the RPC, while the direct table read was correctly blocked
-- by RLS).
--
-- Fix: this function only reads record_metrics, which already has org-scoped RLS.
-- It does NOT need definer rights. Redefine WITHOUT security definer so it runs
-- as the caller and RLS applies normally. (No recursion risk — unlike
-- current_org_id(), this reads a table that isn't self-referential in policy.)
-- ============================================================================

create or replace function public.metric_latest(p_field_id uuid)
returns table (period date, value_num numeric, prev_value numeric, mom_delta numeric, source_label text)
language sql stable
-- runs as the CALLER; record_metrics RLS confines it to the caller's org.
set search_path = public, pg_temp
as $$
  with series as (
    select period, value_num, source_label,
           lead(value_num) over (order by period desc) as prev_value
    from record_metrics
    where record_field_id = p_field_id
    order by period desc
  )
  select period, value_num, prev_value,
         case when prev_value is null then null else value_num - prev_value end as mom_delta,
         source_label
  from series
  limit 1
$$;

comment on function public.metric_latest(uuid) is
  'Latest period value + MoM delta for a metric field. Runs as the caller (NOT security definer) so record_metrics RLS confines results to the caller''s org.';
