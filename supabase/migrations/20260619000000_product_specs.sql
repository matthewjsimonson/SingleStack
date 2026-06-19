-- ============================================================================
-- product_specs — the product-side mirror of messaging_artifacts.
-- The GTM workflow turns a NEW input into a messaging brief (Review), tailors it
-- into content (Tailor), and assigns it to a campaign (Assign). The PRODUCT side,
-- through a technical-PM-who-ships lens, runs the same spine: a product signal-
-- theme (the input a PM triages) is molded into a SPEC/PRD (Review), tailored into
-- build work via the spec-driven/ADR/prototyping playbooks (Tailor), and assigned
-- to a RELEASE to ship (Assign). product_specs is that missing middle: one moldable
-- spec per product theme, grounded in the product record (what it is + its technical
-- constraints), that the build work pulls from.
--
-- Mirrors messaging_artifacts (20260618010000) but theme-only (releases are the
-- ASSIGN destination here, not the input), grounded in the product record.
-- ============================================================================

create table if not exists product_specs (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  theme_id     uuid references signal_themes (id) on delete cascade,      -- the input
  product_id   uuid references product_records (id) on delete set null,   -- grounding
  persona_id   uuid references personas (id) on delete set null,          -- who it's for

  title        text,
  body         text not null default '',        -- the moldable spec, markdown
  status       text not null default 'draft',    -- draft | ratified | live
  ratified_at  timestamptz,
  ratified_by  text,

  constraint product_specs_status_shape check (status in ('draft', 'ratified', 'live'))
);

comment on table product_specs is 'Product-side mirror of messaging_artifacts: one moldable spec/PRD per product signal-theme, grounded in the product record, that build work (Tailor) is produced from and shipped in a release (Assign).';

create index if not exists product_specs_org_id_idx on product_specs (org_id);
create index if not exists product_specs_theme_id_idx on product_specs (theme_id);
-- One current spec per theme (the Review inbox maps 1:1 to its input).
create unique index if not exists product_specs_theme_uniq
  on product_specs (theme_id) where theme_id is not null;

alter table product_specs enable row level security;

create policy product_specs_org_isolation on product_specs
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- Tailor produces build work from a spec; link it back so the product Tailor/Assign
-- boards can scope to a spec (the build item has no release yet — that's chosen in
-- Assign). Mirrors how content workstreams carry release_id. Additive only.
alter table initiative_workstreams
  add column if not exists spec_id uuid references product_specs (id) on delete set null;

comment on column initiative_workstreams.spec_id is 'For build work produced by the product Tailor step: the product_specs row it was tailored from. Lets Assign scope to spec-derived work and route it to a release.';
