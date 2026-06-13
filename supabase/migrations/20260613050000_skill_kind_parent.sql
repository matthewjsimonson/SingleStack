-- ============================================================================
-- Skills substrate (Phase A.1) — cornerstone/child as a first-class library shape.
--
-- Plain English: your model is "the library holds CORNERSTONE skills (the parent
-- profile = an agent's identity) and CHILD skills (how you tailor that profile to
-- a specific task)." Until now cornerstone-ness lived only on the ATTACHMENT
-- (agent_skills.is_cornerstone) — the skill row itself didn't know what it was,
-- and a child had no link to the cornerstone it tailors. This makes both first
-- class on the skill:
--   • kind       — 'cornerstone' (the profile/identity) or 'child' (a tailoring).
--   • parent_id  — for a child, the cornerstone it builds on (self-FK). NULL = a
--                  generic child not yet bound to a specific profile.
-- This is the foundation the skills-as-files work and the agent rebuild bind to;
-- it is deliberately independent of how an agent's runtime prompt is composed.
--
-- agent_skills.is_cornerstone stays: it designates WHICH cornerstone skill is a
-- given agent's identity (a cornerstone is agent-specific). skills.kind marks the
-- library TYPE. The two are consistent (a kind='cornerstone' skill is attached
-- with is_cornerstone=true).
-- ============================================================================

alter table skills add column if not exists kind text not null default 'child';
alter table skills drop constraint if exists skills_kind_shape;
alter table skills add constraint skills_kind_shape check (kind in ('cornerstone', 'child'));
comment on column skills.kind is
  'Library type: cornerstone (the parent profile = an agent''s identity) or child (a tailoring of a cornerstone for a task/area). Default child.';

-- A child's cornerstone. on delete set null: losing the parent degrades the child
-- to a generic child rather than deleting knowledge (intelligence-is-never-lost).
alter table skills add column if not exists parent_id uuid references skills (id) on delete set null;
comment on column skills.parent_id is
  'For a child skill, the cornerstone it tailors (self-FK). NULL = generic/unbound. A cornerstone never has a parent (enforced by skills_parent_shape).';

-- A cornerstone is a root profile — it never tailors another skill. (Single-row
-- check; "parent must itself be a cornerstone" is a cross-row rule left to the
-- app/seed for now.)
alter table skills drop constraint if exists skills_parent_shape;
alter table skills add constraint skills_parent_shape check (not (kind = 'cornerstone' and parent_id is not null));

create index if not exists skills_parent_id_idx on skills (parent_id);
create index if not exists skills_org_kind_idx on skills (org_id, kind);

-- Backfill: any skill that is attached somewhere AS a cornerstone is a cornerstone
-- profile; everything else stays a child (the default).
update skills s
   set kind = 'cornerstone'
 where s.kind <> 'cornerstone'
   and exists (select 1 from agent_skills a where a.skill_id = s.id and a.is_cornerstone);
