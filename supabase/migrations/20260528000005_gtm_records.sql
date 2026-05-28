-- ============================================================================
-- gtm_records — GTM records / messaging branches that read from the hub.
-- Plain English: one row per messaging branch (e.g. "Product messaging · Hero",
-- "Technical messaging · Architecture", "Pricing · Enterprise tier"). Each has
-- an overview (a statement, how-it-works, and why), and a "read by" note for
-- the audience. A GTM record belongs to the product hub via product_id. Its
-- tabs and signals live in their own tables.
-- ============================================================================

create table gtm_records (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  created_at    timestamptz not null default now(),

  product_id    uuid not null references product_records (id) on delete cascade,

  label         text not null,   -- e.g. "Product messaging · Hero"
  statement     text,            -- overview: the headline statement
  how_it_works  text,            -- overview: how it works
  why           text,            -- overview: why it matters
  read_by       text             -- who this branch is read by
);

comment on table gtm_records is 'GTM messaging branches that read from the product hub. Overview lives here; tabs and signals are separate tables.';

create index gtm_records_org_id_idx on gtm_records (org_id);
create index gtm_records_product_id_idx on gtm_records (product_id);

alter table gtm_records enable row level security;

create policy gtm_records_org_isolation on gtm_records
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());
