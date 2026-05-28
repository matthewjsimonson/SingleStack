-- ============================================================================
-- ratifications — the ratification trail behind every content field.
-- Plain English: one row per ratification event. Because content fields are now
-- rows in record_fields, a ratification points straight at the exact field it
-- concerns via record_field_id (a real foreign key). It records who ratified it
-- (a human like "M. Schmidt" or an agent name as text for now), when, and
-- whether the value is "drafted" or "ratified". The UI's aggregate stats
-- ("42 ratifications · 81% accept rate") are COMPUTED from these rows, not
-- stored anywhere. This is its own table — never a column on the parent record.
-- ============================================================================

create table ratifications (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  created_at      timestamptz not null default now(),

  record_field_id uuid not null references record_fields (id) on delete cascade,

  ratifier        text not null,                          -- human name or agent name (text for now)
  status          ratification_status not null default 'drafted',
  ratified_at     timestamptz                             -- when ratified (null while drafted)
);

comment on table ratifications is 'Per-field ratification trail, keyed by a real FK to record_fields. Aggregate stats are computed from these rows, never stored.';

create index ratifications_org_id_idx on ratifications (org_id);
create index ratifications_record_field_id_idx on ratifications (record_field_id);

alter table ratifications enable row level security;

create policy ratifications_org_isolation on ratifications
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());
