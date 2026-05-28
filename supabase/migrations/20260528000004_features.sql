-- ============================================================================
-- features — features that belong to a module.
-- Plain English: one row per feature (e.g. "Pursuit alerts"). A feature
-- belongs to exactly one module via module_id. Counting these per module is
-- how a module's "feature count" is produced.
-- ============================================================================

create table features (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  created_at  timestamptz not null default now(),

  module_id   uuid not null references modules (id) on delete cascade,

  name        text not null,
  description text,
  status      release_status                -- optional per-feature status
);

comment on table features is 'Features belonging to a module. Counting rows per module_id yields the module feature count.';

create index features_org_id_idx on features (org_id);
create index features_module_id_idx on features (module_id);

alter table features enable row level security;

create policy features_org_isolation on features
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());
