-- ============================================================================
-- Roadmap (releases) vs Ship (build/test). Plain English:
--   Roadmap and Ship are different things. ROADMAP is what's coming — releases,
--   versioned, with a target and a stage (planned/in_dev/released): "what the
--   product will be." SHIP is the actual build & test of work — features,
--   modules, products, enhancements, bug fixes — moving through a build
--   pipeline (spec → prototype → build → test → shipped), AI-assisted.
--
--   • releases — the roadmap unit.
--   • initiatives gains: kind (feature/module/product/enhancement/bugfix),
--     build_stage (the Ship pipeline), and release_id (which release it ships
--     in). The 'ship' lane uses build_stage; 'roadmap' work attaches to releases.
-- ============================================================================

create table releases (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  created_at  timestamptz not null default now(),

  product_id  uuid references product_records (id) on delete set null,
  name        text not null,             -- e.g. "v4.4 — Pricing & onboarding"
  version     text,                      -- e.g. "v4.4"
  summary     text,                      -- what this release will be
  stage       text not null default 'planned',  -- planned | in_dev | released
  target_date date,
  position    integer not null default 0
);

comment on table releases is 'Roadmap unit: a versioned release — what the product will be. Initiatives (build items) attach via release_id.';

create index releases_org_id_idx on releases (org_id);
create index releases_product_id_idx on releases (product_id);

alter table releases enable row level security;
create policy releases_org_isolation on releases for all
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

-- Extend initiatives for the Ship build pipeline.
alter table initiatives add column if not exists kind text default 'feature';        -- feature | module | product | enhancement | bugfix
alter table initiatives add column if not exists build_stage text default 'spec';    -- spec | prototype | build | test | shipped
alter table initiatives add column if not exists release_id uuid references releases (id) on delete set null;
alter table initiatives add column if not exists prototype_url text;                 -- link to a vibecoded prototype

comment on column initiatives.kind is 'For Ship: feature | module | product | enhancement | bugfix.';
comment on column initiatives.build_stage is 'Ship build pipeline: spec | prototype | build | test | shipped.';
comment on column initiatives.release_id is 'Which roadmap release this work ships in.';
comment on column initiatives.prototype_url is 'Optional link to a vibecoded/prototyped artifact.';

create index if not exists initiatives_release_id_idx on initiatives (release_id);
