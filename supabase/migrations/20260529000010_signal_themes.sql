-- ============================================================================
-- signal_themes — AI-synthesized patterns across signals.
-- Plain English: the Signals homepage isn't a feed, it's a dashboard. An agent
-- reads ALL of an org's signals (internal + external) and synthesizes them into
-- THEMES — recurring patterns worth acting on. Each theme is categorized
-- (product vs gtm), carries a plain-English summary and a prescriptive
-- recommended action, a confidence, and links to the signals that support it.
-- Re-synthesizing replaces the prior set (it's a derived, refreshable view).
-- ============================================================================

create table signal_themes (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  created_at   timestamptz not null default now(),

  category     text not null default 'product',   -- 'product' | 'gtm'
  title        text not null,                      -- the theme, e.g. "Pricing friction post-demo"
  summary      text,                               -- what the pattern is, in plain English
  recommendation text,                             -- the prescriptive "so do this"
  conf_level   numeric(3,2),                       -- 0..1
  signal_ids   uuid[] default '{}',                -- supporting signals
  position     integer not null default 0,

  constraint signal_themes_conf_range check (conf_level is null or (conf_level >= 0 and conf_level <= 1))
);

comment on table signal_themes is 'AI-synthesized themes across an org''s signals (product vs gtm), each with a summary, a prescriptive recommendation, confidence, and supporting signal ids. A refreshable derived view powering the Signals homepage dashboard.';

create index signal_themes_org_id_idx on signal_themes (org_id);
create index signal_themes_category_idx on signal_themes (category);

alter table signal_themes enable row level security;

create policy signal_themes_org_isolation on signal_themes
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());
