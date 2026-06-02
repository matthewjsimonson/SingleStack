-- ============================================================================
-- Cleanup — retire the pre-workstream Ship pipeline and the standalone content
-- silo. Plain English:
--   • Build/GTM work now lives in initiative_workstreams (tasks), and Roadmap
--     is a lens over tagged tasks. So the old per-initiative Ship pipeline
--     columns (build_stage, prototype_url) and the redundant initiative-level
--     release_id are dead — drop them. (initiatives.lane and .kind stay: lane
--     still routes signals/decisions into Build vs GTM; kind is displayed.)
--   • content_pieces is superseded by content tasks (initiative_workstreams
--     with a content_type). Nothing references the table anymore — drop it.
-- These were verified to have no remaining code or SQL references before drop.
-- ============================================================================

drop table if exists content_pieces;

alter table initiatives drop column if exists build_stage;
alter table initiatives drop column if exists prototype_url;
alter table initiatives drop column if exists release_id;
