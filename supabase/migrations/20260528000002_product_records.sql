-- ============================================================================
-- product_records — THE HUB. One row = the product (GrowthStudio today).
-- Plain English: holds the canonical "what's true today" about the product:
-- what it is, who it's for, strategic intent, category, GA status, version,
-- and owner. Modules, GTM records, and (through them) signals all trace back
-- to this row.
-- ============================================================================

create table product_records (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null,
  created_at       timestamptz not null default now(),

  name             text not null,            -- e.g. "GrowthStudio"
  what_it_is       text,                     -- "What it is" cornerstone field
  who_its_for      text,                     -- "Who it's for"
  strategic_intent text,                     -- "Strategic intent"
  category         text,                     -- "Category"
  ga_status        release_status not null default 'GA',
  version          text,                     -- e.g. "v4.3"
  owner            text                      -- e.g. "M. Schmidt"
);

comment on table product_records is 'The product hub — one canonical record per product. Everything in Foundation traces back here.';
comment on column product_records.ga_status is 'Overall release status of the product (GA / BETA / EA).';

create index product_records_org_id_idx on product_records (org_id);

alter table product_records enable row level security;

create policy product_records_org_isolation on product_records
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());
