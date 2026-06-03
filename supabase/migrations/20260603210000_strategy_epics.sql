-- ============================================================================
-- Strategy epics — give a strategy_bundle the structure of a real PM EPIC: a
-- curated story for a release item, crafted from signals + gut feel and pushed
-- to Ship. (strategy_bundles stays the table; the UI frames it as an Epic.)
--
--   problem   → the why / opportunity (curated from signals or gut feel)
--   story     → the narrative: what we'd build and the outcome (the epic body)
--   notes     → brainstorm / gut-feel scratch space
--   priority  → low | medium | high
--
-- On push-to-Ship these seed the Build Item's Product Scope (problem→Why,
-- story→What), so the craft carries forward into the build workflow.
-- ============================================================================

alter table strategy_bundles add column if not exists problem  text;
alter table strategy_bundles add column if not exists story    text;
alter table strategy_bundles add column if not exists notes    text;
alter table strategy_bundles add column if not exists priority text not null default 'medium';
alter table strategy_bundles drop constraint if exists strategy_bundles_priority_shape;
alter table strategy_bundles add constraint strategy_bundles_priority_shape check (priority in ('low', 'medium', 'high'));

comment on column strategy_bundles.problem  is 'Epic: the why / opportunity.';
comment on column strategy_bundles.story    is 'Epic: the narrative — what we would build and the outcome.';
comment on column strategy_bundles.notes    is 'Epic: brainstorm / gut-feel scratch space.';
comment on column strategy_bundles.priority is 'Epic priority: low | medium | high.';
