-- ============================================================================
-- Phase 2 completion — bind the last two org-only entities to a product line.
-- Plain English: the multi-product spine (20260530210000_multi_product) made
-- signals, themes, sources, competitors, objectives, and bridges product-aware,
-- but two org-only entities were left behind: AGENTS and TRACKING_TOPICS. This
-- finishes the binding so a multi-product org can have a product-DEDICATED agent
-- or a product-specific watch, while keeping the shared/company-wide default.
--
--   product_id NULL  = shared / company-wide (the default — unchanged behavior).
--   product_id set   = dedicated to that product line.
--
-- Additive + nullable, on delete set null (matching the rest of the spine): a
-- dedicated agent or topic survives its product's deletion by demoting to
-- shared/company-wide rather than being destroyed. Single-product orgs see no
-- difference — everything stays NULL.
-- ============================================================================

-- ---- agents ----------------------------------------------------------------
-- Hybrid model (multi-product-foundation.md → "Agent scoping"): NULL = a shared
-- agent available to every line (e.g. a general CRO); non-NULL = a dedicated
-- agent for one line of business. When run inside a product context, an agent
-- reasons over that product's record + signals; the lens filter applies within.
alter table agents add column if not exists product_id uuid references product_records (id) on delete set null;
comment on column agents.product_id is 'The product line this agent is dedicated to. NULL = a shared agent available to every product line (the default). Non-NULL = dedicated to that line of business.';
create index if not exists agents_product_id_idx on agents (product_id);

-- ---- tracking_topics -------------------------------------------------------
-- A watch can target one product line ("Acme's pricing on the Platform product")
-- or the whole company ("AI-native procurement trends"). NULL = company-wide.
alter table tracking_topics add column if not exists product_id uuid references product_records (id) on delete set null;
comment on column tracking_topics.product_id is 'The product line this watch targets. NULL = company-wide (the default). Different product lines watch different competitors and topics.';
create index if not exists tracking_topics_product_id_idx on tracking_topics (product_id);
