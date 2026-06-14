-- Migration: connections_area_id  (P2 — orchestration vocabulary binding)
-- Purpose: bind agent data/tool connections to the governed areas via a real FK,
--   replacing the free-text connections.area. Backfill with the explicit, lossless
--   legacy->canonical map; the legacy `area` text is RETAINED so coarse values
--   (gtm/records/signals — circle/cross-level, no single area) are never lost and can be
--   tagged precisely later.
-- Order: runs after seed_plg_areas_wiring (areas must exist per org to resolve keys).
-- Author: SingleStack · Date: 2026-06-14

alter table connections
  add column if not exists area_id uuid references public.areas (id) on delete set null;
comment on column connections.area_id is 'Governed area this connection serves (FK to areas). Replaces the free-text `area`; coarse legacy values stay in `area` until explicitly re-tagged.';

create index if not exists connections_area_id_idx on connections (org_id, area_id);

-- Backfill area_id from the legacy free-text area, confident maps only.
update connections c
set area_id = a.id
from (values
  ('product_truth','product_truth'), ('capabilities','capabilities'), ('technical','technical'),
  ('strategy','strategy'), ('build_ship','build_ship'), ('positioning','positioning'),
  ('messaging','messaging'), ('audience','audience'), ('motion','motion'),
  ('competitive','competitive'), ('demand','demand'), ('enablement','enablement'),
  ('lifecycle_pql','lifecycle_pql'),
  ('product','product_truth'), ('products','product_truth'),
  ('roadmap','build_ship'), ('initiatives','build_ship'), ('frontier','build_ship'),
  ('content','demand'), ('campaigns','demand'), ('market','audience')
) as m(legacy_key, canon_key)
join public.areas a on a.key = m.canon_key
where c.area = m.legacy_key
  and a.org_id = c.org_id
  and c.area_id is null;
