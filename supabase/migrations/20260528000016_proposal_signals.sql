-- ============================================================================
-- proposal_signals — which signals back a proposal (the evidence chain).
-- Plain English: a proposal cites the signals that justify it, many-to-many.
-- Combined with signal_sources, this completes the provenance chain:
--   proposal  ←  signals  ←  sources
-- i.e. "why did this field change? because of these signals, from these
-- sources." That explainable chain is the product's core value.
-- ============================================================================

create table proposal_signals (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  created_at  timestamptz not null default now(),

  proposal_id uuid not null references proposals (id) on delete cascade,
  signal_id   uuid not null references signals (id) on delete cascade,

  unique (proposal_id, signal_id)
);

comment on table proposal_signals is 'Join: the signals that justify a proposal. With signal_sources, forms the proposal<-signals<-sources provenance chain.';

create index proposal_signals_org_id_idx on proposal_signals (org_id);
create index proposal_signals_proposal_id_idx on proposal_signals (proposal_id);
create index proposal_signals_signal_id_idx on proposal_signals (signal_id);

alter table proposal_signals enable row level security;

create policy proposal_signals_org_isolation on proposal_signals
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());
