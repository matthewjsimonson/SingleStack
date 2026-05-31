-- ============================================================================
-- Map dimensions — make intelligence ADDRESSABLE: who it's for, how soon it
-- matters, and which strategic bet it serves. These let the Intelligence Map
-- position things by MEANING (semantic projection), and are independently
-- valuable even without the map ("show me everything owned by GTM, near-term,
-- serving the enterprise-expansion objective").
--
-- All additive and nullable — nothing is forced. Agents PROPOSE values (horizon,
-- owner, objective) which a human ratifies, same graduated HITL as themes.
-- ============================================================================

-- ---- horizon + owner on themes ---------------------------------------------
alter table signal_themes add column if not exists horizon text;   -- now | next | future | null
alter table signal_themes add column if not exists owner_team text; -- free text team/person for now ("GTM", "M. Schmidt")

alter table signal_themes drop constraint if exists signal_themes_horizon_shape;
alter table signal_themes add constraint signal_themes_horizon_shape
  check (horizon is null or horizon in ('now','next','future'));

comment on column signal_themes.horizon is 'How soon this matters: now | next | future. NULL = unset. A positional axis on the Situational map.';
comment on column signal_themes.owner_team is 'Who this is for — team or person responsible. Free text for now; territory shading on the Accountability map. NULL = unowned (a gap agents can flag).';

create index if not exists signal_themes_horizon_idx on signal_themes (horizon);
create index if not exists signal_themes_owner_idx on signal_themes (owner_team);

-- ---- objectives: the strategic bets things serve ---------------------------
create table objectives (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  created_at  timestamptz not null default now(),

  title       text not null,            -- e.g. "Win the AI-native category before competitors consolidate"
  pillar      text,                      -- optional grouping, e.g. "Growth" | "Defense" | "Expansion"
  description text,
  status      text not null default 'active',  -- active | achieved | retired
  position    integer not null default 0,

  constraint objectives_status_shape check (status in ('active','achieved','retired'))
);

comment on table objectives is 'Strategic bets/objectives the org is steering toward. Themes and decisions link to one via *_objective_id — "what bet does this serve". The Y-axis of the Accountability map.';

create index objectives_org_id_idx on objectives (org_id);

alter table objectives enable row level security;
create policy objectives_org_isolation on objectives
  for all using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

-- Link themes and decisions to an objective (nullable — not everything serves one).
alter table signal_themes add column if not exists objective_id uuid references objectives (id) on delete set null;
alter table decisions     add column if not exists objective_id uuid references objectives (id) on delete set null;

comment on column signal_themes.objective_id is 'The strategic objective this theme serves (what bet it advances). NULL = unaligned. Positions the theme on the Accountability map.';
comment on column decisions.objective_id is 'The strategic objective this decision serves.';

create index if not exists signal_themes_objective_idx on signal_themes (objective_id);
create index if not exists decisions_objective_idx on decisions (objective_id);

-- ---- let agents PROPOSE dimension values through the same review queue ------
-- A 'set_dimension' intel_update carries {field: horizon|owner_team|objective,
-- value, value_label} in its payload, targeting a theme. Humans ratify it on the
-- same "Review intelligence updates" surface — agents shape the terrain, humans
-- confirm. (resolve-intel-update applies it; see that function.)
alter table intel_updates drop constraint if exists intel_updates_kind_shape;
alter table intel_updates add constraint intel_updates_kind_shape
  check (kind in ('new_theme','escalate','merge','decay','restate','set_dimension'));
