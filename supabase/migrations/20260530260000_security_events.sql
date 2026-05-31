-- ============================================================================
-- security_events — the audit spine for agentic/AI security.
--
-- SingleStack ingests UNTRUSTED external content and gives agents live
-- connections. The threat is "inject instructions into a page → an agent acts."
-- The shared security module (functions/_shared/security.ts) SCREENS every
-- fetched document for prompt-injection / tool-abuse before it reaches a model;
-- this table is where those screenings — and any quarantine/block decision — are
-- recorded. Trust is a feature: a buyer (and the user) can see exactly what was
-- flagged, what was quarantined, and why. See docs/SECURITY.md.
-- ============================================================================

create table if not exists security_events (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  created_at    timestamptz not null default now(),

  -- where it came from
  surface       text not null,                       -- 'connector' | 'agent' | 'recipe' | …
  source_id     uuid references sources (id) on delete set null,
  run_id        uuid references connector_runs (id) on delete set null,

  -- what was screened + the verdict
  kind          text not null default 'injection_screen', -- injection_screen | ssrf_block | quarantine | policy_block
  verdict       text not null,                       -- clean | warn | block
  risk          numeric(3,2),                        -- 0..1 score from the screen
  flags         text[] not null default '{}',        -- which patterns fired (override-instructions, exfiltration-request, …)
  ref           text,                                -- the url/handle screened
  detail        jsonb                                -- redacted preview, sizes, etc. (never raw secrets)
);

comment on table security_events is 'Append-only audit of AI-security screenings: every fetched document is screened for prompt-injection/tool-abuse before reaching a model; blocks/quarantines are recorded here. Transparency + trust (docs/SECURITY.md).';
comment on column security_events.verdict is 'clean | warn (fed to model, flagged) | block (quarantined — never fed to a model).';
comment on column security_events.flags is 'Deterministic patterns that fired (override-instructions, system-impersonation, exfiltration-request, …).';

create index if not exists security_events_org_idx on security_events (org_id, created_at desc);
create index if not exists security_events_verdict_idx on security_events (org_id, verdict) where verdict <> 'clean';
create index if not exists security_events_source_idx on security_events (source_id);

alter table security_events enable row level security;

-- Read: org-scoped, like everything else — the user sees their own security log.
drop policy if exists security_events_org_read on security_events;
create policy security_events_org_read on security_events for select
  using (org_id = public.current_org_id());

-- Write: the runner executes as the caller (JWT forwarded) so the same org check
-- applies. Append-only in spirit: no update/delete policy → the log can't be
-- rewritten from the client, only appended to.
drop policy if exists security_events_org_insert on security_events;
create policy security_events_org_insert on security_events for insert
  with check (org_id = public.current_org_id());
