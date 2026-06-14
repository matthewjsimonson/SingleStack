-- Migration: plg_areas
-- Purpose: the governed knowledge layer — canonical PLG areas + their tasks as
--   first-class, org-scoped rows (docs/architecture/agent-orchestration.md, P1).
--   The area vocabulary stops being hardcoded TS / free-text / jsonb and becomes
--   one thing that connections, skills, signals, and workflow steps reference by FK.
-- Conventions: matches the established sibling tables (skills/connections/workflows)
--   — spine = id, org_id, created_at; RLS via public.current_org_id(); org_id index.
-- Author: SingleStack · Date: 2026-06-14
-- NOTE: additive only (no backfill). Binding existing tables to areas is P2.

-- 1. Circle enum (product = the PM areas; gtm = the PMM areas).
do $$ begin
  create type area_circle as enum ('product', 'gtm');
exception when duplicate_object then null; end $$;

-- 2. areas — the canonical PLG areas (the vocabulary, per org).
create table if not exists public.areas (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null,
  created_at     timestamptz not null default now(),

  key            text not null,              -- stable id, e.g. 'build_ship'
  label          text not null,
  circle         area_circle not null,
  record_section text,                       -- the record section it maintains
  flywheel_stage text,                       -- the PLG flywheel stage it drives (gtm)
  blurb          text,
  is_engine      boolean not null default false,  -- the Build engine (execution)
  position       int not null default 0,     -- explicit ordering

  unique (org_id, key)
);
comment on table public.areas is 'Canonical PLG-process areas (product + gtm circles). The governed vocabulary every artifact references; see docs/architecture/agent-orchestration.md.';

create index if not exists areas_org_id_idx on public.areas (org_id);

alter table public.areas enable row level security;
drop policy if exists areas_org_isolation on public.areas;
create policy areas_org_isolation on public.areas for all
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

-- 3. area_tasks — the unit a workflow step covers (promoted from a hardcoded list).
create table if not exists public.area_tasks (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  created_at  timestamptz not null default now(),

  area_id     uuid not null references public.areas (id) on delete cascade,
  key         text not null,
  label       text not null,
  position    int not null default 0,

  unique (org_id, area_id, key)
);
comment on table public.area_tasks is 'The concrete tasks within a PLG area — the unit a workflow step covers and coverage is graded against.';

create index if not exists area_tasks_org_id_idx on public.area_tasks (org_id);
create index if not exists area_tasks_area_id_idx on public.area_tasks (org_id, area_id);

alter table public.area_tasks enable row level security;
drop policy if exists area_tasks_org_isolation on public.area_tasks;
create policy area_tasks_org_isolation on public.area_tasks for all
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

-- 4. seed_plg_areas — install the canonical taxonomy for an org (idempotent).
--    Called on org bootstrap (alongside record/agent setup) and safe to re-run.
create or replace function public.seed_plg_areas(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Build / Product circle (PM areas) + GTM circle (PMM areas).
  insert into public.areas (org_id, key, label, circle, record_section, flywheel_stage, blurb, is_engine, position)
  values
    (p_org_id, 'product_truth',  'Product Truth',                'product', 'Overview',           null,                              'A current, accurate product identity.',                                  false, 1),
    (p_org_id, 'capabilities',   'Capabilities & Differentiation','product','Capabilities',       null,                              'Know what it does and where it wins or lags.',                           false, 2),
    (p_org_id, 'technical',      'Technical Foundation',         'product', 'Technical',          null,                              'The buildable truth that grounds every How.',                            false, 3),
    (p_org_id, 'strategy',       'Strategy & Decisions',         'product', 'Strategy',           null,                              'A prioritized, evidence-grounded direction.',                            false, 4),
    (p_org_id, 'build_ship',     'Build & Ship',                 'product', 'Roadmap / Ship',     null,                              'Execution with frontier models — turn decisions into shipped product.',  true,  5),
    (p_org_id, 'positioning',    'Positioning',                  'gtm',     'Positioning',        'frames all',                      'A sharp, defensible market frame.',                                      false, 6),
    (p_org_id, 'messaging',      'Messaging & Value',            'gtm',     'Messaging',          'Acquire / Activate',              'A clear promise + value narratives.',                                    false, 7),
    (p_org_id, 'audience',       'Audience & ICP',               'gtm',     'Buyer',              'targeting',                       'Know exactly who you grow.',                                             false, 8),
    (p_org_id, 'motion',         'Motion & Packaging',           'gtm',     'Motion',             'Convert',                         'The right motion + pricing.',                                            false, 9),
    (p_org_id, 'competitive',    'Competitive',                  'gtm',     'Battlecard',         'Convert',                         'Win competitive deals.',                                                 false, 10),
    (p_org_id, 'demand',         'Demand & Content',             'gtm',     'Content / Campaigns','Acquire / Adopt',                 'Acquisition + adoption assets.',                                         false, 11),
    (p_org_id, 'enablement',     'Enablement',                   'gtm',     'Enablement',         'Convert (assisted)',              'Reps & champions ready to sell.',                                        false, 12),
    (p_org_id, 'lifecycle_pql',  'Lifecycle & PQL',              'gtm',     'Accounts / PQL',     'Activate -> Expand -> Advocate',  'Read the product-led signal; surface PQLs.',                             false, 13)
  on conflict (org_id, key) do nothing;

  insert into public.area_tasks (org_id, area_id, key, label, position)
  select p_org_id, a.id, t.key, t.label, t.position
  from (values
    ('product_truth', 'refresh_overview',     'Refresh Overview from signals',                 1),
    ('product_truth', 'reconcile_drift',      'Reconcile drift in the record',                 2),
    ('product_truth', 'keep_vision',          'Keep vision & strategic intent live',           3),
    ('capabilities',  'maintain_capabilities','Maintain core / differentiated capabilities',   1),
    ('capabilities',  'score_vs_rivals',      'Score capabilities vs rivals',                  2),
    ('capabilities',  'track_frontier',       'Track frontier-model capability',               3),
    ('technical',     'maintain_architecture','Maintain architecture / stack / security',      1),
    ('technical',     'flag_debt',            'Flag tech debt & evolution-watch',              2),
    ('strategy',      'synthesize_themes',    'Synthesize product themes',                     1),
    ('strategy',      'draft_decisions',      'Draft decisions (options + tradeoffs)',         2),
    ('strategy',      'propose_dimensions',   'Propose strategic dimensions',                  3),
    ('strategy',      'bundle_candidates',    'Bundle verified signals into build candidates', 4),
    ('build_ship',    'scope_build',          'Scope the build (Why / What)',                  1),
    ('build_ship',    'plan_approach',        'Plan the approach (How: frontier-aware)',       2),
    ('build_ship',    'build_with_frontier',  'Build with frontier models (the make)',         3),
    ('build_ship',    'ship_release',         'Ship / release',                                4),
    ('build_ship',    'validate_outcomes',    'Validate outcomes -> new signals',              5),
    ('positioning',   'maintain_positioning', 'Maintain category POV / positioning / diff',    1),
    ('positioning',   'sharpen_vs_rivals',    'Sharpen positioning vs rivals',                 2),
    ('messaging',     'maintain_value_prop',  'Maintain value prop + message pillars',         1),
    ('messaging',     'persona_tune',         'Persona-tune; write activation narratives',     2),
    ('audience',      'maintain_icp',         'Maintain ICP, industries, personas',            1),
    ('audience',      'refresh_from_pql',     'Refresh from PQL + market signals',             2),
    ('motion',        'maintain_motion',      'Maintain win themes, GTM motion, pricing',      1),
    ('competitive',   'analyze_rivals',       'Analyze rivals (evidence-cited battlecards)',   1),
    ('competitive',   'draft_seller_copy',    'Draft seller copy (talk track, objections)',    2),
    ('demand',        'draft_content',        'Draft content grounded in the record',          1),
    ('demand',        'run_campaigns',        'Run campaigns',                                 2),
    ('enablement',    'build_enablement',     'Build enablement from ratified facts',          1),
    ('lifecycle_pql', 'ingest_usage',         'Ingest product usage',                          1),
    ('lifecycle_pql', 'score_accounts',       'Score accounts (activation / expansion / churn)',2),
    ('lifecycle_pql', 'qualify_pql',          'Qualify PQLs; emit GTM signals on state change', 3)
  ) as t(area_key, key, label, position)
  join public.areas a on a.org_id = p_org_id and a.key = t.area_key
  on conflict (org_id, area_id, key) do nothing;
end;
$$;

comment on function public.seed_plg_areas(uuid) is 'Installs the canonical PLG area + task taxonomy for an org. Idempotent; call on org bootstrap and safe to backfill existing orgs.';
