-- ============================================================================
-- tracking_topics — what a human declares they want to watch, in plain language.
-- Plain English: signals shouldn't only be AI-driven. A person describes, in
-- natural language, what they care about tracking ("competitor pricing moves",
-- "AI-native procurement trends"). Each topic has a category (signals /
-- competitive / market) so it powers the right Intelligence tab, an optional
-- area focus (product/gtm), and a status. The AI both serves these topics AND
-- flags blind spots — topics it thinks you're missing (origin='ai_suggested',
-- which a human can accept). Human + AI, in the loop.
-- ============================================================================

create table tracking_topics (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  created_at  timestamptz not null default now(),

  category    text not null default 'signals',   -- signals | competitive | market
  prompt      text not null,                      -- the natural-language description
  focus       text,                               -- optional: product | gtm | null (org-wide)
  origin      text not null default 'human',      -- human | ai_suggested
  status      text not null default 'active',     -- active | suggested | dismissed
  metadata    jsonb
);

comment on table tracking_topics is 'Human-declared (natural language) things to track, by category (signals/competitive/market). AI also writes origin=ai_suggested topics as blind-spot flags a human can accept. Powers the Intelligence tabs.';

create index tracking_topics_org_id_idx on tracking_topics (org_id);
create index tracking_topics_category_idx on tracking_topics (category);

alter table tracking_topics enable row level security;
create policy tracking_topics_org_isolation on tracking_topics for all
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

-- signal_themes already has a 'category' (product|gtm). Add the intelligence
-- domain so themes can also be classified competitive/market when synthesized
-- from those lenses. (Additive; existing product/gtm themes unaffected.)
alter table signal_themes add column if not exists domain text not null default 'signals';
comment on column signal_themes.domain is 'Which Intelligence tab the theme belongs to: signals | competitive | market.';

-- signals: add metadata so a signal can be tagged with its intelligence domain
-- (competitive | market) and carry other freeform attributes.
alter table signals add column if not exists metadata jsonb;
comment on column signals.metadata is 'Freeform attributes, e.g. {"domain":"competitive"} to route a signal to an Intelligence tab.';
