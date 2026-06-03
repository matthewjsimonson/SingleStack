-- ============================================================================
-- plays — configurable definitions of the typed analyses agents run.
--
-- A Play binds an OFFICER (agent) + an analytical FOCUS (the lens) to a target
-- type, producing a structured artifact (the output shape lives in code). Until
-- now the four competitive Plays were hardcoded in the run-play edge function —
-- invisible and unconfigurable. Making them rows gives each org VISIBILITY into
-- how its plays run and the ability to TUNE them (which officer, what focus,
-- which sections, on/off) without a deploy.
--
-- run-play reads the row by (org_id, key) and uses it; if no row exists it falls
-- back to the code defaults, so existing orgs keep working with zero seeding.
--
-- Conventions match the existing codebase (org_id + created_at + RLS via
-- public.current_org_id()), not the fuller schema-skill spine, for consistency.
-- ============================================================================

create table plays (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  key          text not null,                 -- stable: product_standing | build_to_beat | narrative_angle | win_plan
  label        text not null,
  agent_id     uuid references agents (id) on delete set null,  -- the officer that runs it
  target_type  text not null default 'competitor',
  focus        text not null,                 -- the analytical instruction (the lens)
  sections     text,                          -- suggested best-practice sections (hint)
  is_active    boolean not null default true,
  position     integer not null default 0,

  unique (org_id, key)
);

comment on table plays is 'Configurable Play definitions (officer + focus + sections per target type). run-play reads these, falling back to code defaults when absent. The output JSON shape stays in code.';

create index plays_org_id_idx on plays (org_id);

alter table plays enable row level security;

create policy plays_org_isolation on plays
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());
