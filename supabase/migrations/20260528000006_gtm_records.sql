-- ============================================================================
-- gtm_records — GTM records / messaging branches that read from the hub.
-- Plain English: one row per messaging branch. Like the product hub, this keeps
-- only a minimal spine: a name and an optional status. All descriptive content
-- (the overview statement, how-it-works, why, who-it's-read-by, and any other
-- field) lives as rows in record_fields, so it is fully client-configurable.
-- A GTM record belongs to the product hub via product_id. Its tabs and signals
-- live in their own tables.
-- ============================================================================

create table gtm_records (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  created_at timestamptz not null default now(),

  product_id uuid not null references product_records (id) on delete cascade,
  status_id  uuid references statuses (id),

  name       text not null   -- the branch's name, e.g. "Product messaging · Hero"
);

comment on table gtm_records is 'GTM messaging branches that read from the product hub. Minimal spine (name + status); overview and other content live in record_fields. Tabs and signals are separate tables.';

create index gtm_records_org_id_idx on gtm_records (org_id);
create index gtm_records_product_id_idx on gtm_records (product_id);
create index gtm_records_status_id_idx on gtm_records (status_id);

alter table gtm_records enable row level security;

create policy gtm_records_org_isolation on gtm_records
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());
