-- ============================================================================
-- Skills substrate (Phase A.1b) — template → tailored instance.
--
-- Plain English (the corrected model): a LIBRARY skill is a generic TEMPLATE — a
-- cornerstone is a role/purpose profile ("one narrative" for a CMO/CCO), a child
-- is a general capability ("competitive analysis"). Attaching a template to an
-- agent should mint a per-agent TAILORED INSTANCE — the same generic child is
-- tailored differently for a CPO vs a CMO. Until now there was no instance
-- concept: a skill's body lived on one shared row, so "tailoring" an attached
-- library skill mutated it for every agent. This adds the instance axis:
--   • scope     — 'library' (generic template) | 'agent' (a tailored instance).
--   • agent_id  — for an instance, the agent it belongs to (cascade: an agent's
--                 instances die with it). NULL for templates.
--   • parent_id — REPURPOSED: for an instance, the template it was tailored from
--                 (lineage). Templates normally have none. (Was provisionally
--                 "child→cornerstone" in A.1; that link is dropped — children are
--                 grouped under an agent via agent_id, not a skill→skill FK.)
--
-- An instance is its own row → its own markdown body and its own skill_revisions
-- history, so it is a true SKILL.md that can be evolved as a file, independent of
-- the template and of other agents' instances. Backfill is conservative: every
-- existing skill stays a 'library' template; the tailoring flow mints instances
-- going forward (a later data-cleanup can convert de-facto agent-specific skills).
-- ============================================================================

alter table skills add column if not exists scope    text not null default 'library';
alter table skills add column if not exists agent_id uuid references agents (id) on delete cascade;

alter table skills drop constraint if exists skills_scope_shape;
alter table skills add constraint skills_scope_shape check (
  (scope = 'library' and agent_id is null) or
  (scope = 'agent'   and agent_id is not null)
);

comment on column skills.scope is
  'library = a generic, reusable TEMPLATE (the catalog); agent = a per-agent TAILORED INSTANCE (its own body + revision history). Default library.';
comment on column skills.agent_id is
  'For a tailored instance (scope=agent), the agent it belongs to (on delete cascade — an agent''s instances are meaningless without it). NULL for library templates.';

-- parent_id is now instance→template lineage, so a cornerstone instance MAY have a
-- parent (the cornerstone template it was tailored from). Drop the old check that
-- forbade a cornerstone having a parent.
alter table skills drop constraint if exists skills_parent_shape;
comment on column skills.parent_id is
  'For a tailored instance, the library template it was tailored from (lineage). NULL = authored fresh / a template. on delete set null.';

create index if not exists skills_org_scope_idx on skills (org_id, scope);
create index if not exists skills_agent_id_idx on skills (agent_id);
