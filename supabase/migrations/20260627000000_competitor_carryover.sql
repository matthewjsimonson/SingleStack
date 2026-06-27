-- ============================================================================
-- competitor carry-over — let the discovery wizard's output survive onto the
-- competitor, and give the per-competitor HITL "Finalize" flow somewhere to live.
--
-- Today the landscape wizard (setup-competitive / CompetitiveSetup) DISCOVERS a
-- rival's website AND LinkedIn URL, but only `website` lands on the competitor
-- row — the LinkedIn URL is spent building monitoring sources and then discarded.
-- After discovery a competitor page is therefore near-empty: no LinkedIn, no
-- structured picture of THEIR product/GTM, no signal of how far "set up" it is.
--
-- This is additive and reversible (nullable columns, no backfill required):
--   • linkedin — the discovered company LinkedIn URL, persisted so the
--     per-competitor setup (and its monitors) can reuse it instead of re-finding it.
--   • setup    — resumable state for the HITL Finalize flow (step cursor, the
--     agent-drafted-then-human-edited product/GTM picture, and a finalized_at
--     stamp). JSON so the flow can evolve without a migration per field; the
--     ratified picture is mirrored into signal_profile_fields as the deep Overview.
-- ============================================================================

alter table competitors
  add column if not exists linkedin text;

comment on column competitors.linkedin is 'Company LinkedIn URL — carried over from the discovery wizard (which finds it but previously only used it to seed sources). Reused by the per-competitor Finalize flow and LinkedIn monitors.';

alter table competitors
  add column if not exists setup jsonb not null default '{}'::jsonb;

comment on column competitors.setup is 'Resumable state for the per-competitor HITL Finalize flow: { step, picture (their product/GTM, drafted then human-edited), finalized_at }. The ratified picture is also written to signal_profile_fields as the competitor Overview.';
