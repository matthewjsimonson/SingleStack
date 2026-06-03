-- ============================================================================
-- agent_artifacts — the structured OUTPUT of a Play (a typed agent analysis).
-- Agents don't just chat; a Play runs an agent's analytical function over a
-- target (a competitor, an initiative, a task) and returns a STRUCTURED artifact
-- — sections + evidence + recommendations — not freeform prose. The artifact is
-- the interface: a human reviews it, edits it section by section, and ratifies.
--
--   function_key — which Play (product_standing | build_to_beat | narrative_angle
--                  | win_plan | …). The Play decides the lens + best-fit officer.
--   target_type/id — what it analyzed (v1: 'competitor').
--   payload      — the typed artifact: { headline, sections[{title,body,evidence[]}],
--                  recommendations[], confidence }.
--   status       — draft (just run) | ratified (human accepted) | dismissed.
--   run_id       — the agent_runs row, so the outcome loop (rating) applies.
-- Record-field changes keep using `proposals`; this is for standalone analyses.
-- ============================================================================

create table agent_artifacts (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  created_at    timestamptz not null default now(),

  agent_id      uuid references agents (id) on delete set null,
  function_key  text not null,
  target_type   text not null,
  target_id     uuid,
  title         text,

  status        text not null default 'draft',
  payload       jsonb not null default '{}',
  run_id        uuid references agent_runs (id) on delete set null,
  created_by    text,
  ratified_at   timestamptz,

  constraint agent_artifacts_status_chk check (status in ('draft', 'ratified', 'dismissed'))
);

comment on table agent_artifacts is 'Structured output of a Play (typed agent analysis) over a target. Reviewed + ratified HITL. payload is typed by the Play; run_id ties it to the outcome loop.';

create index agent_artifacts_org_idx     on agent_artifacts (org_id);
create index agent_artifacts_target_idx  on agent_artifacts (target_type, target_id);
create index agent_artifacts_function_idx on agent_artifacts (function_key);

alter table agent_artifacts enable row level security;

create policy agent_artifacts_org_isolation on agent_artifacts
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());
