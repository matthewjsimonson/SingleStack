-- ============================================================================
-- Battlecard update loop + update alerts.
-- Plain English: battlecards aren't write-once — each card covers one aspect of
-- the landscape vs a vendor, and the evidence under it keeps moving. This adds:
--   1. battlecard_items.updated_at — when the card's CONTENT last changed; new
--      evidence after this moment is what makes a card "stale".
--   2. intel_updates kind 'battlecard_update' — the analyst's proposed REFRESH
--      of an existing card (same accept/edit/reject + rationale loop).
--   3. update_alerts — a user-set watch ("alert me when this competitor's
--      battlecard evidence moves"), surfaced on the homepage command center;
--      clicking one opens the act-here panel.
-- ============================================================================

alter table battlecard_items add column if not exists updated_at timestamptz not null default now();
comment on column battlecard_items.updated_at is 'When the card content last changed (set by app writes). Signals newer than this = the card may be stale.';

alter table intel_updates drop constraint if exists intel_updates_kind_shape;
alter table intel_updates add constraint intel_updates_kind_shape
  check (kind in ('new_theme','escalate','merge','decay','restate','set_dimension','battlecard_item','battlecard_update'));

-- A watch, not an instance: triggered state is computed live (signals newer
-- than a card's updated_at), so alerts never go stale themselves.
create table update_alerts (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  created_at    timestamptz not null default now(),

  kind          text not null default 'battlecard_refresh',
  competitor_id uuid references competitors (id) on delete cascade,  -- the watched vendor
  is_active     boolean not null default true,

  constraint update_alerts_kind_shape check (kind in ('battlecard_refresh')),
  unique (org_id, kind, competitor_id)
);

comment on table update_alerts is 'User-set update watches (e.g. battlecard_refresh per competitor). The homepage computes triggered state live: cards whose competitor has signals newer than the card''s updated_at.';

create index update_alerts_org_id_idx on update_alerts (org_id);
create index update_alerts_competitor_id_idx on update_alerts (competitor_id);

alter table update_alerts enable row level security;
create policy update_alerts_org_isolation on update_alerts
  for all using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());
