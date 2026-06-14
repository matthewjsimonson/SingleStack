-- Migration: builds  (P2.5a — the build motor's chassis)
-- Purpose: give the product/build circle its missing load-bearing entity — a first-class
--   record of an actual build. Today the "make" is an off-platform markdown brief
--   (web/lib/agentBrief.ts) copied to an external coding agent, and initiatives.build_state
--   = 'shipped' is a flag pointing at nothing. A `builds` row is the OUTPUT/execution
--   artifact, complementary to build_context_links (the INPUT context bundle).
--
-- Scope (deliberate): the artifact registry ONLY. Additive and safe. The verified-ship
--   coupling (a build's terminal status driving initiatives.build_state) is sequenced as
--   its own step, because build_state is a derived/floor hybrid (web/lib/buildStage.ts)
--   that is client-side-only today — coupling it must be designed with that logic in view,
--   not blind. The reviewer pass + codegen function + builder agent are P2.5b.
--
-- Conventions: the established codebase pattern (3-column spine, text + CHECK, RLS via
--   public.current_org_id()), consistent with build_module_foundation / initiatives.
-- Author: SingleStack · Date: 2026-06-15

create table if not exists builds (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  created_at    timestamptz not null default now(),

  -- Parent: the Build Item this build executes (mirrors build_context_links.initiative_id).
  initiative_id uuid not null references initiatives (id) on delete cascade,

  -- The build's OWN execution lifecycle. Kept here (not on initiatives.build_state, whose
  -- CHECK is fixed at four values and whose semantics are a client-side floor/derive
  -- hybrid) so the artifact can carry build-specific states like building/failed.
  status        text not null default 'queued',

  -- Provenance (schema §1.3): who/what produced it.
  agent_id      uuid references agents (id) on delete set null,
  model         text,                  -- frontier model used, when AI-built

  -- The handoff INPUT, snapshotted. agentBrief is otherwise generated client-side and
  -- never persisted — without this the record of "what was handed to the builder" is lost.
  brief         text,

  -- The produced OUTPUT artifact.
  artifact_kind text,                  -- pr | branch | preview | prototype | diff
  artifact_url  text,                  -- PR / branch / preview / prototype URL
  diff          text,                  -- produced patch/diff, when captured inline
  summary       text,                  -- what was built (agent or human summary)

  shipped_at    timestamptz,           -- set when this build is verified-shipped (later step)
  position      integer not null default 0,

  constraint builds_status_shape
    check (status in ('queued', 'building', 'built', 'failed', 'shipped', 'cancelled'))
);

comment on table builds is 'A build of a Build Item (initiative) — the execution/output artifact: status, the frontier model/agent that produced it, a snapshot of the handoff brief, and the produced artifact (PR/branch/preview/prototype/diff). Complements build_context_links (the input bundle). See docs/architecture/agent-orchestration.md (P2.5).';
comment on column builds.status is 'Build execution lifecycle: queued | building | built | failed | shipped | cancelled. Distinct from initiatives.build_state (the item-level state).';
comment on column builds.brief is 'Snapshot of the agent handoff brief (buildAgentBrief). Persisted here because it is otherwise client-only and ephemeral.';

create index if not exists builds_org_id_idx        on builds (org_id);
create index if not exists builds_initiative_id_idx on builds (org_id, initiative_id);
create index if not exists builds_status_idx        on builds (org_id, status);

alter table builds enable row level security;
drop policy if exists builds_org_isolation on builds;
create policy builds_org_isolation on builds for all
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());
