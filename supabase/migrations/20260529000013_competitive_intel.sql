-- ============================================================================
-- Competitive intel structures: competitors, battlecards, capability matrix.
-- Plain English: the Competitive intel tab needs more than a signal feed. This
-- adds the objects behind its sub-tabs:
--   • competitors  — who you're up against, marked direct vs adjacent.
--   • battlecards  — per-competitor (or general) why-we-win / why-we-lose /
--                    objections / traps, as structured items.
--   • capabilities + capability_scores — the product capability matrix /
--                    heat-map: capabilities scored for us and each competitor.
-- All org-scoped with RLS, matching the rest of the schema.
-- ============================================================================

-- ---- competitors -----------------------------------------------------------
create table competitors (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  created_at  timestamptz not null default now(),

  name        text not null,
  relationship text not null default 'direct',   -- direct | adjacent
  website     text,
  notes       text,
  position    integer not null default 0
);

comment on table competitors is 'Competitors tracked by the org, marked direct or adjacent. Power the competitive capability matrix and battlecards.';

create index competitors_org_id_idx on competitors (org_id);

alter table competitors enable row level security;
create policy competitors_org_isolation on competitors for all
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

-- ---- battlecard_items ------------------------------------------------------
-- kind: win | lose | objection | trap | note. competitor_id null = general.
create table battlecard_items (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  created_at    timestamptz not null default now(),

  competitor_id uuid references competitors (id) on delete cascade,
  kind          text not null default 'win',
  title         text not null,
  detail        text,
  position      integer not null default 0
);

comment on table battlecard_items is 'Battlecard entries (why we win/lose, objections, traps), per competitor or general.';

create index battlecard_items_org_id_idx on battlecard_items (org_id);
create index battlecard_items_competitor_id_idx on battlecard_items (competitor_id);

alter table battlecard_items enable row level security;
create policy battlecard_items_org_isolation on battlecard_items for all
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

-- ---- capabilities + scores (the matrix / heat-map) -------------------------
create table capabilities (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  created_at  timestamptz not null default now(),

  name        text not null,
  category    text,
  position    integer not null default 0
);

comment on table capabilities is 'Rows of the competitive capability matrix — the features/areas compared across us and competitors.';

create index capabilities_org_id_idx on capabilities (org_id);

alter table capabilities enable row level security;
create policy capabilities_org_isolation on capabilities for all
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

-- capability_scores: one cell of the matrix. competitor_id null = "us".
-- score 0..3 (none/partial/good/strong) renders as the heat-map intensity.
create table capability_scores (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  created_at    timestamptz not null default now(),

  capability_id uuid not null references capabilities (id) on delete cascade,
  competitor_id uuid references competitors (id) on delete cascade,  -- null = us
  score         integer not null default 0,   -- 0..3
  note          text,

  unique (capability_id, competitor_id)
);

comment on table capability_scores is 'A cell in the capability matrix: how a capability scores for us (competitor_id null) or a competitor. 0..3 drives the heat-map.';

create index capability_scores_org_id_idx on capability_scores (org_id);
create index capability_scores_capability_id_idx on capability_scores (capability_id);

alter table capability_scores enable row level security;
create policy capability_scores_org_isolation on capability_scores for all
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());
