-- ============================================================================
-- The signals network settles on THREE intelligence vectors (plus the core):
--
--   • competitive — specific to competing products.
--   • market      — the applicable market as ONE branch: industry, personas,
--                   and general market news. Weight = applicability: 3 direct
--                   (closest to the core) · 2 adjacent · 1 indirect.
--   • technology  — the technology that powers the product (embedding), the
--                   technology that powers BUILDING the product, and the
--                   products that power GTM — frontier AND open-source models
--                   across all three.
--
-- industry + persona were two arms of the same market question; folding them
-- into one 'market' vector matches how the weights already read (direct →
-- adjacent → indirect) and how the Market intel tab consumes them.
--
-- Data re-vector only (plain-text vector column, same convention as before):
-- weights, parents, and node content are untouched — an industry node and a
-- persona node become sibling branches of the market vector.
-- ============================================================================

update signal_profile_fields set vector = 'market' where vector in ('industry', 'persona');
update sources set signal_vector = 'market' where signal_vector in ('industry', 'persona');

comment on column signal_profile_fields.vector is
  'Which intelligence vector this node feeds: competitive | market | technology | core. The intelligence tabs read their own vector of the central signals profile to drive discovery.';

comment on column sources.signal_vector is
  'The signals-network vector this source feeds (core|competitive|market|technology). Drives domain tagging when set.';
