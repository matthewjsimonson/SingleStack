-- ============================================================================
-- Battlecard corrections: absolute HITL, audience split, gap-addressed signals.
-- 1. HITL is ABSOLUTE for battlecards (enforced in the functions): signals and
--    proposed updates are living; the card only changes by human hand or
--    human-ratified proposal. (Humans can always direct-edit — narrative
--    positioning isn't signal-derived.)
-- 2. audience — the field sees the MASSAGED battlecard; GTM/product see the
--    raw truth. 'internal' = raw truth (default for agent-proposed items);
--    'field' = published to sellers (SellDesk shows only these). Existing
--    human-entered cards stay 'field' (they were written for sellers).
-- 3. Gap-addressed loop: when a product-gap THEME is pushed into an epic
--    (bundle_id set = it's being worked), emit an internal product signal —
--    carrying the theme's competitor — so battlecard review accounts for it.
--    Win/loss signals from CRM/calls already flow in via the Feed (origin
--    internal, tagged to the competitor).
-- ============================================================================

alter table battlecard_items add column if not exists audience text not null default 'field';
alter table battlecard_items drop constraint if exists battlecard_items_audience_chk;
alter table battlecard_items add constraint battlecard_items_audience_chk check (audience in ('internal','field'));
comment on column battlecard_items.audience is 'internal = raw truth (GTM/product teams); field = published, massaged version sellers see in the Sell desk. Agent-proposed items land internal; a human publishes.';
create index if not exists battlecard_items_audience_idx on battlecard_items (audience);

create or replace function public.emit_gap_addressed_signal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Theme just entered an epic: the gap is being worked. One internal signal,
  -- competitor-tagged when the theme is, so battlecard review sees it.
  if new.bundle_id is not null and (old.bundle_id is distinct from new.bundle_id) then
    insert into signals (org_id, scope, origin, category, title, why, observed_at, product_id, competitor_id, conf_label, conf_level, metadata)
    values (
      new.org_id, 'org', 'internal', coalesce(new.category, 'product'),
      'Being addressed: ' || new.title,
      'This ' || coalesce(new.category, 'product') || ' gap was pushed into an epic — in flight. Battlecards citing it should be reviewed.',
      now(), new.product_id, new.competitor_id, 'High', 0.9,
      jsonb_build_object('domain', case when new.competitor_id is not null then 'competitive' else 'product' end, 'competitor_id', new.competitor_id, 'channel', 'Strategy — epic')
    );
  end if;
  return new;
end
$$;

drop trigger if exists signal_themes_gap_addressed on signal_themes;
create trigger signal_themes_gap_addressed
  after update of bundle_id on signal_themes
  for each row execute function public.emit_gap_addressed_signal();
