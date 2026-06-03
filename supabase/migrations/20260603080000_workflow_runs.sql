-- ============================================================================
-- workflow_runs — making workflow TRIGGERS real, propose-only. Plain English:
--   Workflows could be authored (agent + skills + trigger) but nothing ever
--   fired them. Now real events (a release marked shipped, a new capability
--   logged, …) FIRE the matching workflows — but firing never auto-acts. It
--   enqueues a workflow_run for a human to ratify (accept → take the action,
--   dismiss → reject), exactly like roster_recommendations and proposals. This
--   preserves the system's spine: agents propose, humans ratify.
--
--   A run captures WHICH workflow fired, WHAT event fired it (trigger +
--   context), a human-readable summary, and what accepting will DO.
-- ============================================================================

create table workflow_runs (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  created_at      timestamptz not null default now(),

  workflow_id     uuid not null references workflows (id) on delete cascade,
  trigger         text not null,                      -- the event that fired it (on_release | on_capability_update | on_signal | …)
  status          text not null default 'pending',    -- pending | accepted | dismissed
  context         jsonb,                               -- { label, release_id?, capability_id?, signal_id? } — what fired it
  summary         text,                                -- one line: "<workflow> — <event label>"
  proposed_action text,                                -- what accepting will do (human-readable)
  decided_by      text,
  decided_at      timestamptz,

  constraint workflow_runs_status_shape check (status in ('pending', 'accepted', 'dismissed'))
);

comment on table workflow_runs is 'A fired workflow awaiting human ratification (propose-only). Real events enqueue these; accepting takes the action, dismissing rejects. Never auto-acts.';

create index workflow_runs_org_id_idx on workflow_runs (org_id);
create index workflow_runs_workflow_idx on workflow_runs (workflow_id);
create index workflow_runs_status_idx on workflow_runs (status);

alter table workflow_runs enable row level security;
create policy workflow_runs_org_isolation on workflow_runs for all
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

-- Finally a writer for last_run_at: firing stamps when a workflow last fired.
comment on column workflows.last_run_at is 'When this workflow last FIRED (enqueued a run). Written by fireWorkflows.';
