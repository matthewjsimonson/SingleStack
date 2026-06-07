-- ============================================================================
-- Retire plays (step 1 of 2): preserve play-skill content before plays go away.
--
-- Plays are being retired in favor of workflows. A play_skill captures "how an
-- agent does a job" — often bespoke, hand-authored instructions that must not be
-- lost. Lift that content into the skills library as ordinary CHILD skills
-- attached to the agent (is_cornerstone = false), so the knowledge survives.
--
-- Defensive + idempotent: a clean no-op on orgs that never created plays. The
-- plays / play_agents / play_skills / play_placements tables are intentionally
-- LEFT INTACT here; they are dropped in a later, separate migration once this
-- lift (and the UI/runtime removal) is verified — we never stop-writing and
-- drop-with-data in the same change.
-- ============================================================================

-- 1) Bespoke play skills (their own authored instructions) → new library skills.
insert into skills (org_id, key, name, description, instructions, category, source)
select ps.org_id,
       'lifted_play_skill_' || ps.id,
       coalesce(nullif(btrim(ps.name), ''), s.name, 'Lifted play skill'),
       'Lifted from a retired play.',
       coalesce(ps.instructions, s.instructions),
       coalesce(s.category, 'general'),
       'custom'
from play_skills ps
left join skills s on s.id = ps.skill_id
where coalesce(nullif(btrim(ps.instructions), ''), '') <> ''
on conflict (org_id, key) do nothing;

-- 2) Attach the lifted skills to their agent as child skills.
insert into agent_skills (org_id, agent_id, skill_id, is_cornerstone)
select ps.org_id, ps.agent_id, sk.id, false
from play_skills ps
join skills sk on sk.org_id = ps.org_id and sk.key = 'lifted_play_skill_' || ps.id
on conflict (agent_id, skill_id) do nothing;

-- 3) Library-linked play skills with no bespoke body → attach the existing
--    library skill to the agent as a child skill (so nothing the agent "knew"
--    through a play is lost).
insert into agent_skills (org_id, agent_id, skill_id, is_cornerstone)
select ps.org_id, ps.agent_id, ps.skill_id, false
from play_skills ps
where ps.skill_id is not null
  and coalesce(nullif(btrim(ps.instructions), ''), '') = ''
on conflict (agent_id, skill_id) do nothing;
