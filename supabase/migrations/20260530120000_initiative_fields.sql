-- ============================================================================
-- initiative_fields — the sectioned, configurable depth of a build item.
-- Plain English: a build item (an `initiatives` row) was just title +
-- description + stage. That's too shallow to actually build from. This brings
-- the SAME pattern the Foundation uses (`record_fields`) to initiatives: every
-- structured field — hypothesis, acceptance criteria, success metric, risks —
-- is a row here (key/label/value/section/order), so a build item becomes a deep
-- Why/What/How/Proof workspace with NO hardcoded columns. Sections are data;
-- AI can draft fields (as proposals) and humans ratify, exactly like records.
--
-- Mirrors record_fields, but a field has exactly ONE parent: an initiative.
-- (Later, record_fields + initiative_fields may unify into a generic
-- entity_fields; this is additive and reversible for now.)
-- ============================================================================

create table initiative_fields (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  created_at    timestamptz not null default now(),

  initiative_id uuid not null references initiatives (id) on delete cascade,

  field_key     text not null,   -- stable key, e.g. "hypothesis", "success_metric"
  label         text not null,   -- display label, e.g. "Success metric"
  value         text,            -- the field's content (flexible text)
  section       text,            -- group label: "Why" | "What" | "How" | "Proof" (data, not enum)
  position      integer not null default 0
);

comment on table initiative_fields is 'Client/AI-defined content fields of a build item (initiative): key/label/value/section/order. Brings the record_fields depth pattern to Ship. NULL section = ungrouped.';

-- A field key is unique within its initiative.
create unique index initiative_fields_initiative_key_uniq
  on initiative_fields (initiative_id, field_key);

create index initiative_fields_org_id_idx on initiative_fields (org_id);
create index initiative_fields_initiative_id_idx on initiative_fields (initiative_id);
create index initiative_fields_section_idx on initiative_fields (section);

alter table initiative_fields enable row level security;

create policy initiative_fields_org_isolation on initiative_fields
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());
