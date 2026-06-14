-- Migration: seed_plg_areas_wiring  (P2 — orchestration vocabulary binding)
-- Purpose: guarantee every org has the canonical PLG area/task taxonomy, at the DATA
--   layer (not hoping app code calls it). Two parts: a trigger that seeds areas on org
--   creation, and a one-time backfill of all existing orgs. Must run BEFORE the
--   connections/skills area backfills, which resolve area keys that this installs.
-- Author: SingleStack · Date: 2026-06-14
-- seed_plg_areas() is security definer + idempotent (defined in 20260614030000).

-- 1. Trigger: seed the taxonomy whenever an org is created.
create or replace function public.seed_plg_areas_on_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_plg_areas(new.id);
  return new;
end;
$$;

drop trigger if exists orgs_seed_plg_areas on public.orgs;
create trigger orgs_seed_plg_areas
  after insert on public.orgs
  for each row execute function public.seed_plg_areas_on_org();

comment on function public.seed_plg_areas_on_org() is 'Installs the canonical PLG area/task taxonomy for each new org. Idempotent via seed_plg_areas().';

-- 2. Backfill every existing org (idempotent — on_conflict do nothing inside the seed).
do $$
declare o record;
begin
  for o in select id from public.orgs loop
    perform public.seed_plg_areas(o.id);
  end loop;
end $$;
