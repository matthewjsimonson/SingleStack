-- ============================================================================
-- Expected outcomes — the Learn loop's spine (Ship → Outcome → Signals).
--
-- Until now nothing came back after Ship: theme momentum measured evidence
-- ARRIVAL, never results. An expected_outcome is a falsifiable claim attached
-- to an epic (strategy_bundle): "if this works, THIS should move THAT way
-- within N days." Two measure kinds:
--   • metric — a record_fields metric (field_kind='metric'); evidence is its
--     record_metrics time-series (provenance-enforced — the primitive built in
--     dogfood finding #5, finally wired into strategy).
--   • signal — qualitative; evidence is the signals that arrive in the window.
--
-- Lifecycle: watching → (outcome-watch drafts an AI verdict at the horizon)
-- → review → human resolves → hit | missed | inconclusive. HITL throughout:
-- the AI only ever DRAFTS a verdict. Resolving feeds a signal back into the
-- stream — shipped work becomes evidence, and decisions grow a scoreable
-- track record (the results corpus future lessons can learn from).
-- ============================================================================

create table expected_outcomes (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  created_at      timestamptz not null default now(),

  bundle_id       uuid not null references strategy_bundles (id) on delete cascade,
  title           text not null,                    -- the claim: "Activation rate rises"
  measure_kind    text not null default 'signal',   -- metric | signal
  record_field_id uuid references record_fields (id) on delete set null,  -- the metric, when measure_kind='metric'
  direction       text not null default 'up',       -- up | down (which way is success)
  horizon_days    int  not null default 30,
  review_due_at   timestamptz not null,

  -- Baseline captured at declaration (metric kind), so "moved" is testable.
  baseline_num    numeric,
  baseline_at     timestamptz,

  status          text not null default 'watching', -- watching | review | hit | missed | inconclusive
  ai_verdict      text,                              -- hit | missed | inconclusive (the DRAFT)
  ai_rationale    text,
  evidence        jsonb,                             -- what the watcher saw (readings / signals)
  checked_at      timestamptz,

  resolved_at     timestamptz,
  resolved_by     text,
  resolution_note text,

  constraint expected_outcomes_kind_chk      check (measure_kind in ('metric', 'signal')),
  constraint expected_outcomes_direction_chk check (direction in ('up', 'down')),
  constraint expected_outcomes_status_chk    check (status in ('watching', 'review', 'hit', 'missed', 'inconclusive')),
  constraint expected_outcomes_metric_shape  check (measure_kind <> 'metric' or record_field_id is not null),
  constraint expected_outcomes_horizon_chk   check (horizon_days between 1 and 365)
);

comment on table expected_outcomes is 'Falsifiable success claims on epics — the Learn loop. AI drafts verdicts at the horizon (outcome-watch); humans resolve; resolutions feed back as signals.';

create index expected_outcomes_org_idx on expected_outcomes (org_id);
create index expected_outcomes_bundle_idx on expected_outcomes (bundle_id);
create index expected_outcomes_due_idx on expected_outcomes (status, review_due_at) where status = 'watching';

alter table expected_outcomes enable row level security;
create policy expected_outcomes_org_isolation on expected_outcomes for all
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());
