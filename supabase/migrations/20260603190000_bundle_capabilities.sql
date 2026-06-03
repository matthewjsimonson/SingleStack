-- ============================================================================
-- bundle_capabilities — let an investment thesis (strategy_bundle) cite a
-- competitive capability GAP as evidence, alongside its signals.
--
-- Product Strategy decides what to build/enhance from ALL intelligence: signals
-- (internal/external/market/frontier) AND the competitive matrix. Signals attach
-- to a bundle via signals.bundle_id; a capability gap (a `capabilities` row
-- where a rival outscores us) attaches here. On ship-to-Build the gap travels
-- into the Build Item's Technical Scope as an entity_ref context link.
-- ============================================================================

create table bundle_capabilities (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  created_at    timestamptz not null default now(),
  bundle_id     uuid not null references strategy_bundles (id) on delete cascade,
  capability_id uuid not null references capabilities (id) on delete cascade,
  note          text,
  unique (bundle_id, capability_id)
);

comment on table bundle_capabilities is 'Competitive capability gaps cited as evidence on an investment thesis (strategy_bundle), alongside its signals.';
create index bundle_capabilities_bundle_idx on bundle_capabilities (bundle_id);
create index bundle_capabilities_org_idx on bundle_capabilities (org_id);

alter table bundle_capabilities enable row level security;
create policy bundle_capabilities_org_isolation on bundle_capabilities for all
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());
