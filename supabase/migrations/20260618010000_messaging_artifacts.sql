-- ============================================================================
-- messaging_artifacts — the missing middle of the GTM machine.
-- Plain English: when something NEW happens — a product release (a new feature/
-- module/tool) or a signal — someone has to do the MESSAGING for it before the
-- org can execute. That messaging didn't have a home: the GTM record holds the
-- framework (positioning, pillars, personas) as durable CONTEXT, and
-- initiative_workstreams hold the finished deliverables (content/video/etc).
-- Nothing sat in between holding "the messaging built around this release/signal".
-- This is that artifact: one moldable brief per release (or signal), GROUNDED in
-- the GTM record + product record, that downstream content/video/enablement/
-- competitive pull from (today via the shared release_id).
-- ============================================================================

create table if not exists messaging_artifacts (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- the INPUT this messaging is for — exactly one of release or signal-theme
  release_id    uuid references releases (id) on delete cascade,
  theme_id      uuid references signal_themes (id) on delete cascade,

  -- the GROUNDING used to author it (context, not edited here)
  gtm_record_id uuid references gtm_records (id) on delete set null,
  product_id    uuid references product_records (id) on delete set null,

  title         text,
  body          text not null default '',   -- the moldable brief, markdown
  status        text not null default 'draft',  -- draft | ratified | live
  ratified_at   timestamptz,
  ratified_by   text,

  constraint messaging_artifacts_status_shape
    check (status in ('draft', 'ratified', 'live')),
  -- exactly one source: a brief is for a release OR a signal-theme, never both/neither
  constraint messaging_artifacts_one_source
    check (((release_id is not null)::int + (theme_id is not null)::int) = 1)
);

comment on table messaging_artifacts is 'One moldable messaging brief per release (or signal-theme), grounded in the GTM record + product record. The seed downstream content/video/enablement/competitive execute from (linked via the shared release_id for now).';

create index if not exists messaging_artifacts_org_id_idx on messaging_artifacts (org_id);
create index if not exists messaging_artifacts_release_id_idx on messaging_artifacts (release_id);
create index if not exists messaging_artifacts_theme_id_idx on messaging_artifacts (theme_id);

-- One current brief per release, and per theme (the task list maps 1:1 to the input).
create unique index if not exists messaging_artifacts_release_uniq
  on messaging_artifacts (release_id) where release_id is not null;
create unique index if not exists messaging_artifacts_theme_uniq
  on messaging_artifacts (theme_id) where theme_id is not null;

alter table messaging_artifacts enable row level security;

create policy messaging_artifacts_org_isolation on messaging_artifacts
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());
