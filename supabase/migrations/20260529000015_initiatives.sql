-- ============================================================================
-- initiatives — the unit of work in Build and Go-to-market.
-- Plain English: the Build (Roadmap/Ship) and Go-to-market (Content/Enablement)
-- sections organize work into initiatives. An initiative belongs to a lane
-- (roadmap | ship | content | enablement), has a stage on its board, an optional
-- tie to a product or GTM record, and a priority. Signals/themes map to
-- initiatives via initiative_signals — closing the loop: intel informs the work.
-- All org-scoped with RLS.
-- ============================================================================

create table initiatives (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  created_at    timestamptz not null default now(),

  lane          text not null default 'roadmap',  -- roadmap | ship | content | enablement
  title         text not null,
  description   text,
  stage         text not null default 'backlog',  -- backlog | active | done
  priority      text default 'medium',            -- low | medium | high
  product_id    uuid references product_records (id) on delete set null,
  gtm_record_id uuid references gtm_records (id) on delete set null,
  target_date   date,
  position      integer not null default 0
);

comment on table initiatives is 'Units of work for Build (roadmap/ship) and Go-to-market (content/enablement). Tied to a record; signals map in via initiative_signals.';

create index initiatives_org_id_idx on initiatives (org_id);
create index initiatives_lane_idx on initiatives (lane);

alter table initiatives enable row level security;
create policy initiatives_org_isolation on initiatives for all
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

-- initiative_signals: which signals back an initiative (the intel→work link).
create table initiative_signals (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  created_at    timestamptz not null default now(),

  initiative_id uuid not null references initiatives (id) on delete cascade,
  signal_id     uuid not null references signals (id) on delete cascade,

  unique (initiative_id, signal_id)
);

comment on table initiative_signals is 'Join: the signals that motivate an initiative. Maps intelligence to the work it informs.';

create index initiative_signals_org_id_idx on initiative_signals (org_id);
create index initiative_signals_initiative_id_idx on initiative_signals (initiative_id);
create index initiative_signals_signal_id_idx on initiative_signals (signal_id);

alter table initiative_signals enable row level security;
create policy initiative_signals_org_isolation on initiative_signals for all
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());
