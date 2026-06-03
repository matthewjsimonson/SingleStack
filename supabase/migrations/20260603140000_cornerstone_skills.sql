-- ============================================================================
-- agent_skills — cornerstone designation.
-- The new agent/play model: an agent owns 1–3 CORNERSTONE skills that define its
-- core identity (e.g. a Competitor Analyst's "read competitor page" + "write to
-- Competitive Intelligence"). Cornerstones run on every job. Play-specific skills
-- (Phase 2) layer ON TOP of cornerstones, scoped to a single play.
-- A boolean on the agent↔skill attachment marks the cornerstones.
-- ============================================================================

alter table agent_skills add column if not exists is_cornerstone boolean not null default false;

comment on column agent_skills.is_cornerstone is '1–3 per agent: cornerstone skills define the agent''s core identity and run on every job. Play-layered skills are scoped to a play (Phase 2), not marked here.';

create index if not exists agent_skills_cornerstone_idx on agent_skills (agent_id) where is_cornerstone;
