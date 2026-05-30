-- ============================================================================
-- Go-to-market content + campaigns. Plain English:
--   Content consolidates the prototype's Recording Studio. It has three kinds:
--   thought_leadership, product_content, and video (the big one — using GTM +
--   product info to help make videos with Descript: a flow with a script and
--   prompts, stored as JSONB). Campaigns are coordinated GTM pushes.
-- ============================================================================

create table content_pieces (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  created_at    timestamptz not null default now(),

  kind          text not null default 'thought_leadership', -- thought_leadership | product_content | video
  title         text not null,
  status        text not null default 'draft',   -- draft | in_review | published
  body          text,                              -- the content (article/outline/etc.)
  gtm_record_id uuid references gtm_records (id) on delete set null,
  product_id    uuid references product_records (id) on delete set null,
  video         jsonb,                             -- video flow: { hook, script, prompts[], descript_steps[] }
  position      integer not null default 0
);

comment on table content_pieces is 'GTM content: thought leadership, product content, and video projects (video carries a JSONB flow for Descript: hook/script/prompts/steps). Consolidates Recording Studio.';

create index content_pieces_org_id_idx on content_pieces (org_id);
create index content_pieces_kind_idx on content_pieces (kind);

alter table content_pieces enable row level security;
create policy content_pieces_org_isolation on content_pieces for all
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

create table campaigns (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  created_at    timestamptz not null default now(),

  name          text not null,
  objective     text,
  status        text not null default 'planning',  -- planning | active | complete
  channels      text,                               -- freeform list for now
  gtm_record_id uuid references gtm_records (id) on delete set null,
  start_date    date,
  end_date      date,
  position      integer not null default 0
);

comment on table campaigns is 'Coordinated go-to-market campaigns — objective, channels, status, tied to a GTM record.';

create index campaigns_org_id_idx on campaigns (org_id);

alter table campaigns enable row level security;
create policy campaigns_org_isolation on campaigns for all
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());
