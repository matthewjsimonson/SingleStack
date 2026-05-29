-- ============================================================================
-- manual_deploy.sql — ALL Foundation migrations concatenated, in order.
-- Paste this whole file into the Supabase SQL Editor and Run to deploy the
-- schema in one shot (use this when the GitHub auto-deploy isn't running).
-- This is a convenience bundle; it is NOT in supabase/migrations, so the
-- integration ignores it. Schema only — no data. Run seed.sql after if you
-- want the worked example.
-- ============================================================================

-- >>> 20260528000000_foundation_setup.sql -------------------------------------------------------
-- ============================================================================
-- Foundation setup — shared building blocks used by every Foundation table.
-- Plain English: before we make any tables, we turn on the UUID generator,
-- define the one fixed state the system itself relies on (drafted vs ratified),
-- and create one helper that answers "which org is the current user in?" so
-- Row-Level Security can fence every table to that org.
--
-- Note on agnosticism: there are deliberately NO domain-specific value lists
-- baked in here. Statuses (GA/BETA/EA and the like) live in a client-editable
-- table (see 20260528000001_statuses.sql), not a hardcoded enum. The only enum
-- is ratification_status, which is intrinsic to the product's core mechanic.
-- ============================================================================

-- UUID generation (gen_random_uuid). Present on Supabase, safe to re-run.
create extension if not exists pgcrypto;

-- Ratification status — whether a value is still a draft or has been ratified.
-- This is a core system state (not client vocabulary), so it stays an enum.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'ratification_status') then
    create type ratification_status as enum ('drafted', 'ratified');
  end if;
end
$$;

-- current_org_id(): reads the caller's org from their JWT.
-- We look first for a top-level "org_id" claim, then fall back to
-- app_metadata.org_id. Returns NULL when absent (so RLS denies by default).
-- When you later add a memberships table, this is the single place to swap.
create or replace function public.current_org_id()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claims', true)::jsonb ->> 'org_id',
      current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'org_id'
    ),
    ''
  )::uuid
$$;

comment on function public.current_org_id() is
  'Returns the current request''s org_id from the JWT claims. Used by every Foundation RLS policy to scope rows to one org. Swap this body to use a memberships table later.';

-- >>> 20260528000001_statuses.sql -------------------------------------------------------
-- ============================================================================
-- statuses — a client-editable vocabulary of status values.
-- Plain English: instead of hardcoding "GA / BETA / EA" into the database,
-- each org defines its own status values here as rows. A "kind" lets one org
-- keep more than one vocabulary (e.g. a "release" set for products/modules and,
-- later, other sets). Products, modules, and features point at a row here.
-- ============================================================================

create table statuses (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  created_at timestamptz not null default now(),

  kind       text not null default 'release', -- vocabulary group, e.g. "release"
  key        text not null,                    -- short code, e.g. "GA"
  label      text not null,                    -- display label, e.g. "Generally Available"
  position   integer not null default 0,       -- display order within the kind

  unique (org_id, kind, key)
);

comment on table statuses is 'Client-editable status vocabulary. Replaces a hardcoded enum so any org can define its own status values without a migration.';
comment on column statuses.kind is 'Groups values into a vocabulary (e.g. "release"), so one org can maintain several status sets.';

create index statuses_org_id_idx on statuses (org_id);

alter table statuses enable row level security;

create policy statuses_org_isolation on statuses
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- >>> 20260528000002_sources.sql -------------------------------------------------------
-- ============================================================================
-- sources — the catalog of provenance sources.
-- Plain English: one row per place a signal can come from. Each is just an icon
-- and a label, defined by the client (nothing is hardcoded). Signals link to
-- these many-to-many, so we can ask "every signal influenced by source X".
-- This is its own table, NOT a text field on a signal.
-- ============================================================================

create table sources (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  created_at timestamptz not null default now(),

  icon       text not null,   -- icon identifier (e.g. icon name / key)
  label      text not null    -- human label shown in the UI, defined by client
);

comment on table sources is 'Client-defined catalog of provenance sources (icon + label). Signals link here many-to-many via signal_sources.';

create index sources_org_id_idx on sources (org_id);

alter table sources enable row level security;

create policy sources_org_isolation on sources
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- >>> 20260528000003_product_records.sql -------------------------------------------------------
-- ============================================================================
-- product_records — THE HUB. One row = the product.
-- Plain English: this is the canonical record everything traces back to. It
-- holds only a minimal, domain-agnostic spine: a name and an optional status.
-- All descriptive content ("what it is", "who it's for", strategic intent,
-- category, version, owner, anything the client wants) lives as rows in
-- record_fields, so a client can define whatever fields they need without a
-- schema change. Modules, GTM records, and (through them) signals point here.
-- ============================================================================

create table product_records (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  created_at timestamptz not null default now(),

  name       text not null,                          -- the product's name
  status_id  uuid references statuses (id)           -- optional status (client vocab)
);

comment on table product_records is 'The product hub. Minimal spine (name + status); all descriptive content lives in record_fields so it is fully client-configurable.';

create index product_records_org_id_idx on product_records (org_id);
create index product_records_status_id_idx on product_records (status_id);

alter table product_records enable row level security;

create policy product_records_org_isolation on product_records
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- >>> 20260528000004_modules.sql -------------------------------------------------------
-- ============================================================================
-- modules — the product's modules (branches of the hub).
-- Plain English: one row per module. Each has a name, an optional description,
-- an icon, an optional status (from the client's status vocabulary), and a
-- version. A module belongs to the product hub via product_id.
-- NOTE: feature count is NOT stored here — it is computed from the features
-- table (count of features with this module_id), so it can never go stale.
-- ============================================================================

create table modules (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  created_at  timestamptz not null default now(),

  product_id  uuid not null references product_records (id) on delete cascade,
  status_id   uuid references statuses (id),

  name        text not null,
  description text,
  icon        text,
  version     text
);

comment on table modules is 'Modules belonging to the product hub. Status uses the client-editable statuses vocabulary. Feature count is derived from the features table, not stored.';

create index modules_org_id_idx on modules (org_id);
create index modules_product_id_idx on modules (product_id);
create index modules_status_id_idx on modules (status_id);

alter table modules enable row level security;

create policy modules_org_isolation on modules
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- >>> 20260528000005_features.sql -------------------------------------------------------
-- ============================================================================
-- features — features that belong to a module.
-- Plain English: one row per feature. A feature belongs to exactly one module
-- via module_id, and may carry a status from the client's status vocabulary.
-- Counting these per module is how a module's "feature count" is produced.
-- ============================================================================

create table features (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  created_at  timestamptz not null default now(),

  module_id   uuid not null references modules (id) on delete cascade,
  status_id   uuid references statuses (id),

  name        text not null,
  description text
);

comment on table features is 'Features belonging to a module. Counting rows per module_id yields the module feature count.';

create index features_org_id_idx on features (org_id);
create index features_module_id_idx on features (module_id);
create index features_status_id_idx on features (status_id);

alter table features enable row level security;

create policy features_org_isolation on features
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- >>> 20260528000006_gtm_records.sql -------------------------------------------------------
-- ============================================================================
-- gtm_records — GTM records / messaging branches that read from the hub.
-- Plain English: one row per messaging branch. Like the product hub, this keeps
-- only a minimal spine: a name and an optional status. All descriptive content
-- (the overview statement, how-it-works, why, who-it's-read-by, and any other
-- field) lives as rows in record_fields, so it is fully client-configurable.
-- A GTM record belongs to the product hub via product_id. Its tabs and signals
-- live in their own tables.
-- ============================================================================

create table gtm_records (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  created_at timestamptz not null default now(),

  product_id uuid not null references product_records (id) on delete cascade,
  status_id  uuid references statuses (id),

  name       text not null   -- the branch's name, e.g. "Product messaging · Hero"
);

comment on table gtm_records is 'GTM messaging branches that read from the product hub. Minimal spine (name + status); overview and other content live in record_fields. Tabs and signals are separate tables.';

create index gtm_records_org_id_idx on gtm_records (org_id);
create index gtm_records_product_id_idx on gtm_records (product_id);
create index gtm_records_status_id_idx on gtm_records (status_id);

alter table gtm_records enable row level security;

create policy gtm_records_org_isolation on gtm_records
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- >>> 20260528000007_gtm_tabs.sql -------------------------------------------------------
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

-- >>> 20260528000008_signals.sql -------------------------------------------------------
-- ============================================================================
-- signals — the signals that back a GTM record.
-- Plain English: one row per signal. Each carries a confidence level (a number
-- like 0.89), a confidence label (free text like "High" or "Needs input"),
-- when it was observed, a title, and a "why". A signal belongs to a GTM record
-- via gtm_record_id. (Weighting signals to proposals is a LATER step — for now
-- a signal just links to its record and to its sources.)
-- NOTE: the UI shows age as "6h ago"; we store observed_at as a timestamp and
-- derive the relative age, so it never goes stale.
-- ============================================================================

create table signals (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  created_at    timestamptz not null default now(),

  gtm_record_id uuid not null references gtm_records (id) on delete cascade,

  conf_level    numeric(3,2),    -- 0.00–1.00 confidence (e.g. 0.89)
  conf_label    text,            -- free text, e.g. "High" / "Medium" / "Needs input"
  observed_at   timestamptz,     -- when observed; "age" is derived from this
  title         text not null,
  why           text,

  constraint signals_conf_level_range
    check (conf_level is null or (conf_level >= 0 and conf_level <= 1))
);

comment on table signals is 'Signals backing a GTM record. Sources attach many-to-many via signal_sources. Proposal weighting comes in a later step.';
comment on column signals.observed_at is 'When the signal was observed. The UI''s "6h ago" age is derived from this, never stored as text.';

create index signals_org_id_idx on signals (org_id);
create index signals_gtm_record_id_idx on signals (gtm_record_id);

alter table signals enable row level security;

create policy signals_org_isolation on signals
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- >>> 20260528000009_signal_sources.sql -------------------------------------------------------
-- ============================================================================
-- signal_sources — the many-to-many join between signals and sources.
-- Plain English: a signal can be influenced by many sources, and a source can
-- influence many signals. This join table records each (signal, source) link
-- as one row — which is what lets us query "every signal influenced by source
-- X". Provenance is a real relationship here, never a text field.
-- ============================================================================

create table signal_sources (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  created_at  timestamptz not null default now(),

  signal_id   uuid not null references signals (id) on delete cascade,
  source_id   uuid not null references sources (id) on delete cascade,

  unique (signal_id, source_id)
);

comment on table signal_sources is 'Join table linking signals to sources many-to-many. Enables "every signal influenced by source X".';

create index signal_sources_org_id_idx on signal_sources (org_id);
create index signal_sources_signal_id_idx on signal_sources (signal_id);
create index signal_sources_source_id_idx on signal_sources (source_id);

alter table signal_sources enable row level security;

create policy signal_sources_org_isolation on signal_sources
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- >>> 20260528000010_record_fields.sql -------------------------------------------------------
-- ============================================================================
-- record_fields — the client-defined content fields of a record.
-- Plain English: this is what makes the schema domain-agnostic. Instead of
-- hardcoding columns like "what_it_is" or "positioning", every descriptive
-- field on a record is a row here: a key, a label, a value, and a display
-- order. A client can add any fields they need with no migration. Each field
-- belongs to exactly one parent — a product record OR a GTM record — using two
-- nullable foreign keys plus a CHECK that exactly one is set (the same pattern
-- the ratifications table uses), which keeps real foreign-key integrity.
-- ============================================================================

create table record_fields (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  created_at    timestamptz not null default now(),

  -- Parent: exactly one of these is set (enforced by the CHECK below).
  product_id    uuid references product_records (id) on delete cascade,
  gtm_record_id uuid references gtm_records (id) on delete cascade,

  field_key     text not null,   -- stable key, e.g. "what_it_is", "positioning"
  label         text not null,   -- display label, e.g. "What it is"
  value         text,            -- the field's content (flexible text)
  position      integer not null default 0,

  constraint record_fields_one_parent check (
    (product_id is not null)::int + (gtm_record_id is not null)::int = 1
  )
);

comment on table record_fields is 'Client-defined content fields of a record (key/label/value/order). Makes records fully configurable. Each field belongs to exactly one product_record or gtm_record.';
comment on constraint record_fields_one_parent on record_fields is 'Each field points at exactly one parent: a product_record OR a gtm_record.';

-- A field key is unique within its parent record.
create unique index record_fields_product_key_uniq
  on record_fields (product_id, field_key) where product_id is not null;
create unique index record_fields_gtm_key_uniq
  on record_fields (gtm_record_id, field_key) where gtm_record_id is not null;

create index record_fields_org_id_idx on record_fields (org_id);
create index record_fields_product_id_idx on record_fields (product_id);
create index record_fields_gtm_record_id_idx on record_fields (gtm_record_id);

alter table record_fields enable row level security;

create policy record_fields_org_isolation on record_fields
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- >>> 20260528000011_ratifications.sql -------------------------------------------------------
-- ============================================================================
-- ratifications — the ratification trail behind every content field.
-- Plain English: one row per ratification event. Because content fields are now
-- rows in record_fields, a ratification points straight at the exact field it
-- concerns via record_field_id (a real foreign key). It records who ratified it
-- (a human like "M. Schmidt" or an agent name as text for now), when, and
-- whether the value is "drafted" or "ratified". The UI's aggregate stats
-- ("42 ratifications · 81% accept rate") are COMPUTED from these rows, not
-- stored anywhere. This is its own table — never a column on the parent record.
-- ============================================================================

create table ratifications (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  created_at      timestamptz not null default now(),

  record_field_id uuid not null references record_fields (id) on delete cascade,

  ratifier        text not null,                          -- human name or agent name (text for now)
  status          ratification_status not null default 'drafted',
  ratified_at     timestamptz                             -- when ratified (null while drafted)
);

comment on table ratifications is 'Per-field ratification trail, keyed by a real FK to record_fields. Aggregate stats are computed from these rows, never stored.';

create index ratifications_org_id_idx on ratifications (org_id);
create index ratifications_record_field_id_idx on ratifications (record_field_id);

alter table ratifications enable row level security;

create policy ratifications_org_isolation on ratifications
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- >>> 20260528000012_orgs_and_memberships.sql -------------------------------------------------------
-- ============================================================================
-- orgs + memberships — the multi-tenant root, and the real wiring for RLS.
-- Plain English: until now every table carried an org_id, but nothing said
-- which org a user belongs to. This migration adds:
--   * orgs        — one row per tenant organization.
--   * memberships — links an authenticated user to an org.
-- It then swaps current_org_id() to resolve the caller's org FROM their
-- membership (the swap promised in the setup migration), and adds a trigger
-- that auto-joins every new signup to the single org so RLS "just works".
--
-- Judgment call: orgs is the tenant root, so its own id IS the org identity —
-- it deliberately has no redundant org_id column. RLS on orgs scopes by id.
-- ============================================================================

-- The tenant root.
create table orgs (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name       text not null
);

comment on table orgs is 'Tenant root. Its id is the org identity used by every other table''s org_id. No redundant org_id column here.';

alter table orgs enable row level security;

create policy orgs_member_access on orgs
  for all
  using (id = public.current_org_id())
  with check (id = public.current_org_id());

-- Links an authenticated user to an org.
create table memberships (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null default 'member',
  created_at timestamptz not null default now(),

  unique (org_id, user_id)
);

comment on table memberships is 'Links an auth user to an org. Drives org resolution for RLS via current_org_id().';

create index memberships_org_id_idx on memberships (org_id);
create index memberships_user_id_idx on memberships (user_id);

alter table memberships enable row level security;

create policy memberships_org_access on memberships
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- Swap current_org_id() to resolve from membership (was: a JWT claim).
-- SECURITY DEFINER so reading memberships here bypasses RLS — this is what
-- prevents the policy-on-memberships from recursing into itself.
-- Single active membership today; narrow by an active-org claim for multi-org.
create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.org_id
  from public.memberships m
  where m.user_id = auth.uid()
  order by m.created_at
  limit 1
$$;

comment on function public.current_org_id() is
  'Returns the current user''s org_id from their membership. SECURITY DEFINER to avoid RLS recursion. Resolves a single membership today; narrow by an active-org claim when multi-org arrives.';

-- Auto-join every new authenticated user to the single org.
-- While there is one org this is unambiguous; revisit for multi-org signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
begin
  select id into v_org from public.orgs order by created_at limit 1;
  if v_org is not null then
    insert into public.memberships (org_id, user_id)
    values (v_org, new.id)
    on conflict (org_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- >>> 20260528000013_signals_decouple.sql -------------------------------------------------------
-- ============================================================================
-- signals — decouple from a single record.
-- Plain English: a signal is an intelligence item — an observation from an
-- internal dataset or an external source. It exists on its own; it is not born
-- chained to one record. (Routing a signal toward a record change happens
-- through proposals, which cite signals as evidence.) So we relax the required
-- link to a GTM record: a signal MAY still note a related GTM record, but it no
-- longer has to.
-- ============================================================================

alter table signals
  alter column gtm_record_id drop not null;

comment on column signals.gtm_record_id is
  'Optional related GTM record. A signal is a standalone intelligence item; real routing to a record change happens via proposals that cite the signal.';

-- >>> 20260528000014_proposals.sql -------------------------------------------------------
-- ============================================================================
-- proposals — a proposed change to a record, awaiting human approval.
-- Plain English: this is the unit of change. An agent (or a human) proposes
-- that a record should change — with a title, a rationale, a confidence, who
-- proposed it, and a status that moves pending -> accepted / rejected /
-- deferred. A proposal targets exactly one record (a product record OR a GTM
-- record). The specific field edits live in proposal_changes; the evidence
-- behind it lives in proposal_signals.
-- ============================================================================

-- Lifecycle of a proposal.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'proposal_status') then
    create type proposal_status as enum ('pending', 'accepted', 'rejected', 'deferred');
  end if;
end
$$;

create table proposals (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  created_at    timestamptz not null default now(),

  -- Target: exactly one of these is set (enforced by the CHECK below).
  product_id    uuid references product_records (id) on delete cascade,
  gtm_record_id uuid references gtm_records (id) on delete cascade,

  title         text not null,
  rationale     text,                                    -- the "why"
  conf_level    numeric(3,2),
  conf_label    text,
  proposed_by   text not null,                           -- agent name or human name
  status        proposal_status not null default 'pending',

  constraint proposals_one_target check (
    (product_id is not null)::int + (gtm_record_id is not null)::int = 1
  ),
  constraint proposals_conf_level_range
    check (conf_level is null or (conf_level >= 0 and conf_level <= 1))
);

comment on table proposals is 'A proposed change to a record, awaiting human approval. Field edits live in proposal_changes; backing evidence in proposal_signals.';
comment on constraint proposals_one_target on proposals is 'Each proposal targets exactly one record: a product_record OR a gtm_record.';

create index proposals_org_id_idx on proposals (org_id);
create index proposals_product_id_idx on proposals (product_id);
create index proposals_gtm_record_id_idx on proposals (gtm_record_id);
create index proposals_status_idx on proposals (status);

alter table proposals enable row level security;

create policy proposals_org_isolation on proposals
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- >>> 20260528000015_proposal_changes.sql -------------------------------------------------------
-- ============================================================================
-- proposal_changes — the specific field edits inside a proposal.
-- Plain English: one proposal can change several fields at once (like the
-- prototype's multi-row proposal cards). Each row here is one edit: either
-- updating an existing field (point at the record_field, give the proposed new
-- value, and we snapshot the old value), or adding a brand-new field (give the
-- field key, label, and proposed value). When the proposal is accepted, each of
-- these is applied to the record.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'proposal_change_kind') then
    create type proposal_change_kind as enum ('update_field', 'add_field');
  end if;
end
$$;

create table proposal_changes (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  created_at      timestamptz not null default now(),

  proposal_id     uuid not null references proposals (id) on delete cascade,
  change_kind     proposal_change_kind not null,

  -- For update_field: which existing field, and a snapshot of its value now.
  record_field_id uuid references record_fields (id) on delete cascade,
  old_value       text,

  -- For add_field: the new field's identity.
  field_key       text,
  label           text,

  proposed_value  text,           -- the value to set (both kinds)

  constraint proposal_changes_shape check (
    (change_kind = 'update_field' and record_field_id is not null)
    or
    (change_kind = 'add_field' and field_key is not null and label is not null and record_field_id is null)
  )
);

comment on table proposal_changes is 'The field-level edits in a proposal. update_field points at an existing record_field; add_field introduces a new one. Applied on acceptance.';

create index proposal_changes_org_id_idx on proposal_changes (org_id);
create index proposal_changes_proposal_id_idx on proposal_changes (proposal_id);
create index proposal_changes_record_field_id_idx on proposal_changes (record_field_id);

alter table proposal_changes enable row level security;

create policy proposal_changes_org_isolation on proposal_changes
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- >>> 20260528000016_proposal_signals.sql -------------------------------------------------------
-- ============================================================================
-- proposal_signals — which signals back a proposal (the evidence chain).
-- Plain English: a proposal cites the signals that justify it, many-to-many.
-- Combined with signal_sources, this completes the provenance chain:
--   proposal  ←  signals  ←  sources
-- i.e. "why did this field change? because of these signals, from these
-- sources." That explainable chain is the product's core value.
-- ============================================================================

create table proposal_signals (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  created_at  timestamptz not null default now(),

  proposal_id uuid not null references proposals (id) on delete cascade,
  signal_id   uuid not null references signals (id) on delete cascade,

  unique (proposal_id, signal_id)
);

comment on table proposal_signals is 'Join: the signals that justify a proposal. With signal_sources, forms the proposal<-signals<-sources provenance chain.';

create index proposal_signals_org_id_idx on proposal_signals (org_id);
create index proposal_signals_proposal_id_idx on proposal_signals (proposal_id);
create index proposal_signals_signal_id_idx on proposal_signals (signal_id);

alter table proposal_signals enable row level security;

create policy proposal_signals_org_isolation on proposal_signals
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- >>> 20260528000017_field_revisions.sql -------------------------------------------------------
-- ============================================================================
-- field_revisions — the moving, auditable truth.
-- Plain English: every value a field has ever held, in order, with a link to
-- the proposal that produced it (when a proposal did). The current value still
-- lives on record_fields.value; this table is its history. A trigger records a
-- revision automatically on every value change — whether someone hand-edits a
-- field or a proposal is accepted — so the trail is never missed.
--
-- The accept_proposal() function at the bottom is the engine in one place:
-- accepting a proposal applies each of its field edits, writes a ratification
-- for each, and (via the trigger) records a revision linked back to the
-- proposal. That is the whole "signals -> proposal -> approval -> record moves"
-- loop, made real and testable.
-- ============================================================================

create table field_revisions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  created_at      timestamptz not null default now(),

  record_field_id uuid not null references record_fields (id) on delete cascade,
  value           text,
  proposal_id     uuid references proposals (id) on delete set null  -- which proposal drove this (if any)
);

comment on table field_revisions is 'History of every value a field has held, in order. proposal_id links the change to its cause when a proposal drove it. The current value stays on record_fields.value.';

create index field_revisions_org_id_idx on field_revisions (org_id);
create index field_revisions_record_field_id_idx on field_revisions (record_field_id);
create index field_revisions_proposal_id_idx on field_revisions (proposal_id);

alter table field_revisions enable row level security;

create policy field_revisions_org_isolation on field_revisions
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- ----------------------------------------------------------------------------
-- Trigger: record a revision whenever a field's value is set or changes.
-- It reads an optional transaction-local "app.proposal_id" so revisions made
-- through accept_proposal() are linked to that proposal; direct edits get NULL.
-- ----------------------------------------------------------------------------
create or replace function public.record_field_revision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (tg_op = 'INSERT' and new.value is not null)
     or (tg_op = 'UPDATE' and new.value is distinct from old.value) then
    insert into field_revisions (org_id, record_field_id, value, proposal_id)
    values (
      new.org_id,
      new.id,
      new.value,
      nullif(current_setting('app.proposal_id', true), '')::uuid
    );
  end if;
  return new;
end
$$;

create trigger record_fields_revision
  after insert or update of value on record_fields
  for each row execute function public.record_field_revision();

-- ----------------------------------------------------------------------------
-- accept_proposal(): apply a pending proposal through the full loop.
-- SECURITY DEFINER (so it can write across tables) but it refuses to act on a
-- proposal outside the caller's own org.
-- ----------------------------------------------------------------------------
create or replace function public.accept_proposal(p_proposal uuid, p_ratifier text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org   uuid;
  v_prod  uuid;
  v_gtm   uuid;
  c       record;
  v_field uuid;
begin
  select org_id, product_id, gtm_record_id
    into v_org, v_prod, v_gtm
    from proposals
    where id = p_proposal;

  if v_org is null then
    raise exception 'proposal % not found', p_proposal;
  end if;
  if v_org is distinct from public.current_org_id() then
    raise exception 'not authorized for this org';
  end if;

  -- Link any revisions made below back to this proposal (transaction-local).
  perform set_config('app.proposal_id', p_proposal::text, true);

  for c in select * from proposal_changes where proposal_id = p_proposal loop
    if c.change_kind = 'add_field' then
      insert into record_fields (org_id, product_id, gtm_record_id, field_key, label, value, position)
        values (v_org, v_prod, v_gtm, c.field_key, c.label, c.proposed_value, 0)
        returning id into v_field;
    else
      v_field := c.record_field_id;
      update record_fields set value = c.proposed_value where id = v_field;
    end if;

    insert into ratifications (org_id, record_field_id, ratifier, status, ratified_at)
      values (v_org, v_field, p_ratifier, 'ratified', now());
  end loop;

  update proposals set status = 'accepted' where id = p_proposal;

  -- Clear the link so later edits in the same transaction aren't attributed.
  perform set_config('app.proposal_id', '', true);
end
$$;

comment on function public.accept_proposal(uuid, text) is
  'Applies a pending proposal: writes each field edit (updating or adding a record_field), records a ratification per edit, links the resulting revisions to the proposal, and marks the proposal accepted. Refuses proposals outside the caller''s org.';

