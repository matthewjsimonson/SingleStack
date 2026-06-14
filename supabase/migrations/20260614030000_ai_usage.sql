-- ============================================================================
-- ai_usage — the unified AI spend ledger (F1: visibility).
-- Every AI call (skill/agent generators, chat, runs) logs one row: which TASK
-- spent the tokens, on which model, for which agent, and the cost. This powers the
-- Settings "AI & token management" dashboard (spend by task / model / agent over
-- time) and, later, the implication previews on the cost dial (F2).
--
-- agent_runs already records per-run tokens/cost for the run-rating feature; this
-- is the cross-cutting spend ledger for ALL AI calls (including the chat builders
-- and generators that don't create a run). Org-scoped with RLS like every table.
-- ============================================================================

create table ai_usage (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  created_at    timestamptz not null default now(),

  task          text not null,          -- tailor_skill | draft_skill | draft_agent | evolve_draft | evolve_skills | agent_chat | ...
  agent_id      uuid references agents (id) on delete set null,
  model         text,
  input_tokens       integer not null default 0,
  output_tokens      integer not null default 0,
  cache_read_tokens  integer not null default 0,   -- cached-prefix reads (cheap)
  cache_write_tokens integer not null default 0,   -- cache writes (one-time)
  cost_usd      numeric(10,4)                       -- null when the model price is unknown
);

comment on table ai_usage is 'Unified AI spend ledger: one row per AI call, tagged by task/model/agent with token counts + cost. Powers the AI & token management dashboard and the cost dial''s implication previews.';

create index ai_usage_org_created_idx on ai_usage (org_id, created_at desc);
create index ai_usage_org_task_idx on ai_usage (org_id, task);

alter table ai_usage enable row level security;
create policy ai_usage_org_isolation on ai_usage
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());
