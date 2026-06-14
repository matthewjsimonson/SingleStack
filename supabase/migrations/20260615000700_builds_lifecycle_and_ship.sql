-- Migration: builds_lifecycle_and_ship  (P2.5a.2 — verified ship)
-- Purpose: make the build lifecycle mirror how AI-native teams actually build and ship,
--   and make "shipped" a thing the system WITNESSES rather than a button. Grounded in
--   research (GitHub Copilot coding agent, Vercel Deployment Checks, spec-driven dev,
--   Veracode/GitClear/CodeRabbit risk data — see docs/research/product-capability.md):
--     • A build moves through a PR-centric lifecycle, not a binary done.
--     • "merged" is not "shipped"; the authoritative ship signal is a production deploy
--       that passed post-merge checks. "shipped" is also distinct from "verified"
--       (outcome metrics met -> the existing expected_outcomes loop, wired in P2.5b).
--     • The agent cannot declare itself done; the HITL merge gate stays non-delegable
--       (enforced by the reviewer pass + human approval in P2.5b, not here).
-- This migration enriches the builds artifact and adds the verified-ship coupling as a
--   data-layer FLOOR trigger: a build's status only ever RAISES initiatives.build_state,
--   never lowers it — so it cannot fight the client-side max(derived, floor) logic in
--   web/lib/buildStage.ts. Dormant until P2.5b's engine writes build statuses.
-- Author: SingleStack · Date: 2026-06-15

-- 1. Richer, PR-centric status lifecycle.
alter table builds drop constraint if exists builds_status_shape;
alter table builds add constraint builds_status_shape check (status in (
  'queued',      -- created, awaiting the builder
  'building',    -- the builder/agent is working
  'built',       -- artifact produced (e.g. PR opened), awaiting review
  'in_review',   -- reviewer pass + human review in progress
  'approved',    -- review cleared, awaiting merge (human merge gate)
  'merged',      -- merged to the target branch (NOT yet live)
  'deploying',   -- production deploy in flight
  'shipped',     -- live in production, post-merge checks passed
  'verified',    -- outcome metrics met (expected_outcomes resolved) — distinct from shipped
  'failed',
  'cancelled'
));
comment on column builds.status is 'PR-centric build lifecycle: queued|building|built|in_review|approved|merged|deploying|shipped|verified|failed|cancelled. "shipped" = live + checks passed (not merely merged); "verified" = outcome metrics met (expected_outcomes).';

-- 2. Prototype vs production, and the real PR/deploy coordinates.
alter table builds add column if not exists kind text not null default 'production';
alter table builds drop constraint if exists builds_kind_shape;
alter table builds add constraint builds_kind_shape check (kind in ('prototype', 'production'));
comment on column builds.kind is 'prototype = a reference-implementation/vibe-coded artifact (evidence of intent, not source of truth); production = a hardened build that ships.';

alter table builds add column if not exists pr_url       text;        -- the pull request
alter table builds add column if not exists merged_at    timestamptz; -- when merged (≠ shipped)
alter table builds add column if not exists deploy_url   text;        -- preview/production deploy
alter table builds add column if not exists deployed_at  timestamptz; -- when the ship deploy succeeded
alter table builds add column if not exists verified_at  timestamptz; -- when outcomes confirmed

comment on column builds.merged_at  is 'When merged to the target branch. Merge is the beginning, not the finish line — shipped requires a passing production deploy.';
comment on column builds.deployed_at is 'When the production deploy succeeded (post-merge checks passed). This is the authoritative "shipped" signal.';

-- 3. Verified-ship coupling — a FLOOR trigger (only ever raises initiatives.build_state).
--    Respects web/lib/buildStage.ts max(derived, stored-floor): we set the stored floor.
create or replace function public.builds_sync_initiative_build_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  implied      text;
  rank_implied int;
begin
  -- Map the build's status to the item-level build_state FLOOR it implies.
  implied := case
    when new.status in ('building', 'built', 'in_review', 'approved', 'merged', 'deploying')
      then 'in_build'
    when new.status in ('shipped', 'verified')
      then 'shipped'
    else null  -- queued | failed | cancelled imply no floor
  end;
  if implied is null then
    return new;
  end if;

  -- build_state ladder: scoped(1) < ready_for_agent(2) < in_build(3) < shipped(4).
  rank_implied := case implied when 'in_build' then 3 when 'shipped' then 4 else 0 end;

  -- Only RAISE the floor — never demote a manually-set or higher state. Scoped by org_id
  -- so the security-definer update stays tenant-safe even bypassing RLS.
  update initiatives i
     set build_state = implied
   where i.id = new.initiative_id
     and i.org_id = new.org_id
     and coalesce(
           case i.build_state
             when 'scoped' then 1 when 'ready_for_agent' then 2
             when 'in_build' then 3 when 'shipped' then 4 else 0 end, 0
         ) < rank_implied;
  return new;
end;
$$;

comment on function public.builds_sync_initiative_build_state() is 'Verified-ship coupling: a build status raises (never lowers) initiatives.build_state as a floor, so a real build+deploy — not a button — drives the item to in_build/shipped. Pairs with web/lib/buildStage.ts max(derived, floor).';

drop trigger if exists builds_sync_build_state on builds;
create trigger builds_sync_build_state
  after insert or update of status on builds
  for each row execute function public.builds_sync_initiative_build_state();
