-- ============================================================================
-- Cornerstone = the agent's identity. Exactly one per agent.
-- The 1–3 allowance was a holdover; the model is now "cornerstone = the
-- general-purpose identity of the agent" (singular), with child skills layered
-- on top for specific tasks/areas. Collapse any agent that has more than one
-- cornerstone down to its original (earliest) one, then enforce at most one
-- cornerstone per agent at the database level.
-- ============================================================================

-- Demote extras: keep the earliest-created cornerstone per agent as THE identity;
-- everything else becomes a child skill (is_cornerstone = false).
with ranked as (
  select id, row_number() over (partition by agent_id order by created_at asc, id asc) as rn
  from agent_skills
  where is_cornerstone
)
update agent_skills s
set is_cornerstone = false
from ranked r
where s.id = r.id and r.rn > 1;

-- Enforce it: at most one cornerstone per agent. (An agent may transiently have
-- zero while the operator is reassigning identity; the UI guides toward one.)
drop index if exists agent_skills_cornerstone_idx;
create unique index if not exists agent_skills_one_cornerstone_idx
  on agent_skills (agent_id) where is_cornerstone;

comment on column agent_skills.is_cornerstone is
  'Exactly one per agent: the cornerstone is the agent''s general-purpose identity and runs on every job. All other attached skills are child skills, scoped to specific tasks/areas.';
