-- ============================================================================
-- Living records — METRIC fields (dogfood finding #5; docs/architecture/living-records.md)
--
-- Records are living: narrative fields already update via the proposal →
-- ratify → field_revisions loop. This adds the METRIC side — numeric, time-
-- series (month-over-month) fields like NPS, feature usage, churn.
--
-- INTEGRITY PRINCIPLE (non-negotiable, from the product owner): metrics are
-- NEVER fabricated. Every metric value must trace to a reliable source with
-- backup. A manual override may exist, but it still declares its origin. This is
-- enforced in the DATABASE — a metric value literally cannot exist without a
-- source — not merely in the app. No naked numbers.
--
-- Ratification uses the SAME human-in-the-loop gate as everything else: a metric
-- update arrives as a proposal and lands only when accepted (proposal_id links
-- the value to the ratification that admitted it).
-- ============================================================================

-- 1. A field is narrative (prose, today's default) or metric (numeric series).
alter table record_fields
  add column if not exists field_kind text not null default 'narrative';
alter table record_fields drop constraint if exists record_fields_field_kind_chk;
alter table record_fields add constraint record_fields_field_kind_chk
  check (field_kind in ('narrative', 'metric'));
comment on column record_fields.field_kind is
  'narrative = prose (value text, history in field_revisions). metric = numeric time-series in record_metrics (NPS, usage, churn). Default narrative — every existing field is unaffected.';

-- Optional unit/cadence hints for a metric field (display + entry only).
alter table record_fields add column if not exists metric_unit text;     -- e.g. 'NPS', '%', 'users', '$'
alter table record_fields add column if not exists metric_cadence text;   -- e.g. 'monthly' | 'quarterly'

-- 2. The metric time-series: one row per field per period, with PROVENANCE.
create table if not exists record_metrics (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  created_at      timestamptz not null default now(),

  record_field_id uuid not null references record_fields (id) on delete cascade,
  period          date not null,              -- the month/quarter this value is for (1st of period)
  value_num       numeric not null,           -- the actual number (NPS=42, usage=0.23)

  -- PROVENANCE — the anti-fabrication core. A value cannot exist without these.
  origin          text not null,              -- 'source' (pulled) | 'manual' (human override)
  source_label    text not null,              -- WHERE it came from (e.g. 'Amplitude', 'Delighted NPS', 'manual: board deck')
  source_ref      text,                       -- backup/citation: a URL, doc id, signal id, query — the evidence
  source_id       uuid references sources (id) on delete set null,  -- the connected source, when pulled from one
  proposal_id     uuid references proposals (id) on delete set null, -- the ratification that admitted this value
  note            text,

  -- Anti-fabrication invariants, enforced by the DB:
  --  • a source-pulled value must name its source AND carry a backup ref/source_id
  --  • a manual override must still name where the human got it (source_label) and carry a ref
  constraint record_metrics_origin_chk check (origin in ('source', 'manual')),
  constraint record_metrics_provenance_chk check (
    length(btrim(source_label)) > 0
    and (
      (origin = 'source' and (source_ref is not null or source_id is not null))
      or (origin = 'manual' and source_ref is not null)
    )
  ),
  -- one value per field per period (a correction supersedes via proposal → new row after delete, or update)
  constraint record_metrics_field_period_uniq unique (record_field_id, period)
);

comment on table record_metrics is
  'Month-over-month metric values for metric-kind record_fields. INTEGRITY: a value cannot exist without provenance (source_label + a backup ref/source_id, or for manual overrides, source_label + ref). Metrics are never fabricated. Admitted via the same proposal gate (proposal_id).';
comment on column record_metrics.source_ref is
  'The backup/evidence for this number — a URL, doc, signal id, or query. Required so every metric is traceable. No naked numbers.';

create index if not exists record_metrics_field_period_idx on record_metrics (record_field_id, period desc);
create index if not exists record_metrics_org_idx on record_metrics (org_id, created_at desc);

-- 3. RLS — org-scoped like everything else.
alter table record_metrics enable row level security;
drop policy if exists record_metrics_org_all on record_metrics;
create policy record_metrics_org_all on record_metrics
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- 4. Helper: latest value + month-over-month delta for a metric field. Pure read.
-- Returns the most recent period's value and the change vs. the prior period —
-- the "dynamic, MoM" display the living record needs.
create or replace function public.metric_latest(p_field_id uuid)
returns table (period date, value_num numeric, prev_value numeric, mom_delta numeric, source_label text)
language sql stable security definer set search_path = public, pg_temp
as $$
  with series as (
    select period, value_num, source_label,
           lead(value_num) over (order by period desc) as prev_value
    from record_metrics
    where record_field_id = p_field_id
    order by period desc
  )
  select period, value_num, prev_value,
         case when prev_value is null then null else value_num - prev_value end as mom_delta,
         source_label
  from series
  limit 1
$$;
comment on function public.metric_latest(uuid) is
  'Latest period value + MoM delta vs prior period for a metric field. Drives the living record metric display.';
