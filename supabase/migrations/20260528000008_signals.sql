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
