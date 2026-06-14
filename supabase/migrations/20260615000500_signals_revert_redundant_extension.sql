-- Migration: signals_revert_redundant_extension  (P2 correction)
-- Purpose: undo the misguided parts of 20260615000100_signals_product_extension.
--   QA + a full read of the signals migration history (20260528000013_signals_decouple,
--   20260529000009_signals_scope_and_sources) showed signals were ALREADY decoupled and
--   bi-circle: gtm_record_id has been nullable since day one, and a `scope` column
--   ('org'|'product'|'gtm') + `product_id` (-> product_records) already model product and
--   org scope, governed by the signals_scope_shape CHECK. Therefore:
--     - product_record_id DUPLICATED the existing product_id        -> drop it.
--     - signals_one_parent (exactly one of product/gtm) CONTRADICTS signals_scope_shape
--       (org-scoped signals legitimately have neither parent)       -> drop it. The rows
--       it rejected are valid org/competitor/product-scoped signals, not bad data.
--     - area_id was speculative (no consumer yet)                   -> drop it; area
--       attribution will be added when the coverage phase defines how (cf. deferred
--       area_sections).
--   gtm_record_id stays nullable (it already was). Net: signals return to their correct
--   pre-existing shape; the only real P2 signal need — product scope — was already met by
--   the existing scope/product_id model.
-- Author: SingleStack · Date: 2026-06-15

alter table signals drop constraint if exists signals_one_parent;
alter table signals drop column if exists product_record_id;  -- redundant with existing product_id
alter table signals drop column if exists area_id;            -- defer to the coverage phase
-- Dropping the columns also drops their indexes (signals_product_record_id_idx,
-- signals_area_id_idx). gtm_record_id is intentionally left nullable.
