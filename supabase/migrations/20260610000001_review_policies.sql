-- ============================================================================
-- The autonomy dial — one governable HITL policy per surface.
--
-- SingleStack's identity is human-in-the-loop, but "how much the AI may do
-- before a human ratifies" was hard-coded and forked three ways (proposals,
-- intel_updates, direct inserts). This makes it ONE explicit, per-org,
-- per-surface policy — the control an enterprise buyer asks about on the first
-- call, and the unification of the graduated-autonomy machinery that already
-- exists.
--
-- Surfaces (the three HITL grammars):
--   records       — agent proposals on product/GTM records (proposals)
--   intelligence  — synthesized theme changes (intel_updates)
--   automations   — workflow runs fired by events (workflow_runs)
-- Modes (graduated):
--   propose_only  — everything queues for a human (the safe default, today)
--   auto_low      — low-risk maintenance auto-applies; judgment calls queue
--   autonomous    — the AI acts, with a full audit trail; humans review after
--
-- Absent row ⇒ propose_only. Flows read this and act accordingly; new flows
-- adopt it incrementally. Org-isolated by RLS.
-- ============================================================================

create table review_policies (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  surface     text not null,
  mode        text not null default 'propose_only',
  updated_at  timestamptz not null default now(),
  updated_by  text,

  unique (org_id, surface),
  constraint review_policies_surface_chk check (surface in ('records', 'intelligence', 'automations')),
  constraint review_policies_mode_chk    check (mode in ('propose_only', 'auto_low', 'autonomous'))
);
comment on table review_policies is 'Per-org, per-surface autonomy policy (the autonomy dial). Absent row = propose_only. Flows read mode for their surface and apply graduated autonomy accordingly.';

create index review_policies_org_idx on review_policies (org_id);

alter table review_policies enable row level security;
create policy review_policies_org_isolation on review_policies for all
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());
