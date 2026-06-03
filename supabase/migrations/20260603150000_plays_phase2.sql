-- ============================================================================
-- Plays — Phase 2: the job layer.
-- A play is a job: a description, one or more AGENTS attached, and play-specific
-- SKILLS layered on top of each agent's cornerstone skills (scoped to this play
-- only). Cornerstones live on the agent (agent_skills.is_cornerstone); play
-- skills live here and apply only inside the play.
--
--   plays.description — what job this play does.
--   play_agents       — agents attached to a play (the chain), ordered.
--   play_skills       — a skill layered onto ONE agent within ONE play.
-- Execution (Phase 4) runs each attached agent with its cornerstones + the play
-- skills layered on it. Placement (Phase 3) decides where the play renders.
-- ============================================================================

alter table plays add column if not exists description text;

create table play_agents (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  created_at  timestamptz not null default now(),
  play_id     uuid not null references plays (id) on delete cascade,
  agent_id    uuid not null references agents (id) on delete cascade,
  position    integer not null default 0,
  unique (play_id, agent_id)
);
comment on table play_agents is 'Agents attached to a play (the execution chain), ordered by position.';
create index play_agents_play_idx on play_agents (play_id);
create index play_agents_org_idx on play_agents (org_id);
alter table play_agents enable row level security;
create policy play_agents_org_isolation on play_agents
  for all using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

create table play_skills (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  created_at  timestamptz not null default now(),
  play_id     uuid not null references plays (id) on delete cascade,
  agent_id    uuid not null references agents (id) on delete cascade,
  skill_id    uuid not null references skills (id) on delete cascade,
  unique (play_id, agent_id, skill_id)
);
comment on table play_skills is 'A skill layered onto one agent within one play — on top of that agent''s cornerstone skills, scoped to the play.';
create index play_skills_play_idx on play_skills (play_id);
create index play_skills_org_idx on play_skills (org_id);
alter table play_skills enable row level security;
create policy play_skills_org_isolation on play_skills
  for all using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());
