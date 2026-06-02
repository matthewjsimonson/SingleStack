-- ============================================================================
-- initiatives.lifecycle — where an initiative sits in the product-led-growth
-- motion (distinct from `stage`, which is just backlog/active/done status).
-- The PLG lifecycle: Signal (sourced from intel) -> Plan (roadmap + campaign) ->
-- Build (build/ship) -> Launch (go-to-market) -> Live (shipped, measuring,
-- which loops back into signals). This drives the homepage Initiatives board.
-- ============================================================================
alter table initiatives add column if not exists lifecycle text not null default 'signal';
alter table initiatives drop constraint if exists initiatives_lifecycle_shape;
alter table initiatives add constraint initiatives_lifecycle_shape
  check (lifecycle in ('signal', 'plan', 'build', 'launch', 'live'));

comment on column initiatives.lifecycle is 'Position in the PLG lifecycle: signal | plan | build | launch | live. The Initiatives board columns.';
create index if not exists initiatives_lifecycle_idx on initiatives (lifecycle);
