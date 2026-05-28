-- ============================================================================
-- sources — the catalog of provenance sources.
-- Plain English: one row per place a signal can come from. Each is just an icon
-- and a label, defined by the client (nothing is hardcoded). Signals link to
-- these many-to-many, so we can ask "every signal influenced by source X".
-- This is its own table, NOT a text field on a signal.
-- ============================================================================

create table sources (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  created_at timestamptz not null default now(),

  icon       text not null,   -- icon identifier (e.g. icon name / key)
  label      text not null    -- human label shown in the UI, defined by client
);

comment on table sources is 'Client-defined catalog of provenance sources (icon + label). Signals link here many-to-many via signal_sources.';

create index sources_org_id_idx on sources (org_id);

alter table sources enable row level security;

create policy sources_org_isolation on sources
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());
