-- ============================================================================
-- The signals profile becomes ONE network with weighted nodes.
--
-- The central profile is now a single intelligence network on the Signals home,
-- split into FOUR vectors — competitive, industry, persona, technology — plus a
-- CORE (what the product is at its essence, the center of the graph). Each node
-- carries a WEIGHT = how close to the center it sits: 3 = core (highest weight,
-- a defining attribute / direct rival / core persona/feature), 2 = standard,
-- 1 = edge (adjacent / lesser). Weight focuses search on the right signals while
-- still capturing related ones.
--
-- Additive + a data re-vector. `weight` defaults to 2 (standard). Existing rows
-- are re-filed to the new vocabulary (shared→core, market→industry,
-- frontier→technology); the next AI draft refines vector + weight and seeds the
-- persona/technology nodes. RLS unchanged (inherits signal_profile_fields).
-- ============================================================================

alter table signal_profile_fields
  add column if not exists weight int not null default 2;  -- 3 core (closest) … 1 edge (farthest)

comment on column signal_profile_fields.weight is
  'Distance from the center of the signals network: 3 = core (highest signal weight), 2 = standard, 1 = edge/adjacent. Focuses search & analysis on the highest-weight nodes.';

-- Re-vector existing nodes onto the new vocabulary (competitive | industry |
-- persona | technology | core). market lumps to industry for now; the next AI
-- draft splits persona out and seeds technology.
update signal_profile_fields set vector = 'core'       where vector = 'shared';
update signal_profile_fields set vector = 'industry'   where vector = 'market';
update signal_profile_fields set vector = 'technology' where vector = 'frontier';

-- Order a vector's nodes by weight (core first) for the network layout.
create index if not exists signal_profile_fields_vector_weight_idx
  on signal_profile_fields (profile_id, vector, weight desc);
