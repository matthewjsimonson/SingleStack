-- ============================================================================
-- Cross-sell & scope vocabulary — Phase 1: additive columns, no behavior change.
-- Design: docs/architecture/cross-sell-and-scope.md (Option A: array + scope).
--
-- The single product_id FK cannot express "Product A AND Product B, together"
-- (cross-sell / co-sell / bundles), and "together" was only approximable as
-- product_id = NULL — overloaded with "company-wide". This migration adds the
-- additive primitive `co_product_ids uuid[]` (the ADDITIONAL lines an entity
-- spans, beyond its primary product_id). The three scopes then derive cleanly,
-- WITHOUT touching any existing scope/CHECK constraint:
--
--   product_id NULL                          → ORG (deliberately company-wide)
--   product_id set, co_product_ids = '{}'    → PRODUCT (one line)            [unchanged]
--   product_id set, co_product_ids = {B,…}   → CROSS_PRODUCT (a named set)   [new]
--
-- This disambiguates NULL: it now strictly means company-wide. A specific
-- multi-line set is product_id (primary) + co_product_ids (the rest). Existing
-- single-product rows are untouched (empty array default). Nothing yet *uses*
-- cross_product — that's Phases 2–4 (context UX, authoring, synthesis).
-- ============================================================================

-- ---- 1. The additive primitive on entities that can "run together" ---------
-- (signals intentionally excluded: a raw observation is about one thing;
--  cross-product emerges at the theme/decision/initiative/motion layer.)

alter table signal_themes add column if not exists co_product_ids uuid[] not null default '{}';
alter table objectives    add column if not exists co_product_ids uuid[] not null default '{}';
alter table bridges       add column if not exists co_product_ids uuid[] not null default '{}';
alter table initiatives   add column if not exists co_product_ids uuid[] not null default '{}';
alter table decisions     add column if not exists co_product_ids uuid[] not null default '{}';
alter table campaigns     add column if not exists co_product_ids uuid[] not null default '{}';

comment on column initiatives.co_product_ids is 'Additional product lines this entity spans, beyond the primary product_id. Empty = single-line (or company-wide if product_id NULL). Non-empty + primary set = cross_product (cross-sell/co-sell). See docs/architecture/cross-sell-and-scope.md.';
comment on column signal_themes.co_product_ids is 'Additional product lines this theme spans beyond product_id. Non-empty + primary = cross-product theme (e.g. a need shared across two lines).';
comment on column decisions.co_product_ids is 'Additional product lines a cross-sell/co-sell decision spans beyond its primary product_id.';

-- Invariant for entities that carry a primary product_id: you cannot span
-- "extra" lines without a primary, and the primary must not repeat in the set.
-- (Empty array always passes — existing rows are unaffected.)
do $$
declare t text;
begin
  foreach t in array array['signal_themes','objectives','bridges','initiatives','decisions'] loop
    execute format('alter table %I drop constraint if exists %I', t, t||'_co_products_shape');
    execute format($f$alter table %I add constraint %I check (
      cardinality(co_product_ids) = 0
      or (product_id is not null and not (product_id = any(co_product_ids)))
    )$f$, t, t||'_co_products_shape');
  end loop;
end $$;

-- campaigns derive their primary line via gtm_record_id (no own product_id), so
-- co_product_ids stands alone there — no primary-shape check.

-- ---- 2. GTM motions that span lines (additive; primary stays NOT NULL) ------
alter table gtm_records add column if not exists co_product_ids uuid[] not null default '{}';
alter table gtm_records add column if not exists motion_type text not null default 'single';
alter table gtm_records drop constraint if exists gtm_records_motion_type_chk;
alter table gtm_records add constraint gtm_records_motion_type_chk check (motion_type in ('single','cross_sell','co_sell'));
alter table gtm_records drop constraint if exists gtm_records_co_products_shape;
alter table gtm_records add constraint gtm_records_co_products_shape check (not (product_id = any(co_product_ids)));
comment on column gtm_records.motion_type is 'single = markets its one product; cross_sell/co_sell = a motion deliberately spanning the primary product_id + co_product_ids. The primary stays required (NOT NULL); co_product_ids names the additional lines.';

-- ---- 3. Bridges: label the cross-product ones (vs product-lens↔GTM-lens) ----
alter table bridges add column if not exists span text not null default 'product_gtm';
alter table bridges drop constraint if exists bridges_span_chk;
alter table bridges add constraint bridges_span_chk check (span in ('product_gtm','cross_product'));
comment on column bridges.span is 'product_gtm = the existing Product-lens↔GTM-lens bridge; cross_product = a Product↔Product link (the cross-sell insight home). Existing bridges default to product_gtm.';

-- ---- 4. Query helpers + indexes --------------------------------------------
-- Standard predicate for "does this entity touch product :target?" — covers the
-- primary product_id and the co_product_ids set. Org-wide rows (NULL primary)
-- return false here; callers OR in `product_id is null` to also show company-wide.
create or replace function public.spans_product(p_primary uuid, p_co uuid[], p_target uuid)
returns boolean language sql immutable as $$
  select p_target is not null
     and (p_primary is not distinct from p_target or p_target = any(coalesce(p_co, '{}')))
$$;
comment on function public.spans_product(uuid, uuid[], uuid) is 'True if an entity with primary p_primary and additional lines p_co touches product p_target. The canonical "show me everything for line A (incl. cross-sell)" predicate.';

-- GIN indexes so `co_product_ids @> ARRAY[:id]` / `:id = any(co_product_ids)` is fast.
create index if not exists signal_themes_co_products_idx on signal_themes using gin (co_product_ids);
create index if not exists objectives_co_products_idx    on objectives    using gin (co_product_ids);
create index if not exists bridges_co_products_idx       on bridges       using gin (co_product_ids);
create index if not exists initiatives_co_products_idx   on initiatives   using gin (co_product_ids);
create index if not exists decisions_co_products_idx     on decisions     using gin (co_product_ids);
create index if not exists campaigns_co_products_idx     on campaigns     using gin (co_product_ids);
create index if not exists gtm_records_co_products_idx   on gtm_records   using gin (co_product_ids);

-- ---- 5. Demote-not-destroy on product delete (array integrity) -------------
-- co_product_ids elements are not FKs (the known Option-A trade-off), so deleting
-- a product must clean up both roles, BEFORE the row's FK actions fire:
--   • where the deleted product was the PRIMARY (product_id = old.id): demote the
--     entity to company-wide (product_id→NULL, co→'{}') — survives, never destroyed,
--     and stays CHECK-valid. (decisions also has scope, handled by its existing
--     demote_product_decisions trigger; here we just clear its array.)
--   • where it was a SECONDARY leg (old.id ∈ co_product_ids): prune it from the set
--     (the cross-sell entity keeps its own primary, loses one leg).
create or replace function public.demote_cross_product_on_product_delete()
returns trigger language plpgsql as $$
begin
  -- primary deleted → demote to company-wide (product_id set NULL by FK; clear arrays here)
  update signal_themes set product_id = null, co_product_ids = '{}' where product_id = old.id;
  update objectives    set product_id = null, co_product_ids = '{}' where product_id = old.id;
  update bridges       set product_id = null, co_product_ids = '{}' where product_id = old.id;
  update initiatives   set product_id = null, co_product_ids = '{}' where product_id = old.id;
  update decisions     set co_product_ids = '{}' where product_id = old.id; -- product_id+scope handled by demote_product_decisions

  -- secondary leg pruned (disjoint from the above: CHECK forbids primary ∈ co)
  update signal_themes set co_product_ids = array_remove(co_product_ids, old.id) where old.id = any(co_product_ids);
  update objectives    set co_product_ids = array_remove(co_product_ids, old.id) where old.id = any(co_product_ids);
  update bridges       set co_product_ids = array_remove(co_product_ids, old.id) where old.id = any(co_product_ids);
  update initiatives   set co_product_ids = array_remove(co_product_ids, old.id) where old.id = any(co_product_ids);
  update decisions     set co_product_ids = array_remove(co_product_ids, old.id) where old.id = any(co_product_ids);
  update campaigns     set co_product_ids = array_remove(co_product_ids, old.id) where old.id = any(co_product_ids);
  update gtm_records   set co_product_ids = array_remove(co_product_ids, old.id) where old.id = any(co_product_ids);
  return old;
end $$;

drop trigger if exists demote_cross_product_before_product_delete on product_records;
create trigger demote_cross_product_before_product_delete
  before delete on product_records
  for each row execute function public.demote_cross_product_on_product_delete();

comment on function public.demote_cross_product_on_product_delete() is 'On product delete: demote entities where it was the primary line to company-wide, and prune it from any co_product_ids set where it was a secondary (cross-sell) leg. Keeps array integrity and CHECK validity; intelligence is never destroyed by removing a product.';
