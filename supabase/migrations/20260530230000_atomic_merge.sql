-- ============================================================================
-- Atomic theme merge — make the highest-risk multi-step write transactional.
-- Plain English: resolving a "merge" intel_update moves the source theme's
-- evidence onto the survivor, logs an event, then deletes the source. Done as
-- separate client calls, a mid-way failure can leave signals on BOTH themes or
-- a half-merge. A single SECURITY DEFINER function runs it all in ONE
-- transaction: either the whole merge lands or none of it does.
--
-- SECURITY: org is resolved from current_org_id() inside the function and every
-- touched row is checked against it — a caller can't merge across orgs even
-- though the function is SECURITY DEFINER.
-- ============================================================================

create or replace function public.merge_themes(p_into uuid, p_from uuid, p_from_title text default null, p_actor text default 'human')
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid := public.current_org_id();
begin
  if v_org is null then raise exception 'no org in context'; end if;
  if p_into is null or p_from is null or p_into = p_from then
    raise exception 'merge needs two distinct themes';
  end if;

  -- Both themes must belong to the caller's org (defends the SECURITY DEFINER).
  if not exists (select 1 from signal_themes where id = p_into and org_id = v_org)
     or not exists (select 1 from signal_themes where id = p_from and org_id = v_org) then
    raise exception 'theme not found in org';
  end if;

  -- Move the source theme's evidence onto the survivor (idempotent).
  insert into theme_signals (org_id, theme_id, signal_id, added_at, stance)
  select v_org, p_into, ts.signal_id, ts.added_at, ts.stance
    from theme_signals ts
   where ts.theme_id = p_from
  on conflict (theme_id, signal_id) do nothing;

  -- Log the merge on the survivor.
  insert into theme_events (org_id, theme_id, kind, detail, actor)
  values (v_org, p_into, 'merged_in', jsonb_build_object('from', p_from, 'from_title', p_from_title), p_actor);

  -- Dissolve the duplicate (its theme_signals + theme_events cascade away).
  delete from signal_themes where id = p_from and org_id = v_org;

  -- Resync the survivor's signal_ids[] + last_evidence_at to its evidence.
  update signal_themes t set
    signal_ids = coalesce((select array_agg(ts.signal_id) from theme_signals ts where ts.theme_id = t.id), '{}'),
    last_evidence_at = (select max(ts.added_at) from theme_signals ts where ts.theme_id = t.id)
  where t.id = p_into;
end $$;

comment on function public.merge_themes(uuid, uuid, text, text) is 'Atomically merge theme p_from into p_into: move evidence, log merged_in, delete the source, resync signal_ids/last_evidence — all in one transaction. Org-checked despite SECURITY DEFINER.';
