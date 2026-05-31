-- ============================================================================
-- Compounding intelligence — themes that live, accrue, and remember.
-- Plain English: a theme was a derived row that got DELETED and regenerated on
-- every synthesis — so intelligence had no memory. This makes a theme a living
-- entity: it has a lifecycle state and momentum, its evidence accrues over time
-- as a real relationship (theme_signals), and every change is logged in an
-- append-only trajectory (theme_events). Synthesis becomes reconciliation
-- (attach/escalate/merge/decay/new) instead of delete-and-replace.
--
-- Fully additive: signal_themes.signal_ids[] stays and is kept in sync, so the
-- current Signals UI keeps working while the living surfaces come online.
-- ============================================================================

-- ---- 1) signal_themes gains memory -----------------------------------------
alter table signal_themes add column if not exists state text not null default 'active';
alter table signal_themes add column if not exists momentum text not null default 'steady';
alter table signal_themes add column if not exists first_seen_at timestamptz not null default now();
alter table signal_themes add column if not exists last_evidence_at timestamptz;

alter table signal_themes drop constraint if exists signal_themes_state_shape;
alter table signal_themes add constraint signal_themes_state_shape
  check (state in ('emerging', 'active', 'escalating', 'steady', 'fading', 'dormant'));

alter table signal_themes drop constraint if exists signal_themes_momentum_shape;
alter table signal_themes add constraint signal_themes_momentum_shape
  check (momentum in ('accelerating', 'steady', 'fading'));

comment on column signal_themes.state is 'Lifecycle: emerging | active | escalating | steady | fading | dormant. Set by reconciliation; escalations are human-ratified.';
comment on column signal_themes.momentum is 'Derived trajectory from evidence arrival rate: accelerating | steady | fading.';
comment on column signal_themes.last_evidence_at is 'When evidence was most recently attached — drives momentum and "last evidence Nh ago".';

-- ---- 2) theme_signals: evidence as a temporal relationship -----------------
create table theme_signals (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  created_at  timestamptz not null default now(),

  theme_id    uuid not null references signal_themes (id) on delete cascade,
  signal_id   uuid not null references signals (id) on delete cascade,
  added_at    timestamptz not null default now(),  -- when this evidence joined the theme
  weight      numeric(3,2),                         -- optional strength of support (0..1)

  unique (theme_id, signal_id),
  constraint theme_signals_weight_range check (weight is null or (weight >= 0 and weight <= 1))
);

comment on table theme_signals is 'Evidence accrual: which signals support a theme and WHEN each joined. The source of truth that makes momentum and "+N this week" real. signal_themes.signal_ids[] is kept in sync for the legacy UI.';

create index theme_signals_org_id_idx on theme_signals (org_id);
create index theme_signals_theme_id_idx on theme_signals (theme_id);
create index theme_signals_signal_id_idx on theme_signals (signal_id);
create index theme_signals_added_at_idx on theme_signals (added_at desc);

alter table theme_signals enable row level security;
create policy theme_signals_org_isolation on theme_signals
  for all using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

-- ---- 3) theme_events: the append-only trajectory (the memory) --------------
create table theme_events (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  created_at  timestamptz not null default now(),

  theme_id    uuid not null references signal_themes (id) on delete cascade,
  kind        text not null,   -- created | evidence_added | escalated | state_changed | summary_updated | merged_in | decayed | recommendation_changed
  detail      jsonb,           -- e.g. {"from":"active","to":"escalating"} or {"added":3}
  actor       text             -- 'synthesis' | a human name | an agent key
);

comment on table theme_events is 'Append-only trajectory of a theme: every evidence add, state change, merge, decay. This is the theme''s MEMORY — the detail timeline and "escalating for Nw" read from here. Never overwritten.';

create index theme_events_org_id_idx on theme_events (org_id);
create index theme_events_theme_id_idx on theme_events (theme_id);
create index theme_events_created_at_idx on theme_events (created_at desc);

alter table theme_events enable row level security;
create policy theme_events_org_isolation on theme_events
  for all using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

-- ---- 4) backfill: make existing themes "living" without data loss ----------
-- Materialize each theme's current signal_ids[] into theme_signals (added_at =
-- the theme's created_at, since we don't have per-signal join history yet).
insert into theme_signals (org_id, theme_id, signal_id, added_at)
select t.org_id, t.id, sid, t.created_at
  from signal_themes t
  cross join lateral unnest(coalesce(t.signal_ids, '{}')) as sid
  join signals s on s.id = sid       -- guard against stale ids
 where not exists (
   select 1 from theme_signals ts where ts.theme_id = t.id and ts.signal_id = sid
 );

-- Seed first_seen_at / last_evidence_at from what we know.
update signal_themes t
   set first_seen_at = t.created_at,
       last_evidence_at = coalesce(
         (select max(ts.added_at) from theme_signals ts where ts.theme_id = t.id),
         t.created_at
       );

-- A 'created' event for each existing theme so the trajectory has an origin.
insert into theme_events (org_id, theme_id, kind, detail, actor, created_at)
select t.org_id, t.id, 'created',
       jsonb_build_object('backfilled', true, 'signals', coalesce(array_length(t.signal_ids, 1), 0)),
       'synthesis', t.created_at
  from signal_themes t
 where not exists (select 1 from theme_events e where e.theme_id = t.id and e.kind = 'created');
