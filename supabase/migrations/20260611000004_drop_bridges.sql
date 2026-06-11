-- ============================================================================
-- Retire bridges (the drop_plays precedent, applied again).
--
-- Bridges were a bespoke single-purpose engine: a dedicated function
-- (propose-bridges) pairing one product theme with one gtm theme into a
-- cross-lens insight. That job now belongs to the cornerstone + child skills
-- model — an agent with a cross-lens skill on a workflow finds the same
-- patterns and lands them through the standard gates (themes / proposals /
-- intel_updates), where they compound with everything else instead of living
-- in a side table. The Bridges UI, the propose-bridges function, and the map's
-- bridge edges were removed in the same change.
--
-- Order matters:
--   1. PRESERVE the human-confirmed intelligence: active bridges' insight +
--      recommendation are appended to both legs' context on signal_themes
--      (intelligence is never destroyed; the synthesis survives on the
--      entities that remain).
--   2. FIX the runtime landmine: demote_cross_product_on_product_delete() is a
--      persisted trigger function that updates bridges — replaced without the
--      bridges lines BEFORE the drop, or deleting a product would error.
--   3. DROP the dependent view + function + table.
-- ============================================================================

-- ---- 1. preserve active bridges' synthesis on their theme legs --------------
update signal_themes t
set context = coalesce(t.context || E'\n\n', '')
  || 'Bridged insight (retired bridges feature, ' || to_char(now(), 'YYYY-MM-DD') || '): '
  || b.title
  || coalesce(' — ' || b.insight, '')
  || coalesce(E'\nRecommendation: ' || b.recommendation, '')
from bridges b
where b.state = 'active'
  and t.id in (b.product_theme_id, b.gtm_theme_id);

-- ---- 2. product-delete demote trigger, minus bridges -------------------------
create or replace function public.demote_cross_product_on_product_delete()
returns trigger language plpgsql as $$
begin
  -- primary deleted → demote to company-wide (product_id set NULL by FK; clear arrays here)
  update signal_themes set product_id = null, co_product_ids = '{}' where product_id = old.id;
  update objectives    set product_id = null, co_product_ids = '{}' where product_id = old.id;
  update initiatives   set product_id = null, co_product_ids = '{}' where product_id = old.id;
  update decisions     set co_product_ids = '{}' where product_id = old.id; -- product_id+scope handled by demote_product_decisions

  -- secondary leg pruned (disjoint from the above: CHECK forbids primary ∈ co)
  update signal_themes set co_product_ids = array_remove(co_product_ids, old.id) where old.id = any(co_product_ids);
  update objectives    set co_product_ids = array_remove(co_product_ids, old.id) where old.id = any(co_product_ids);
  update initiatives   set co_product_ids = array_remove(co_product_ids, old.id) where old.id = any(co_product_ids);
  update decisions     set co_product_ids = array_remove(co_product_ids, old.id) where old.id = any(co_product_ids);
  update campaigns     set co_product_ids = array_remove(co_product_ids, old.id) where old.id = any(co_product_ids);
  update gtm_records   set co_product_ids = array_remove(co_product_ids, old.id) where old.id = any(co_product_ids);
  return old;
end $$;

comment on function public.demote_cross_product_on_product_delete() is 'On product delete: demote entities where it was the primary line to company-wide, and prune it from any co_product_ids set where it was a secondary (cross-sell) leg. (bridges removed 20260611000004 — feature retired in favor of agent skills.)';

-- ---- 3. drop the dependents, then the table ----------------------------------
drop view if exists bridge_strength;
drop function if exists public.bridge_confidence(uuid);
drop table if exists bridges cascade;
