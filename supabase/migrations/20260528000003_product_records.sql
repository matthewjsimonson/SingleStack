-- ============================================================================
-- product_records — THE HUB. One row = the product.
-- Plain English: this is the canonical record everything traces back to. It
-- holds only a minimal, domain-agnostic spine: a name and an optional status.
-- All descriptive content ("what it is", "who it's for", strategic intent,
-- category, version, owner, anything the client wants) lives as rows in
-- record_fields, so a client can define whatever fields they need without a
-- schema change. Modules, GTM records, and (through them) signals point here.
-- ============================================================================

create table product_records (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  created_at timestamptz not null default now(),

  name       text not null,                          -- the product's name
  status_id  uuid references statuses (id)           -- optional status (client vocab)
);

comment on table product_records is 'The product hub. Minimal spine (name + status); all descriptive content lives in record_fields so it is fully client-configurable.';

create index product_records_org_id_idx on product_records (org_id);
create index product_records_status_id_idx on product_records (status_id);

alter table product_records enable row level security;

create policy product_records_org_isolation on product_records
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());
