-- ============================================================================
-- Child-skill groundwork: areas + preferred connectors.
--
-- A child skill is task/area-specific and builds on the agent's cornerstone. Two
-- intrinsic properties of a child skill (NOT of the attachment, since a library
-- skill is agent-agnostic and reusable):
--
--   areas      — which areas/surfaces of the solution the skill is relevant to
--                (e.g. ["competitive","product"]). Empty = general. Used to
--                suggest the skill from page context and to populate the "/"
--                summon menu (phased in later — schema only here).
--   connectors — PREFERRED MCP connectors the skill expects, by label/catalog key
--                (e.g. ["DeepWiki","G2"]). A SOFT preference: at runtime it's
--                matched by label against the agent's attached connections to bias
--                tool use; it never hard-gates (graceful degradation is preserved).
--                No FK — the skill is library-level and agent-agnostic.
--
-- Additive and idempotent. Nothing reads these at runtime yet; this is the
-- groundwork so connector-linking and page-aware summoning can phase in cleanly.
-- ============================================================================

alter table skills add column if not exists areas      jsonb not null default '[]'::jsonb;
alter table skills add column if not exists connectors jsonb not null default '[]'::jsonb;

comment on column skills.areas is
  'Array of area/surface keys this child skill is relevant to (e.g. ["competitive","product"]). Empty = general. Drives page-context suggestions and the "/" summon menu.';
comment on column skills.connectors is
  'Array of PREFERRED MCP connector labels/keys this skill expects (e.g. ["DeepWiki"]). Soft preference matched by label against the agent''s connections; never hard-gates.';

-- Containment lookups ("which child skills are relevant to area X") stay cheap.
create index if not exists skills_areas_gin on skills using gin (areas);
