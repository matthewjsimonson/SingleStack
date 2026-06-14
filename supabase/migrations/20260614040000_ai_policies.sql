-- ============================================================================
-- ai_policies — the cost dial (F2: governance over model + effort spend).
--
-- F1 made spend VISIBLE (ai_usage). F2 makes it GOVERNABLE: a per-org policy
-- that aligns *which model* and *what effort* each AI task uses to the value of
-- the work — controlling token spend without starving quality.
--
-- Design (joins the cross-cutting governance family alongside review_policies
-- and ai_usage — org-scoped, lean, NOT hung off a Product Record):
--
--   Tiers   (what the work NEEDS)  — every task is classified into a stakes
--           tier (authoring | reasoning | conversational | extraction), in code
--           at _shared/ai_policy.ts. The tier carries the QUALITY FLOOR: the
--           minimum (model, effort) below which output is known to degrade.
--   Presets (how much to SPEND)    — quality | balanced | economy. A preset maps
--           each tier to a (model, effort) pair via a guard-railed matrix.
--           'custom' pins raw model/effort directly.
--   Scopes  (where it APPLIES)     — one row per scope target. Resolution is
--           most-specific-wins: task-pin > agent > area > org. Absent ⇒ the
--           caller's own current default (no regression).
--
-- The FLOOR is enforced at resolve time in _shared/ai_policy.ts (a row can
-- express intent below floor; execution is always clamped up to it), so quality
-- can never silently drop regardless of how a row was written. This table guards
-- only STRUCTURAL validity (scope target + custom completeness).
-- ============================================================================

create table ai_policies (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  updated_at  timestamptz not null default now(),
  updated_by  text,

  -- Where this policy applies. Exactly one target column is populated per scope.
  scope       text not null check (scope in ('org', 'area', 'agent', 'task')),
  area        text,                                    -- when scope='area' (connections.area: a product/gtm solution area)
  agent_id    uuid references agents (id) on delete cascade,  -- when scope='agent'
  task        text,                                    -- when scope='task' (an ai_usage task id)

  -- The dial. preset routes through the tier matrix; 'custom' pins model/effort.
  preset      text not null default 'balanced'
                check (preset in ('quality', 'balanced', 'economy', 'custom')),
  model       text,                                    -- raw override (required when preset='custom')
  effort      text check (effort in ('low', 'medium', 'high', 'xhigh', 'max')),

  -- Structural integrity: the scope's target column (and only it) must be set.
  constraint ai_policies_scope_target_chk check (
    (scope = 'org'   and area is null     and agent_id is null and task is null) or
    (scope = 'area'  and area is not null and agent_id is null and task is null) or
    (scope = 'agent' and agent_id is not null and area is null and task is null) or
    (scope = 'task'  and task is not null and area is null and agent_id is null)
  ),
  -- A custom policy must carry both raw levers.
  constraint ai_policies_custom_chk check (
    preset <> 'custom' or (model is not null and effort is not null)
  )
);

comment on table ai_policies is 'The cost dial (F2): per-org, per-scope policy aligning model + effort to each AI task. Resolution (task-pin > agent > area > org) and the quality floor are applied in _shared/ai_policy.ts; absent row = caller default. Joins review_policies/ai_usage as a cross-cutting governance table.';

-- One policy per scope target (partial uniques — most-specific-wins relies on this).
create unique index ai_policies_org_uniq   on ai_policies (org_id)           where scope = 'org';
create unique index ai_policies_area_uniq  on ai_policies (org_id, area)     where scope = 'area';
create unique index ai_policies_agent_uniq on ai_policies (org_id, agent_id) where scope = 'agent';
create unique index ai_policies_task_uniq  on ai_policies (org_id, task)     where scope = 'task';

-- Org-leading index for the single resolution read.
create index ai_policies_org_idx on ai_policies (org_id);

alter table ai_policies enable row level security;
create policy ai_policies_org_isolation on ai_policies
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());
