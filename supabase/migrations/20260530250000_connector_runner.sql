-- ============================================================================
-- Connector runner — Slice #3 from CONNECTIVITY.md. Turn a source from a
-- declared intent into a live pull: fetch → distill → signals, budget-capped,
-- audited, secure. Plus the primitive that makes any connection actually USEFUL:
-- POINTING CONTEXT.
--
-- The insight: connecting Salesforce (or a website, or a GitHub org) isn't
-- enough. An agent/runner needs to be told WHERE TO LOOK — these specific
-- reports, accounts, opportunities, pages, repos. A bare MCP connection is a
-- firehose with no aim. `targets` + `guidance` give it aim, on BOTH:
--   • sources      — what a source-pull should fetch
--   • connections  — what an agent's MCP/internal connection should consult
--
-- All additive/nullable; existing rows behave unchanged.
-- ============================================================================

-- ---- pointing context on sources -------------------------------------------
-- targets: structured "look here" list. Each item:
--   { type, ref, label, note } — e.g.
--   { "type":"url",     "ref":"https://x.com/pricing", "label":"Pricing page" }
--   { "type":"report",  "ref":"00O...","label":"Win/loss by competitor" }
--   { "type":"account", "ref":"001...","label":"Acme Corp" }
-- The runner fetches/consults exactly these (plus config.url), nothing wider.
alter table sources add column if not exists targets jsonb not null default '[]';
-- guidance: freeform natural-language pointing ("focus on enterprise tier
-- pricing and any mention of SSO/SAML; ignore the careers section").
alter table sources add column if not exists guidance text;

comment on column sources.targets is 'Pointing context: structured [{type,ref,label,note}] telling the runner exactly what to fetch/consult (urls, reports, accounts, repos). Aim, not a firehose.';
comment on column sources.guidance is 'Freeform natural-language pointing — where to look and what matters, in plain words. Complements targets.';

-- ---- pointing context on connections (agent-level) -------------------------
-- Same primitive for agent MCP/internal connections. When an agent connects to
-- Salesforce/GitHub via MCP, THIS is how you say "look at these reports / these
-- repos / these accounts" — the difference between a connection and a useful one.
alter table connections add column if not exists targets jsonb not null default '[]';
alter table connections add column if not exists guidance text;

comment on column connections.targets is 'Pointing context for an agent connection: structured [{type,ref,label,note}] — which reports/accounts/repos/tools the agent should consult. Makes an MCP connection actually useful.';
comment on column connections.guidance is 'Freeform natural-language guidance for an agent connection — where to look, what to prioritize, what to ignore.';

-- ---- connector_runs — audit + transparency (security model #5) -------------
-- Every pull is a record: what ran, when, how much it fetched/produced, cost,
-- errors. The user can see and trust it; disconnect stops the runner.
create table if not exists connector_runs (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  created_at      timestamptz not null default now(),

  source_id       uuid references sources (id) on delete cascade,
  trigger         text not null default 'manual',     -- manual | scheduled
  status          text not null default 'running',    -- running | ok | error | skipped
  items_fetched   integer not null default 0,         -- raw items the fetch returned
  signals_created integer not null default 0,         -- signals that passed the budget+relevance gate
  items_dropped   integer not null default 0,         -- dropped below min_relevance / over budget
  error           text,                                -- failure reason, if any
  detail          jsonb,                               -- per-item trace (titles, relevance) for the UI
  finished_at     timestamptz
);

comment on table connector_runs is 'Audit log for connector pulls — what was fetched, when, how many signals, cost, errors. Transparency + revocability (CONNECTIVITY.md security #5).';

create index if not exists connector_runs_org_id_idx on connector_runs (org_id);
create index if not exists connector_runs_source_id_idx on connector_runs (source_id, created_at desc);

alter table connector_runs enable row level security;

-- Reads: org-scoped, like everything else.
drop policy if exists connector_runs_org_read on connector_runs;
create policy connector_runs_org_read on connector_runs for select
  using (org_id = public.current_org_id());

-- Writes: the runner executes as the caller (JWT forwarded) so the same org
-- check applies — a user can only ever write run records for their own org.
drop policy if exists connector_runs_org_write on connector_runs;
create policy connector_runs_org_write on connector_runs for all
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());
