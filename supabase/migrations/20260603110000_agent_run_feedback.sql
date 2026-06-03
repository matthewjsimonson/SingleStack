-- ============================================================================
-- agent_runs — feedback (the outcome loop).
-- Every agent output is logged in agent_runs. Until now nothing recorded whether
-- the output was any GOOD — so skill evolution was flying blind. This adds a
-- human verdict on a run: was it helpful, and why. That verdict is fed back into
-- the agent's next answers (agent-chat) and into evolve-skills, so the agent
-- learns from outcomes, not just from more inputs.
--
--   rating       — 'helpful' | 'not_helpful' (null = un-rated)
--   feedback     — optional free-text "why" (the teaching)
--   reason_tags  — quick tags: off_base | thin_evidence | wrong_scope | too_generic | tone | great
--   rated_at     — when the human rated it
-- Mirrors the intel_updates verdict pattern, but for any agent run.
-- ============================================================================

alter table agent_runs add column if not exists rating      text;
alter table agent_runs add column if not exists feedback    text;
alter table agent_runs add column if not exists reason_tags text[] not null default '{}';
alter table agent_runs add column if not exists rated_at    timestamptz;

do $$ begin
  alter table agent_runs add constraint agent_runs_rating_chk check (rating is null or rating in ('helpful', 'not_helpful'));
exception when duplicate_object then null; end $$;

comment on column agent_runs.rating is 'Human verdict on this run''s output: helpful | not_helpful | null. Fed back into agent-chat and evolve-skills so the agent learns from outcomes.';

-- Cheap "recent feedback for this agent" lookup.
create index if not exists agent_runs_rated_idx on agent_runs (agent_id, rated_at desc) where rating is not null;
