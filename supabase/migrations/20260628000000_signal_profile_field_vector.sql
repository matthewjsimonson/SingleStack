-- ============================================================================
-- Signal-profile fields gain a VECTOR.
--
-- The Signal Profile is being promoted from a competitive-only "landscape"
-- artifact into THE central signals profile that lives on the Signals home: a
-- graph of nodes (the editable sections) organised into VECTORS. Each vector is
-- an intelligence domain the profile feeds — competitive, market, frontier — or
-- 'shared' (positioning/wedge that every domain draws on). The intelligence
-- tabs each read THEIR vector of the one profile to find & populate signals.
--
-- This is purely additive: one nullable-with-default column + an index. No data
-- shape changes, no RLS change (inherits signal_profile_fields' org isolation).
-- Existing rows default to 'shared'; the next AI synthesis re-files them onto
-- the right vector. Mirrors the plain-text convention of origin/scope/domain —
-- no enum (the set is small but we follow the existing columns, not a new type).
-- ============================================================================

alter table signal_profile_fields
  add column if not exists vector text not null default 'shared';  -- competitive | market | frontier | shared

comment on column signal_profile_fields.vector is
  'Which intelligence vector this node feeds: competitive | market | frontier | shared. The intelligence tabs read their own vector of the central signals profile to drive discovery.';

-- Tabs query "the competitive vector of this profile", so index (profile, vector).
create index if not exists signal_profile_fields_vector_idx
  on signal_profile_fields (profile_id, vector);
