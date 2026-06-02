-- ============================================================================
-- The orchestration layer: a Chief-of-Staff capability that reviews the whole
-- agent roster and proposes skill evolution — WITH RESTRAINT.
--
-- Design constraint (load-bearing): DON'T over-rotate. Mirrors living-records
-- and compounding-intelligence — change is gated and human-ratified, and the
-- system records what it deliberately LEFT ALONE (kind='hold'). reviewed_at
-- lets it skip re-proposing things it just considered.
-- ============================================================================

-- ---- skills: review cadence (so we can show restraint, not re-propose) ------
alter table skills add column if not exists reviewed_at     timestamptz;  -- last time the orchestrator considered it
alter table skills add column if not exists last_evolved_at timestamptz;  -- last time it actually changed
comment on column skills.reviewed_at is 'Last time the orchestrator reviewed this skill (even when it chose NOT to change it). Prevents over-rotation / re-proposing.';

-- ---- roster_recommendations: the orchestrator's HITL output -----------------
-- One run produces a batch. Changes are ratified; 'hold' rows are the explicit
-- "considered, not changing yet" record (the anti-over-rotation tell).
create table roster_recommendations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  created_at  timestamptz not null default now(),
  batch_id    uuid not null,

  kind        text not null,                   -- revise_skill | new_skill | hold
  agent_id    uuid references agents (id) on delete cascade,
  agent_key   text,                            -- denormalized for display
  skill_id    uuid references skills (id) on delete set null,
  title       text not null,                   -- display title
  rationale   text,
  drivers     jsonb,                           -- [{kind,title}] themes/signals/capabilities behind it
  payload     jsonb,                           -- proposed content (instructions / new skill fields)
  status      text not null default 'pending', -- pending | accepted | dismissed
  decided_at  timestamptz,

  constraint roster_recommendations_kind_shape
    check (kind in ('revise_skill','new_skill','hold')),
  constraint roster_recommendations_status_shape
    check (status in ('pending','accepted','dismissed'))
);

comment on table roster_recommendations is 'Output of an orchestrator roster review. Changes (revise/new skill) are ratified by a human; kind=hold records what was deliberately left unchanged (anti-over-rotation).';

create index roster_recommendations_org_id_idx on roster_recommendations (org_id);
create index roster_recommendations_batch_idx on roster_recommendations (batch_id);
create index roster_recommendations_status_idx on roster_recommendations (status);

alter table roster_recommendations enable row level security;
create policy roster_recommendations_org_isolation on roster_recommendations for all
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

-- ---- apply_skill_evolution(): also stamp last_evolved_at --------------------
-- Redefined now that the column exists, so an accepted evolution records recency
-- (used by the orchestrator to avoid churning recently-changed skills).
create or replace function public.apply_skill_evolution(
  p_skill uuid, p_instructions text, p_drivers jsonb default null, p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
begin
  select org_id into v_org from skills where id = p_skill;
  if v_org is null then
    raise exception 'skill % not found', p_skill;
  end if;
  if v_org is distinct from public.current_org_id() then
    raise exception 'not authorized for this org';
  end if;

  perform set_config('app.skill_source', 'evolved', true);
  perform set_config('app.skill_drivers', coalesce(p_drivers::text, ''), true);
  perform set_config('app.skill_note', coalesce(p_note, ''), true);

  update skills set instructions = p_instructions, last_evolved_at = now(), reviewed_at = now() where id = p_skill;

  perform set_config('app.skill_source', '', true);
  perform set_config('app.skill_drivers', '', true);
  perform set_config('app.skill_note', '', true);
end
$$;
