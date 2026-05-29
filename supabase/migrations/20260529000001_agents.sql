-- ============================================================================
-- agents — the agent definitions (the "who" that proposes changes).
-- Plain English: one row per agent (e.g. a CPO agent, a CRO agent, Lyra). Each
-- has a stable key, a name, a role description, the model it runs on, and its
-- system prompt. Agents are producers of signals and proposals against the
-- foundation; this table is just their configuration, defined per org.
-- Provider-agnostic: "model" is free text, so any model id can be used.
-- ============================================================================

create table agents (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  created_at    timestamptz not null default now(),

  key           text not null,            -- stable id, e.g. "cpo", "cro", "lyra"
  name          text not null,            -- display name, e.g. "CPO agent"
  role          text,                     -- what this agent is responsible for
  model         text,                     -- model id it runs on (free text, provider-agnostic)
  system_prompt text,                     -- the agent's system prompt
  is_active     boolean not null default true,

  unique (org_id, key)
);

comment on table agents is 'Agent definitions (config) per org. Agents produce signals and proposals against the foundation. model is free text so any provider/model can be used.';

create index agents_org_id_idx on agents (org_id);

alter table agents enable row level security;

create policy agents_org_isolation on agents
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());
