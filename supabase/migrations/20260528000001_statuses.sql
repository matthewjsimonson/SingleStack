-- ============================================================================
-- statuses — a client-editable vocabulary of status values.
-- Plain English: instead of hardcoding "GA / BETA / EA" into the database,
-- each org defines its own status values here as rows. A "kind" lets one org
-- keep more than one vocabulary (e.g. a "release" set for products/modules and,
-- later, other sets). Products, modules, and features point at a row here.
-- ============================================================================

create table statuses (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  created_at timestamptz not null default now(),

  kind       text not null default 'release', -- vocabulary group, e.g. "release"
  key        text not null,                    -- short code, e.g. "GA"
  label      text not null,                    -- display label, e.g. "Generally Available"
  position   integer not null default 0,       -- display order within the kind

  unique (org_id, kind, key)
);

comment on table statuses is 'Client-editable status vocabulary. Replaces a hardcoded enum so any org can define its own status values without a migration.';
comment on column statuses.kind is 'Groups values into a vocabulary (e.g. "release"), so one org can maintain several status sets.';

create index statuses_org_id_idx on statuses (org_id);

alter table statuses enable row level security;

create policy statuses_org_isolation on statuses
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());
