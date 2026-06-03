-- ============================================================================
-- Build module foundation (Phase 1 schema).
--
-- Plain English: the Build module fuses traditional product management
-- (roadmap, releases, scoped work) with an AI-augmented build workflow (scopes
-- structured to feed coding agents). It is NOT greenfield — ~70% already
-- exists and we EXTEND it rather than duplicate:
--
--   • "Build Item" = an `initiatives` row (the codebase already calls it that).
--     Its type lives in initiatives.kind; its Product Scope (Why/What/How/Proof)
--     lives in initiative_fields; its evidence lives in initiative_signals.
--   • "Release" = a `releases` row (the roadmap unit a Build Item ships in).
--   • "Initiative (strategic theme)" = an `objectives` row, linked via
--     initiatives.objective_id. (UI vocabulary maps Build Item↔initiatives and
--     Initiative/Theme↔objectives; table names are unchanged by design.)
--
-- This migration adds only the genuinely-new pieces:
--   1. Formalize the Build Item TYPE discriminator (initiatives.kind + CHECK).
--   2. Re-establish Build Item → Release containment (initiatives.release_id).
--   3. Roadmap horizon buckets + release metadata (releases: roadmap_bucket,
--      theme, owner_id).
--   4. Agent-readiness STATE machine (initiatives.build_state).
--   5. Fix evidence flag (initiatives.is_unevidenced).
--   6. TECHNICAL SCOPE context bundle (build_context_links) — the executable
--      context package for a coding agent. NEW table.
--   7. Plays → Build Items: proposals can now target an initiative.
--   8. Ratification reach: ratifications can now point at an initiative_field
--      (Build Item scope is ratified field-by-field, exactly like records).
--
-- Conventions follow the existing codebase (3-column spine, text + CHECK, RLS
-- via public.current_org_id()), not the schema skill's idealized 6-column spine
-- — for consistency with all prior migrations. Downstream ship effects
-- (Product/GTM/Campaign/CI/objective propagation) are deferred to Phase 6.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Build Item TYPE discriminator.
--    UI surfaces four types — Fix (bugfix), Enhancement (enhancement),
--    New Feature (feature), New Module (module). 'product' stays valid for
--    legacy rows. NULL allowed so the constraint never rejects existing data.
-- ----------------------------------------------------------------------------
alter table initiatives drop constraint if exists initiatives_kind_shape;
alter table initiatives add constraint initiatives_kind_shape
  check (kind is null or kind in ('feature', 'module', 'product', 'enhancement', 'bugfix'));

comment on column initiatives.kind is
  'Build Item type discriminator: bugfix(=Fix) | enhancement | feature(=New Feature) | module(=New Module). "product" kept for legacy.';


-- ----------------------------------------------------------------------------
-- 2. Build Item → Release containment.
--    initiatives.release_id was dropped in 20260603070000 (release tagging moved
--    to tasks). The Build model wants a Build Item to BELONG to a Release, so we
--    restore it. Task-level initiative_workstreams.release_id remains for the
--    granular per-task changelog rollup.
-- ----------------------------------------------------------------------------
alter table initiatives add column if not exists release_id uuid references releases (id) on delete set null;
comment on column initiatives.release_id is 'The Release this Build Item ships in (Release contains 1+ Build Items).';
create index if not exists initiatives_release_id_idx on initiatives (release_id);


-- ----------------------------------------------------------------------------
-- 3. Roadmap horizon buckets + release metadata.
--    roadmap_bucket (now|soon|later) is the PLANNING HORIZON — the three-column
--    Roadmap view. It is a different axis from releases.stage (dev STATUS:
--    planned|in_dev|released), which we keep. Plus theme + owner.
-- ----------------------------------------------------------------------------
alter table releases add column if not exists roadmap_bucket text not null default 'later';
alter table releases drop constraint if exists releases_roadmap_bucket_shape;
alter table releases add constraint releases_roadmap_bucket_shape
  check (roadmap_bucket in ('now', 'soon', 'later'));

alter table releases add column if not exists theme    text;
alter table releases add column if not exists owner_id uuid references people (id) on delete set null;

comment on column releases.roadmap_bucket is 'Roadmap planning horizon: now | soon | later (the three-column Roadmap). Distinct from stage (dev status).';
comment on column releases.theme    is 'Optional release theme, e.g. "Pricing & onboarding".';
comment on column releases.owner_id is 'The human accountable for the release.';

create index if not exists releases_org_bucket_idx on releases (org_id, roadmap_bucket);
create index if not exists releases_owner_idx       on releases (owner_id);


-- ----------------------------------------------------------------------------
-- 4. Agent-readiness STATE machine (build execution axis).
--    proposed → scoped → ready_for_agent → in_build → shipped.
--    "proposed" is the pre-ratification Proposal (a proposals row, not yet an
--    initiative); on ratification a Build Item is created at 'scoped'. So
--    initiatives.build_state covers the four post-ratification states. NULL for
--    rows not (yet) managed on the build axis, so the constraint is non-breaking.
--    Reaching 'ready_for_agent' is gated by the Technical Scope completeness
--    check (computed in-app: context bundle present, skills referenced,
--    acceptance criteria prompt-ready, test approach defined).
-- ----------------------------------------------------------------------------
alter table initiatives add column if not exists build_state text;
alter table initiatives drop constraint if exists initiatives_build_state_shape;
alter table initiatives add constraint initiatives_build_state_shape
  check (build_state is null or build_state in ('scoped', 'ready_for_agent', 'in_build', 'shipped'));

comment on column initiatives.build_state is
  'Build-execution readiness: scoped | ready_for_agent | in_build | shipped. (proposed = a proposals row, pre-ratification.) Gated to ready_for_agent by Technical Scope completeness.';
create index if not exists initiatives_build_state_idx on initiatives (build_state);


-- ----------------------------------------------------------------------------
-- 5. Fix evidence flag.
--    Fix Build Items should carry Signal evidence (initiative_signals). Manual,
--    un-evidenced entry is allowed but flagged visibly.
-- ----------------------------------------------------------------------------
alter table initiatives add column if not exists is_unevidenced boolean not null default false;
comment on column initiatives.is_unevidenced is
  'For Fix Build Items: true when scope was entered manually with no linked Signal evidence (surfaced as a visible flag).';


-- ----------------------------------------------------------------------------
-- 6. TECHNICAL SCOPE — the context bundle (NEW table).
--    Technical Scope is an executable context PACKAGE for a coding agent, not a
--    prose spec. Its prose parts (prompt, prompt-ready acceptance criteria, test
--    approach) reuse initiative_fields under a "Technical" section — no schema
--    needed. Its structural part — the linked files / entities / skills / schema
--    deltas — is this table.
--
--    The bundle is heterogeneous by requirement: it links to ANY entity in the
--    hub-and-spoke graph (a product_record, a module, a feature, a source, a
--    gtm_record, …) plus repo file paths, skill names, and declared schema
--    deltas. We therefore use a polymorphic (ref_table, ref_id) pointer for
--    entity links — a deliberate, documented exception to "real FK always",
--    following the schema skill's own ratifications(artifact_table, artifact_id)
--    precedent (§9). This keeps the bundle extensible without N nullable FKs.
-- ----------------------------------------------------------------------------
create table build_context_links (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  created_at    timestamptz not null default now(),

  initiative_id uuid not null references initiatives (id) on delete cascade,

  kind          text not null,   -- file_path | entity_ref | skill_ref | schema_delta

  -- entity_ref: polymorphic pointer, resolved in app (see header note).
  ref_table     text,            -- e.g. 'product_records' | 'modules' | 'features' | 'gtm_records' | 'sources' | 'signals'
  ref_id        uuid,            -- the referenced row's id

  -- file_path / skill_ref / schema_delta: free text payload.
  path          text,            -- repo file path, skill name, or URL
  label         text,            -- display label
  note          text,            -- why it's in the bundle / how the agent should use it
  position      integer not null default 0,

  constraint build_context_links_kind_shape
    check (kind in ('file_path', 'entity_ref', 'skill_ref', 'schema_delta')),
  constraint build_context_links_payload_shape check (
    (kind = 'entity_ref' and ref_table is not null and ref_id is not null)
    or (kind in ('file_path', 'skill_ref') and path is not null)
    or (kind = 'schema_delta')
  )
);

comment on table build_context_links is
  'Technical Scope context bundle for a Build Item (initiative): the files, entities, skills, and schema deltas a coding agent needs. Heterogeneous by design; entity links are polymorphic (ref_table, ref_id) per the ratification precedent.';
comment on column build_context_links.kind is 'file_path | entity_ref | skill_ref | schema_delta.';

create index build_context_links_org_id_idx     on build_context_links (org_id);
create index build_context_links_initiative_idx on build_context_links (initiative_id);
create index build_context_links_kind_idx        on build_context_links (initiative_id, kind);

alter table build_context_links enable row level security;
create policy build_context_links_org_isolation on build_context_links for all
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());


-- ----------------------------------------------------------------------------
-- 7. Plays → Build Items: proposals can target an initiative.
--    proposals currently target exactly one of {product_record, gtm_record}.
--    Bug Triage / Competitive Gap / Customer Request plays propose Build Items,
--    so add initiative_id as a third target and widen the one-target rule.
-- ----------------------------------------------------------------------------
alter table proposals add column if not exists initiative_id uuid references initiatives (id) on delete cascade;

alter table proposals drop constraint if exists proposals_one_target;
alter table proposals add constraint proposals_one_target check (
  (product_id is not null)::int
  + (gtm_record_id is not null)::int
  + (initiative_id is not null)::int = 1
);

comment on column proposals.initiative_id is 'Target when the proposal is a candidate Build Item (e.g. from Bug Triage / Competitive Gap / Customer Request plays).';
create index if not exists proposals_initiative_id_idx on proposals (initiative_id);


-- ----------------------------------------------------------------------------
-- 8. Ratification reach: ratify Build Item scope fields.
--    ratifications point at record_fields today. Build Item scope lives in
--    initiative_fields (same pattern), so add initiative_field_id as a second,
--    mutually-exclusive target. This keeps ratification field-level and lets
--    scope completion be ratified field-by-field — the consensus layer, not a
--    sign-off checkbox.
-- ----------------------------------------------------------------------------
alter table ratifications add column if not exists initiative_field_id uuid references initiative_fields (id) on delete cascade;
alter table ratifications alter column record_field_id drop not null;

alter table ratifications drop constraint if exists ratifications_one_target;
alter table ratifications add constraint ratifications_one_target check (
  (record_field_id is not null)::int + (initiative_field_id is not null)::int = 1
);

comment on column ratifications.initiative_field_id is 'Ratification target when the field is a Build Item scope field (initiative_fields), parallel to record_field_id.';
create index if not exists ratifications_initiative_field_id_idx on ratifications (initiative_field_id);
