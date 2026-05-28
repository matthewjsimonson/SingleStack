-- ============================================================================
-- record_fields — the client-defined content fields of a record.
-- Plain English: this is what makes the schema domain-agnostic. Instead of
-- hardcoding columns like "what_it_is" or "positioning", every descriptive
-- field on a record is a row here: a key, a label, a value, and a display
-- order. A client can add any fields they need with no migration. Each field
-- belongs to exactly one parent — a product record OR a GTM record — using two
-- nullable foreign keys plus a CHECK that exactly one is set (the same pattern
-- the ratifications table uses), which keeps real foreign-key integrity.
-- ============================================================================

create table record_fields (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  created_at    timestamptz not null default now(),

  -- Parent: exactly one of these is set (enforced by the CHECK below).
  product_id    uuid references product_records (id) on delete cascade,
  gtm_record_id uuid references gtm_records (id) on delete cascade,

  field_key     text not null,   -- stable key, e.g. "what_it_is", "positioning"
  label         text not null,   -- display label, e.g. "What it is"
  value         text,            -- the field's content (flexible text)
  position      integer not null default 0,

  constraint record_fields_one_parent check (
    (product_id is not null)::int + (gtm_record_id is not null)::int = 1
  )
);

comment on table record_fields is 'Client-defined content fields of a record (key/label/value/order). Makes records fully configurable. Each field belongs to exactly one product_record or gtm_record.';
comment on constraint record_fields_one_parent on record_fields is 'Each field points at exactly one parent: a product_record OR a gtm_record.';

-- A field key is unique within its parent record.
create unique index record_fields_product_key_uniq
  on record_fields (product_id, field_key) where product_id is not null;
create unique index record_fields_gtm_key_uniq
  on record_fields (gtm_record_id, field_key) where gtm_record_id is not null;

create index record_fields_org_id_idx on record_fields (org_id);
create index record_fields_product_id_idx on record_fields (product_id);
create index record_fields_gtm_record_id_idx on record_fields (gtm_record_id);

alter table record_fields enable row level security;

create policy record_fields_org_isolation on record_fields
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());
