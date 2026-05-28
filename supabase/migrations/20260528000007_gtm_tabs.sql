-- ============================================================================
-- gtm_tabs — the tabs shown on a GTM record.
-- Plain English: a GTM record has a list of tabs; one row per tab. Each tab has
-- a key, a label, and a body. The body is genuinely freeform rendered content,
-- so it is JSONB. Tabs are real rows with a foreign key back to the GTM record
-- (a one-to-many relationship) — never a nested JSON array on the record.
-- ============================================================================

create table gtm_tabs (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  created_at    timestamptz not null default now(),

  gtm_record_id uuid not null references gtm_records (id) on delete cascade,

  tab_key       text not null,   -- the tab's id within its record (e.g. "overview")
  label         text not null,   -- display label
  body          jsonb            -- freeform rendered content (JSONB by design)
);

comment on table gtm_tabs is 'Tabs belonging to a GTM record (one-to-many). Body is freeform JSONB; everything filterable stays as columns.';
comment on column gtm_tabs.body is 'Freeform rendered tab content. JSONB is intentional here — not used for anything we filter or join on.';

create index gtm_tabs_org_id_idx on gtm_tabs (org_id);
create index gtm_tabs_gtm_record_id_idx on gtm_tabs (gtm_record_id);

alter table gtm_tabs enable row level security;

create policy gtm_tabs_org_isolation on gtm_tabs
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());
