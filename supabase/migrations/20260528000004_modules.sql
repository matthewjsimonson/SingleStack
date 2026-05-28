-- ============================================================================
-- modules — the product's modules (branches of the hub).
-- Plain English: one row per module. Each has a name, an optional description,
-- an icon, an optional status (from the client's status vocabulary), and a
-- version. A module belongs to the product hub via product_id.
-- NOTE: feature count is NOT stored here — it is computed from the features
-- table (count of features with this module_id), so it can never go stale.
-- ============================================================================

create table modules (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  created_at  timestamptz not null default now(),

  product_id  uuid not null references product_records (id) on delete cascade,
  status_id   uuid references statuses (id),

  name        text not null,
  description text,
  icon        text,
  version     text
);

comment on table modules is 'Modules belonging to the product hub. Status uses the client-editable statuses vocabulary. Feature count is derived from the features table, not stored.';

create index modules_org_id_idx on modules (org_id);
create index modules_product_id_idx on modules (product_id);
create index modules_status_id_idx on modules (status_id);

alter table modules enable row level security;

create policy modules_org_isolation on modules
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());
