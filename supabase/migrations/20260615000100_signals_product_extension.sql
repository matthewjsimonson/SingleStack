-- Migration: signals_product_extension  (P2 — orchestration vocabulary binding)
-- Purpose: make signals BI-CIRCLE. Today signals back only a GTM record
--   (gtm_record_id not null). In PLG the product is the growth engine, so the build
--   circle needs a first-class evidence substrate uniform with GTM. Extend signals to
--   product using the SAME one-parent pattern record_fields/proposals already use, and
--   add an optional governed area_id tag so a signal is attributable to the area it feeds.
-- Conventions: matches sibling tables (current_org_id RLS already on signals).
-- Risk: low + lossless. The one-parent CHECK is added NOT VALID because the remote has
--   pre-existing "orphan" signals with no gtm_record_id; we enforce going forward without
--   touching legacy data (see the constraint note below).
-- Author: SingleStack · Date: 2026-06-14
-- NOTE: gtm_record_id becomes nullable. Existing rows are unchanged; only NEW product
--   signals set product_record_id. App code that reads signals.gtm_record_id should treat
--   it as nullable going forward (product signals carry product_record_id instead).

-- 1. Add the product parent + the optional governed area tag.
alter table signals
  add column if not exists product_record_id uuid references product_records (id) on delete cascade;
alter table signals
  add column if not exists area_id uuid references areas (id) on delete set null;

comment on column signals.product_record_id is 'Product-circle parent (build evidence). Exactly one of product_record_id / gtm_record_id is set — the same one-parent pattern as record_fields and proposals.';
comment on column signals.area_id is 'Optional governed area this signal feeds (FK to areas). Lets a signal be attributed to the orchestration area it informs; null = unattributed.';

-- 2. Relax the GTM-only requirement and enforce exactly-one-parent instead.
alter table signals alter column gtm_record_id drop not null;

alter table signals drop constraint if exists signals_one_parent;
-- NOT VALID: enforce exactly-one-parent on every NEW/updated row, without failing on
-- pre-existing rows that violate it. The remote has legacy "orphan" signals with no
-- gtm_record_id; we govern going forward rather than guess at (delete/reparent) real
-- data. A later cleanup can fix the orphans and then `validate constraint` to fully lock.
alter table signals add constraint signals_one_parent check (
  (product_record_id is not null)::int + (gtm_record_id is not null)::int = 1
) not valid;

-- 3. Indexes for the new parents/tag (org_id index already exists from the base table).
create index if not exists signals_product_record_id_idx on signals (product_record_id);
create index if not exists signals_area_id_idx on signals (org_id, area_id);

-- RLS is already enabled on signals with signals_org_isolation (current_org_id); the new
-- columns inherit it. No policy change required.
