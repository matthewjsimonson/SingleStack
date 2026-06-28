-- ============================================================================
-- Bind a source to the SIGNALS NETWORK: which vector (and optionally which node)
-- it feeds. This is what makes the network the single control plane for sources —
-- you aim a source at a vector/node here, instead of configuring collection in
-- each intel tab. connector-runner stamps the pulled signals with the vector's
-- domain (+ node) so they land in the right tab AND feed that node's analysis.
--
-- Additive + nullable: existing sources (competitor_id / market_lens scoped) are
-- untouched. signal_node_key NULL = the source feeds the whole vector (inherited
-- by every node); set = it feeds one specific node (e.g. a persona's interviews).
-- ============================================================================

alter table sources add column if not exists signal_vector   text;  -- core|competitive|industry|persona|technology
alter table sources add column if not exists signal_node_key text;  -- a profile node's field_key; NULL = whole-vector (inherited)

comment on column sources.signal_vector   is 'The signals-network vector this source feeds (core|competitive|industry|persona|technology). Drives domain tagging when set.';
comment on column sources.signal_node_key is 'The specific profile node (signal_profile_fields.field_key) this source feeds. NULL = the whole vector (every node inherits it).';

create index if not exists sources_signal_vector_idx on sources (org_id, signal_vector);
