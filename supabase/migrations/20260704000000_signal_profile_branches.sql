-- ============================================================================
-- The signals network grows BRANCHES: nodes can chain off a parent node.
--
-- The reference design for the network is a nucleus with per-vector hubs and
-- organic chains growing outward — node → node → node — where distance from
-- the center means "further from the company's core" (closer = higher weight,
-- more defining; farther = more specific / peripheral). A flat vector+weight
-- model can only fake that with rings; real branches need a parent link.
--
-- parent_key points at a SIBLING node's field_key within the same profile:
--   NULL = the node roots at its vector's hub (or the nucleus, for core);
--   set  = the node chains off that parent, one step further out.
--
-- Plain nullable text, matching vector/weight (no enum, no FK): the field set
-- is replaced wholesale on save, so referential slack is expected — a
-- parent_key with no matching sibling simply renders rooted at the hub.
-- Purely additive; existing rows stay NULL (rooted) and render as before.
-- ============================================================================

alter table signal_profile_fields
  add column if not exists parent_key text;

comment on column signal_profile_fields.parent_key is
  'field_key of the sibling node (same profile) this node branches off. NULL = roots at its vector''s hub. Forms the outward chains of the signals network; depth tracks weight (3 core → 1 edge).';
