-- ============================================================================
-- Product Strategy funnel — the front of the funnel, upstream of Build.
--
-- Plain English: signals (intel) shouldn't jump straight into the build
-- workflow. They get TRIAGED first: staged → verified → bundled → promoted.
-- A human verifies a signal is real, bundles related verified signals into a
-- candidate, and then makes the explicit CHOICE to ship that bundle into the
-- Build workflow — which spawns a Build Item (initiative) at Plan. "If it's in
-- Ship, it's been approved" — this is where that approval happens.
--
--   signal.strategy_state:  staged → verified → bundled → promoted
--   strategy_bundles:        a group of verified signals = a candidate Build Item
--   shipping a bundle:       spawns an initiative, links its signals, flips state
-- ============================================================================

-- 1. Funnel position on a signal.
alter table signals add column if not exists strategy_state text not null default 'staged';
alter table signals drop constraint if exists signals_strategy_state_shape;
alter table signals add constraint signals_strategy_state_shape
  check (strategy_state in ('staged', 'verified', 'bundled', 'promoted'));
alter table signals add column if not exists verified_at timestamptz;
comment on column signals.strategy_state is 'Product Strategy funnel position: staged | verified | bundled | promoted.';
create index if not exists signals_strategy_state_idx on signals (org_id, strategy_state);

-- 2. A bundle of verified signals — a candidate Build Item.
create table strategy_bundles (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  created_at    timestamptz not null default now(),
  title         text not null,
  rationale     text,
  state         text not null default 'open',
  initiative_id uuid references initiatives (id) on delete set null,
  promoted_at   timestamptz,
  constraint strategy_bundles_state_shape check (state in ('open', 'promoted'))
);
comment on table strategy_bundles is 'A bundle of verified signals — a candidate Build Item. Shipping it spawns an initiative (initiative_id) and flips state to promoted.';
create index strategy_bundles_org_id_idx on strategy_bundles (org_id);
create index strategy_bundles_state_idx on strategy_bundles (org_id, state);

alter table strategy_bundles enable row level security;
create policy strategy_bundles_org_isolation on strategy_bundles for all
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

-- 3. A signal belongs to at most one open bundle.
alter table signals add column if not exists bundle_id uuid references strategy_bundles (id) on delete set null;
comment on column signals.bundle_id is 'The strategy bundle this signal is grouped into (Product Strategy funnel).';
create index if not exists signals_bundle_id_idx on signals (bundle_id);
