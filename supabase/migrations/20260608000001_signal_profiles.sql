-- ============================================================================
-- Signal Profiles — the HITL, editable record of "your place in the market."
--
-- Competitive intel today is atomic (signals) + tactical (battlecards, matrix).
-- The Signal Profile is the SYNTHESIS: a living, human-editable profile built
-- from internal AND external signals that states where you actually sit — and
-- is meant to dictate product + GTM strategy.
--
-- Two scopes:
--   • landscape  — one per org: the overall competitive landscape & our place.
--   • competitor — one per competitor: positioning, strengths, how we win/lose.
--
-- Fields live in a child table (mirrors record_fields) so the section set is
-- dynamic — humans edit freely and AI (synthesize-profile) can add/refresh
-- fields. Everything org-scoped via RLS, same as the rest of the platform.
-- ============================================================================

create table signal_profiles (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  scope         text not null default 'competitor',          -- landscape | competitor
  competitor_id uuid references competitors (id) on delete cascade,
  headline      text,                                          -- the one-line "where we sit"

  constraint signal_profiles_scope_shape check (
    (scope = 'landscape'  and competitor_id is null) or
    (scope = 'competitor' and competitor_id is not null)
  )
);

-- One landscape profile per org; one profile per competitor.
create unique index signal_profiles_one_landscape on signal_profiles (org_id) where scope = 'landscape';
create unique index signal_profiles_one_per_competitor on signal_profiles (competitor_id) where scope = 'competitor';
create index signal_profiles_org_id_idx on signal_profiles (org_id);

comment on table signal_profiles is 'HITL competitive-landscape profiles synthesized from internal+external signals. One landscape per org + one per competitor. Meant to dictate product & GTM strategy.';
comment on column signal_profiles.headline is 'One-line summary of where we sit (landscape) or our standing vs this competitor.';

alter table signal_profiles enable row level security;
create policy signal_profiles_org_isolation on signal_profiles
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- ---- profile fields (dynamic sections; mirrors record_fields) ---------------
create table signal_profile_fields (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  created_at  timestamptz not null default now(),

  profile_id  uuid not null references signal_profiles (id) on delete cascade,
  field_key   text not null,            -- snake_case stable key, e.g. 'positioning'
  label       text not null,            -- human label
  value       text,                     -- the content (markdown)
  position    int  not null default 0,  -- display order
  origin      text not null default 'human',  -- human | ai (who last wrote it)

  unique (profile_id, field_key)
);

create index signal_profile_fields_profile_idx on signal_profile_fields (profile_id);
comment on table signal_profile_fields is 'Dynamic sections of a Signal Profile (positioning, strengths, vulnerabilities, how-we-win, implications…). Human-editable; AI can refresh.';

alter table signal_profile_fields enable row level security;
create policy signal_profile_fields_org_isolation on signal_profile_fields
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());
