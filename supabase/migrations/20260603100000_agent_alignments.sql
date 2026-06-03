-- ============================================================================
-- agent_alignments — bind an agent to the specific WORK it is responsible for.
-- Connections align an agent to broad AREAS (signals, gtm, …). This aligns it to
-- the concrete things: a specific initiative, or a single workstream (task)
-- inside one. That's how an agent gets pointed at exactly what matters — not just
-- "all signals", but "the Orchestration launch initiative and its GTM task".
--
-- The link is real (FK-backed), not a label: delete an initiative or a task and
-- its alignments cascade away, so the view can never show a stale binding. Phase
-- 2 wires this into agent-chat / evolve-skills so an aligned agent actually SEES
-- its initiatives + their signals in context.
--
--   role     — what the agent does for this work: 'watcher' (keeps an eye, gives
--              reads when asked) or 'owner' (accountable; proactively recommends).
--   guidance — optional focus note for this specific binding.
-- A row targets EITHER an initiative (initiative_id set, workstream_id null) OR a
-- single task (workstream_id set). The check + partial unique indexes enforce it.
-- ============================================================================

create table agent_alignments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  created_at    timestamptz not null default now(),

  agent_id      uuid not null references agents (id) on delete cascade,
  initiative_id uuid references initiatives (id) on delete cascade,
  workstream_id uuid references initiative_workstreams (id) on delete cascade,

  role          text not null default 'watcher',   -- watcher | owner
  guidance      text,

  constraint agent_alignments_has_target check (initiative_id is not null or workstream_id is not null),
  constraint agent_alignments_role_chk   check (role in ('watcher', 'owner'))
);

comment on table agent_alignments is 'Binds an agent to a specific initiative or workstream (task) it watches/owns. FK-backed so the binding is real and self-cleaning; drives what the agent sees in context.';

-- One binding per (agent, initiative) at the initiative level, and one per
-- (agent, task) — so the UI can toggle without creating duplicates.
create unique index agent_alignments_init_uniq on agent_alignments (agent_id, initiative_id) where initiative_id is not null and workstream_id is null;
create unique index agent_alignments_ws_uniq   on agent_alignments (agent_id, workstream_id) where workstream_id is not null;
create index agent_alignments_agent_idx on agent_alignments (agent_id);
create index agent_alignments_org_idx   on agent_alignments (org_id);
create index agent_alignments_init_idx  on agent_alignments (initiative_id);

alter table agent_alignments enable row level security;

create policy agent_alignments_org_isolation on agent_alignments
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());
