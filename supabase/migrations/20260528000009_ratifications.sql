-- ============================================================================
-- ratifications — the ratification trail behind every content field.
-- Plain English: one row per ratification event. It records which record and
-- which field was ratified, who ratified it (a human like "M. Schmidt" or an
-- agent name as text for now), when, and whether the value is "drafted" or
-- "ratified". The UI's aggregate stats ("42 ratifications · 81% accept rate")
-- are COMPUTED from these rows, not stored anywhere.
-- This is its own table — never collapsed into a column on the parent record.
--
-- A ratification targets exactly one parent: either a product_records row or a
-- gtm_records row. We use two nullable foreign keys plus a CHECK that exactly
-- one is set — this keeps real foreign-key integrity (vs a loose type+id pair).
-- ============================================================================

create table ratifications (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  created_at    timestamptz not null default now(),

  -- Target: exactly one of these is set (enforced by the CHECK below).
  product_id    uuid references product_records (id) on delete cascade,
  gtm_record_id uuid references gtm_records (id) on delete cascade,

  field_key     text not null,                       -- e.g. "what_it_is", "positioning"
  ratifier      text not null,                       -- human name or agent name (text for now)
  status        ratification_status not null default 'drafted',
  ratified_at   timestamptz,                         -- when ratified (null while drafted)

  constraint ratifications_one_target check (
    (product_id is not null)::int + (gtm_record_id is not null)::int = 1
  )
);

comment on table ratifications is 'Per-field ratification trail. Aggregate stats are computed from these rows, never stored. Targets exactly one parent record.';
comment on constraint ratifications_one_target on ratifications is 'Each ratification points at exactly one parent: a product_record OR a gtm_record.';

create index ratifications_org_id_idx on ratifications (org_id);
create index ratifications_product_id_idx on ratifications (product_id);
create index ratifications_gtm_record_id_idx on ratifications (gtm_record_id);

alter table ratifications enable row level security;

create policy ratifications_org_isolation on ratifications
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());
