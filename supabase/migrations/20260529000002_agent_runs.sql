-- ============================================================================
-- agent_runs — one row per agent invocation (the observability log).
-- Plain English: every time an agent runs, we record it here: which agent, its
-- status, the input context, the output, which model was used, token counts and
-- cost, timing, and any error. This is where operational metrics come from
-- (e.g. cost over time, success rate), separate from the records themselves.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'agent_run_status') then
    create type agent_run_status as enum ('running', 'succeeded', 'failed', 'cancelled');
  end if;
end
$$;

create table agent_runs (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  created_at    timestamptz not null default now(),

  agent_id      uuid not null references agents (id) on delete cascade,
  status        agent_run_status not null default 'running',

  input         jsonb,                    -- the input/context the agent was given
  output        text,                     -- the agent's result
  model         text,                     -- model actually used for this run
  input_tokens  integer,
  output_tokens integer,
  cost_usd      numeric(10,4),
  error         text,                     -- populated when status = 'failed'

  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);

comment on table agent_runs is 'One row per agent invocation: status, input/output, model, token usage, cost, timing, errors. Source of agent operational metrics.';

create index agent_runs_org_id_idx on agent_runs (org_id);
create index agent_runs_agent_id_idx on agent_runs (agent_id);
create index agent_runs_status_idx on agent_runs (status);

alter table agent_runs enable row level security;

create policy agent_runs_org_isolation on agent_runs
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());
