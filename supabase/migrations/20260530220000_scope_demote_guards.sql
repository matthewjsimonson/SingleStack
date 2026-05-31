-- ============================================================================
-- Scope-demotion guards — finish the job started for signals.
-- Plain English: `decisions` (like signals) carry a scope enum coupled to
-- product_id / gtm_record_id by a CHECK constraint:
--   scope='product' REQUIRES product_id;  scope='gtm' REQUIRES gtm_record_id.
-- Both FKs are ON DELETE SET NULL. So deleting a product (or gtm record) tries
-- to null the id while leaving scope unchanged → violates decisions_scope_shape
-- and BLOCKS the delete entirely. (Verified on real Postgres.)
--
-- Fix mirrors demote_product_signals: BEFORE DELETE, demote the affected
-- decisions to scope='org' (and clear both scoped ids) so the parent delete
-- succeeds and the decision survives as a company-wide decision.
-- ============================================================================

-- ---- product delete → demote product-scoped decisions ----------------------
create or replace function public.demote_product_decisions()
returns trigger language plpgsql as $$
begin
  update decisions
     set scope = 'org', product_id = null
   where product_id = old.id and scope = 'product';
  return old;
end $$;

drop trigger if exists demote_decisions_before_product_delete on product_records;
create trigger demote_decisions_before_product_delete
  before delete on product_records
  for each row execute function public.demote_product_decisions();

comment on function public.demote_product_decisions() is 'On product delete, demote its product-scoped decisions to company-wide (scope=org, product_id=null together) so the delete is not blocked by decisions_scope_shape and the decision survives.';

-- ---- gtm record delete → demote gtm-scoped decisions -----------------------
create or replace function public.demote_gtm_decisions()
returns trigger language plpgsql as $$
begin
  update decisions
     set scope = 'org', gtm_record_id = null
   where gtm_record_id = old.id and scope = 'gtm';
  return old;
end $$;

drop trigger if exists demote_decisions_before_gtm_delete on gtm_records;
create trigger demote_decisions_before_gtm_delete
  before delete on gtm_records
  for each row execute function public.demote_gtm_decisions();

comment on function public.demote_gtm_decisions() is 'On gtm_record delete, demote its gtm-scoped decisions to company-wide so the delete is not blocked by decisions_scope_shape.';

-- Note on signals + gtm_records: signals.gtm_record_id is ON DELETE CASCADE by
-- design (a gtm-scoped signal lives and dies with its record), so no demotion
-- there — that asymmetry with product signals is intentional.

-- ---- expose product scoping on the bridge_strength view --------------------
-- The Signals UI filters by product; bridges need their product_id (and each
-- leg's product) so a product-scoped view hides cross-product bridges correctly.
-- DROP first: adding a column mid-list changes ordinals, which CREATE OR REPLACE
-- forbids.
drop view if exists bridge_strength;
create view bridge_strength as
  select
    b.id as bridge_id,
    b.title, b.insight, b.recommendation, b.state,
    b.product_id,
    b.product_theme_id, pt.title as product_theme_title, pt.product_id as product_theme_product,
      public.theme_confidence(b.product_theme_id) as product_conf,
    b.gtm_theme_id, gt.title as gtm_theme_title, gt.product_id as gtm_theme_product,
      public.theme_confidence(b.gtm_theme_id) as gtm_conf,
    public.bridge_confidence(b.id) as bridge_conf
  from bridges b
  left join signal_themes pt on pt.id = b.product_theme_id
  left join signal_themes gt on gt.id = b.gtm_theme_id;

-- ---- expose product_id on theme_misses so the review surface can scope it ---
drop view if exists theme_misses;
create view theme_misses as
  with faded as (
    select te.theme_id, max(te.created_at) as faded_at
      from theme_events te
     where te.kind = 'state_changed'
       and (te.detail->>'to') in ('fading','dormant')
     group by te.theme_id
  )
  select
    t.id as theme_id,
    t.title,
    t.category,
    t.state,
    t.product_id,
    f.faded_at,
    count(*) filter (where ts.stance = 'supports' and ts.added_at > f.faded_at) as new_support_signals,
    count(distinct coalesce(s.source_id::text, s.origin, s.id::text))
      filter (where ts.stance = 'supports' and ts.added_at > f.faded_at)        as new_support_sources,
    max(ts.added_at) filter (where ts.added_at > f.faded_at)                    as latest_new_evidence
  from faded f
  join signal_themes t on t.id = f.theme_id
  join theme_signals ts on ts.theme_id = t.id
  left join signals s on s.id = ts.signal_id
  where t.state in ('fading','dormant')
  group by t.id, t.title, t.category, t.state, t.product_id, f.faded_at
  having count(*) filter (where ts.stance = 'supports' and ts.added_at > f.faded_at) > 0;
