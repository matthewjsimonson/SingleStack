-- ============================================================================
-- Initiatives become cross-functional efforts with Build + GTM workstreams.
--
-- Plain English: an initiative ("competitive catch-up", "feature release", "new
-- module") is one EFFORT that has both product/build work AND go-to-market work.
-- It ladders up to a strategic OBJECTIVE (the bet) and, for large efforts, can
-- have sub-initiatives (parent_id). The per-area execution lives in
-- initiative_workstreams (area = build | gtm), each with its own owner + stage —
-- this is what the Build (Ship/Roadmap) and GTM (Enablement/Content) sections
-- render. The old initiatives.lane stays for back-compat during cutover.
-- ============================================================================

alter table initiatives add column if not exists objective_id uuid references objectives (id) on delete set null;
alter table initiatives add column if not exists parent_id    uuid references initiatives (id) on delete set null;
create index if not exists initiatives_objective_idx on initiatives (objective_id);
create index if not exists initiatives_parent_idx    on initiatives (parent_id);

create table initiative_workstreams (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  created_at    timestamptz not null default now(),
  initiative_id uuid not null references initiatives (id) on delete cascade,
  area          text not null default 'build',   -- build | gtm
  title         text not null,
  description   text,
  assignee_id   uuid references people (id) on delete set null,
  stage         text not null default 'backlog', -- backlog | active | done
  position      integer not null default 0,

  constraint initiative_workstreams_area_shape check (area in ('build', 'gtm'))
);

comment on table initiative_workstreams is 'The per-area (build | gtm) execution of a cross-functional initiative, each with its own owner + stage. Build/GTM boards render these; the initiative is the parent effort.';

create index initiative_workstreams_org_id_idx on initiative_workstreams (org_id);
create index initiative_workstreams_initiative_idx on initiative_workstreams (initiative_id);
create index initiative_workstreams_assignee_idx on initiative_workstreams (assignee_id);

alter table initiative_workstreams enable row level security;
create policy initiative_workstreams_org_isolation on initiative_workstreams for all
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());
