-- ============================================================================
-- Broaden signals to org/product/GTM scope, and build out the sources catalog.
-- Plain English:
--   Signals were locked to a single GTM record. But signals are broader — they
--   inform the whole Foundation: a GitHub product trend, a usage-platform
--   problem, a competitive move. So a signal can now be scoped to the ORG (no
--   record), to a PRODUCT, or to a GTM record.
--   Sources become a real catalog: internal vs external, what kind of connector
--   (manual, web search, GitHub, analytics, CRM…), and a connection status —
--   so the Signals tab can group them and (later) live MCP connectors plug in.
-- This migration is additive and preserves existing rows (every current signal
-- already has gtm_record_id, which stays valid and implies scope='gtm').
-- ============================================================================

-- ---- signals: make gtm_record_id optional, add product_id + scope ----------
alter table signals alter column gtm_record_id drop not null;
alter table signals add column if not exists product_id uuid references product_records (id) on delete cascade;
alter table signals add column if not exists scope text not null default 'org';

-- Backfill scope for any existing rows that have a gtm_record_id.
update signals set scope = 'gtm' where gtm_record_id is not null and scope = 'org';

-- A signal is scoped to exactly its level: org (no record), product, or gtm.
-- Enforce the FK matches the scope.
alter table signals drop constraint if exists signals_scope_shape;
alter table signals add constraint signals_scope_shape check (
  (scope = 'org'     and product_id is null and gtm_record_id is null) or
  (scope = 'product' and product_id is not null and gtm_record_id is null) or
  (scope = 'gtm'     and gtm_record_id is not null)
);

create index if not exists signals_product_id_idx on signals (product_id);
create index if not exists signals_scope_idx on signals (scope);

comment on column signals.scope is 'Where the signal applies: org (whole Foundation), product, or gtm. The matching FK column is set per scope (enforced by signals_scope_shape).';

-- ---- sources: catalog metadata for internal/external + connector kind ------
-- origin: 'internal' (your own systems/manual) vs 'external' (market/web).
-- kind:   connector type — 'manual' today; others (web_search, github,
--         analytics, crm, reviews, …) describe where it pulls from when live
--         MCP connectors arrive.
-- status: 'manual' (entries added by hand) | 'connected' | 'disconnected'.
alter table sources add column if not exists origin text not null default 'internal';
alter table sources add column if not exists kind text not null default 'manual';
alter table sources add column if not exists status text not null default 'manual';
alter table sources add column if not exists config jsonb;

comment on column sources.origin is 'internal vs external — drives the Signals tab grouping.';
comment on column sources.kind is 'Connector kind (manual, web_search, github, analytics, crm, reviews, …). manual today; identifies the live connector when MCP pulling is added.';
comment on column sources.status is 'manual | connected | disconnected. Live connectors set connected/disconnected; manual sources stay manual.';

-- ---- let a signal carry its primary source inline (convenience) ------------
-- signal_sources (many-to-many) remains the full provenance join; this adds a
-- quick single-source pointer for the common case + simpler UI writes.
alter table signals add column if not exists source_id uuid references sources (id) on delete set null;
create index if not exists signals_source_id_idx on signals (source_id);

comment on column signals.source_id is 'Primary source of this signal (convenience). The signal_sources join remains the full many-to-many provenance.';
