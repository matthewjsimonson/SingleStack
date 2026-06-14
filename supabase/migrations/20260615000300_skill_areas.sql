-- Migration: skill_areas  (P2 — orchestration vocabulary binding)
-- Purpose: bind child skills to the governed areas via a real join table, replacing the
--   loose skills.areas jsonb (schema §8: jsonb is not for relationships; §4: "which child
--   skills serve area X" is queried independently). Backfill from the existing jsonb using
--   an explicit, lossless legacy->canonical map; the jsonb column is RETAINED for now so
--   nothing is lost until a later cutover.
-- Order: runs after seed_plg_areas_wiring (areas must exist per org to resolve keys).
-- Author: SingleStack · Date: 2026-06-14

create table if not exists public.skill_areas (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  created_at  timestamptz not null default now(),

  skill_id    uuid not null references public.skills (id) on delete cascade,
  area_id     uuid not null references public.areas (id) on delete cascade,

  unique (org_id, skill_id, area_id)
);
comment on table public.skill_areas is 'Join: which governed areas a child skill serves. Replaces skills.areas jsonb; backfilled via the documented legacy->canonical map.';

create index if not exists skill_areas_org_id_idx on public.skill_areas (org_id);
create index if not exists skill_areas_skill_id_idx on public.skill_areas (org_id, skill_id);
create index if not exists skill_areas_area_id_idx on public.skill_areas (org_id, area_id);

alter table public.skill_areas enable row level security;
drop policy if exists skill_areas_org_isolation on public.skill_areas;
create policy skill_areas_org_isolation on public.skill_areas for all
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

-- Backfill from skills.areas jsonb. Unmapped legacy keys (gtm/records/signals — coarse,
-- circle/cross-level) produce no row; the jsonb is retained so they can be tagged later.
insert into public.skill_areas (org_id, skill_id, area_id)
select distinct s.org_id, s.id, a.id
from public.skills s
cross join lateral jsonb_array_elements_text(s.areas) as legacy(key)
join (values
  -- identity (already-canonical keys pass through)
  ('product_truth','product_truth'), ('capabilities','capabilities'), ('technical','technical'),
  ('strategy','strategy'), ('build_ship','build_ship'), ('positioning','positioning'),
  ('messaging','messaging'), ('audience','audience'), ('motion','motion'),
  ('competitive','competitive'), ('demand','demand'), ('enablement','enablement'),
  ('lifecycle_pql','lifecycle_pql'),
  -- legacy aliases -> canonical
  ('product','product_truth'), ('products','product_truth'),
  ('roadmap','build_ship'), ('initiatives','build_ship'), ('frontier','build_ship'),
  ('content','demand'), ('campaigns','demand'), ('market','audience')
) as m(legacy_key, canon_key) on m.legacy_key = legacy.key
join public.areas a on a.org_id = s.org_id and a.key = m.canon_key
on conflict (org_id, skill_id, area_id) do nothing;
