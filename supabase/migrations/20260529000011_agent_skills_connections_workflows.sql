-- ============================================================================
-- Agent capabilities: skills, connections, and workflows.
-- Plain English: agents need more than a prompt. This adds three things an org
-- configures per agent:
--   • skills      — reusable, tailorable capabilities an agent can apply
--                   (e.g. "competitive teardown", "positioning rewrite"). A
--                   skill has instructions; orgs tailor them to their company.
--   • agent_skills— which skills are attached to which agent (many-to-many).
--   • connections — data/tool access an agent can use: internal areas of the
--                   product (products, gtm, signals) or external tools (MCP).
--                   Status reflects manual/connected; live MCP wiring comes later.
--   • workflows   — saved tasks an agent runs: a trigger (manual/scheduled/
--                   on_signal), a target, and steps. Executed runs log to
--                   agent_runs as today.
-- All org-scoped with RLS, matching every other table.
-- ============================================================================

-- ---- skills ----------------------------------------------------------------
create table skills (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  created_at    timestamptz not null default now(),

  key           text not null,            -- stable id, e.g. "competitive_teardown"
  name          text not null,            -- display name
  description   text,                     -- what it does
  instructions  text,                     -- the tailorable prompt/playbook body
  category      text default 'general',   -- product | gtm | research | general
  source        text default 'custom',    -- custom | template | github
  source_ref    text,                     -- e.g. github repo/path when imported

  unique (org_id, key)
);

comment on table skills is 'Reusable, tailorable agent capabilities (instructions/playbooks). Orgs author or import them and attach to agents via agent_skills.';

create index skills_org_id_idx on skills (org_id);

alter table skills enable row level security;
create policy skills_org_isolation on skills for all
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

-- ---- agent_skills (join) ---------------------------------------------------
create table agent_skills (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  created_at timestamptz not null default now(),

  agent_id   uuid not null references agents (id) on delete cascade,
  skill_id   uuid not null references skills (id) on delete cascade,

  unique (agent_id, skill_id)
);

comment on table agent_skills is 'Which skills are attached to which agent (many-to-many).';

create index agent_skills_org_id_idx on agent_skills (org_id);
create index agent_skills_agent_id_idx on agent_skills (agent_id);
create index agent_skills_skill_id_idx on agent_skills (skill_id);

alter table agent_skills enable row level security;
create policy agent_skills_org_isolation on agent_skills for all
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

-- ---- connections -----------------------------------------------------------
-- Data/tool access for an agent. kind 'internal' points at an area of the
-- product (area: products|gtm|signals|records); kind 'mcp' points at an external
-- MCP server (config holds url/name; secrets handled later, never in config).
create table connections (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  created_at  timestamptz not null default now(),

  agent_id    uuid references agents (id) on delete cascade,  -- null = org-level connection
  kind        text not null default 'internal',  -- internal | mcp
  label       text not null,
  area        text,                              -- internal: products|gtm|signals|records
  mcp_url     text,                              -- mcp: server endpoint
  status      text not null default 'manual',    -- manual | connected | disconnected
  config      jsonb
);

comment on table connections is 'Data/tool access for agents: internal product areas or external MCP servers. Live MCP wiring + credentials come later; status tracks state.';

create index connections_org_id_idx on connections (org_id);
create index connections_agent_id_idx on connections (agent_id);

alter table connections enable row level security;
create policy connections_org_isolation on connections for all
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

-- ---- workflows -------------------------------------------------------------
-- A saved task an agent runs. trigger: manual | scheduled | on_signal.
-- target_type/target_id point at what it acts on (product/gtm record), steps is
-- a freeform ordered list (jsonb) for now; execution still logs to agent_runs.
create table workflows (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  created_at   timestamptz not null default now(),

  agent_id     uuid references agents (id) on delete set null,
  name         text not null,
  description  text,
  trigger      text not null default 'manual',   -- manual | scheduled | on_signal
  schedule     text,                              -- cron-ish, when scheduled
  target_type  text,                              -- product | gtm | none
  target_id    uuid,                              -- the record it acts on (optional)
  steps        jsonb default '[]',                -- ordered steps
  is_active    boolean not null default true,
  last_run_at  timestamptz
);

comment on table workflows is 'Saved agent tasks: a trigger (manual/scheduled/on_signal), an optional target record, and ordered steps. Executions log to agent_runs.';

create index workflows_org_id_idx on workflows (org_id);
create index workflows_agent_id_idx on workflows (agent_id);

alter table workflows enable row level security;
create policy workflows_org_isolation on workflows for all
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());
