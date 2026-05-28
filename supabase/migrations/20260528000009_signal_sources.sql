-- ============================================================================
-- signal_sources — the many-to-many join between signals and sources.
-- Plain English: a signal can be influenced by many sources, and a source can
-- influence many signals. This join table records each (signal, source) link
-- as one row — which is what lets us query "every signal influenced by source
-- X". Provenance is a real relationship here, never a text field.
-- ============================================================================

create table signal_sources (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  created_at  timestamptz not null default now(),

  signal_id   uuid not null references signals (id) on delete cascade,
  source_id   uuid not null references sources (id) on delete cascade,

  unique (signal_id, source_id)
);

comment on table signal_sources is 'Join table linking signals to sources many-to-many. Enables "every signal influenced by source X".';

create index signal_sources_org_id_idx on signal_sources (org_id);
create index signal_sources_signal_id_idx on signal_sources (signal_id);
create index signal_sources_source_id_idx on signal_sources (source_id);

alter table signal_sources enable row level security;

create policy signal_sources_org_isolation on signal_sources
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());
