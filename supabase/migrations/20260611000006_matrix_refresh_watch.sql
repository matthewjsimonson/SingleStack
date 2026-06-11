-- ============================================================================
-- Phase 3 — keep the matrix current: matrix_refresh watches.
--
-- update_alerts already powers the battlecard currency loop (watch a rival →
-- the homepage flags cards older than new evidence → analyst refresh through
-- the gate). The capability matrix gets the same HITL loop: a matrix_refresh
-- watch flags evidence-backed cells whose competitor has signals NEWER than the
-- cell's evidence_at, with "re-score from evidence" as the one-click action —
-- proposals through the same review gate. Triggered state stays computed live
-- (nothing stored), so alerts never go stale themselves.
-- ============================================================================

alter table update_alerts drop constraint if exists update_alerts_kind_shape;
alter table update_alerts add constraint update_alerts_kind_shape
  check (kind in ('battlecard_refresh','matrix_refresh'));
