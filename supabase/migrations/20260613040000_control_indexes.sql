-- ============================================================================
-- P2 — org-leading composite indexes for the hot, RLS-filtered read paths.
--
-- The schema constitution says composite indexes lead with org_id, but the live
-- indexes are single-column (org_id alone, or a status/scope/category alone). RLS
-- injects `org_id = current_org_id()` into every query, so the real predicates are
-- (org_id, <filter>). These three composites match the queries that run most and
-- grow fastest under the volume of updates/signals:
--   • proposals(org_id, status)         — the review queue + every "pending" count
--     (ReviewDrawer, FoundationView, AgentDrawer, PortfolioRollup).
--   • signals(org_id, scope, category)  — the signal triage/intel lists by lens.
--   • signal_themes(org_id, category)   — the themes dashboard by product/gtm lens.
-- Additive and idempotent; the existing single-column indexes stay (cheap, and
-- still used by other access paths). No new index on low-value combos — writes
-- pay for every index, so this is deliberately just the measured-hot three.
-- ============================================================================

create index if not exists proposals_org_status_idx
  on proposals (org_id, status);

create index if not exists signals_org_scope_category_idx
  on signals (org_id, scope, category);

create index if not exists signal_themes_org_category_idx
  on signal_themes (org_id, category);
