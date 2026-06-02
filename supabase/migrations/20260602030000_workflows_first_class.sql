-- ============================================================================
-- Workflows made first-class: agent × skills × trigger × module/function.
-- Plain English: a workflow already names the agent that runs it and its
-- trigger. This adds the missing axes — the SKILLS it applies, and a MODULE (or
-- a function within a module) it's scoped to — so workflows are configurable at
-- both the agent level and the module level. Triggers gain on_release /
-- on_capability_update (trigger is free text, so no constraint change needed).
-- Additive and idempotent; nothing existing changes.
-- ============================================================================

alter table workflows add column if not exists module_id    uuid references modules (id) on delete set null;
alter table workflows add column if not exists function_key text;
alter table workflows add column if not exists skill_ids    uuid[] not null default '{}';

comment on column workflows.module_id is 'When set, the workflow is scoped to a module — surfaced at the module level on the product record, not only on the agent.';
comment on column workflows.function_key is 'Optional function within a module the workflow targets (free-text key).';
comment on column workflows.skill_ids is 'Skills this workflow applies when it runs (no FK: arrays cannot reference). Completes the agent×skills×trigger×target shape.';

create index if not exists workflows_module_id_idx on workflows (module_id);
