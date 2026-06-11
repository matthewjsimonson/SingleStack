-- ============================================================================
-- Phase 1 — evidence-derived capability scoring.
--
-- The capability matrix (the heat-map centerpiece of competitive intel) has had
-- ZERO intelligence behind it: every cell was hand-typed, and a signal that
-- "Competitor X shipped SSO" never moved the matrix. This closes that loop.
--
-- A new agent (score-capabilities) reads a competitor's signals + themes and
-- PROPOSES a score (0..3) per capability, each citing the signals that justify
-- it. Proposals land in the SAME review gate themes and battlecards use
-- (intel_updates, kind 'capability_score') — accept/edit/reject + rationale.
-- On accept, resolve-intel-update upserts the cell. HITL is absolute, exactly
-- like battlecards: the agent argues from evidence, the human ratifies.
--
-- This migration only widens the gate's kind whitelist and adds provenance to
-- the cell so a ratified score remembers WHO scored it, from WHAT evidence, and
-- WHY. No data is destroyed; existing manual scores keep working untouched.
-- ============================================================================

-- ---- 1. let the review gate carry a capability score ------------------------
alter table intel_updates drop constraint if exists intel_updates_kind_shape;
alter table intel_updates add constraint intel_updates_kind_shape
  check (kind in ('new_theme','escalate','merge','decay','restate','set_dimension','battlecard_item','battlecard_update','capability_score'));

-- ---- 2. provenance on the cell ----------------------------------------------
-- A ratified score should show its work: which agent proposed it, the signals
-- behind it, the one-line rationale, and when the evidence was current. Manual
-- ratings simply leave these null (scored_by stays null = "set by hand").
alter table capability_scores add column if not exists scored_by   text;
alter table capability_scores add column if not exists rationale   text;
alter table capability_scores add column if not exists signal_ids  uuid[] not null default '{}';
alter table capability_scores add column if not exists evidence_at timestamptz;

comment on column capability_scores.scored_by  is 'The agent that proposed this score (via score-capabilities), or null when a human set it by hand.';
comment on column capability_scores.rationale  is 'One-line justification for the score, from the evidence — surfaced in the capability drawer.';
comment on column capability_scores.signal_ids is 'The signals that back this score (the evidence trail for the rating).';
comment on column capability_scores.evidence_at is 'When the backing evidence was current — lets the matrix flag a score as going stale.';
