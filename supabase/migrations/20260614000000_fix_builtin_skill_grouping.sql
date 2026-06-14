-- ============================================================================
-- Correct the built-in skills' grouping (category) + areas in the DB directly.
--
-- The canonical metadata for built-in skills lives in web/skills/**/SKILL.md ->
-- skills.generated.ts -> seed. But already-seeded rows only refresh when the seed
-- re-runs AGAINST newly-deployed app code (and only for source='template' rows),
-- so a category fix can silently fail to appear. This migration applies the
-- corrected grouping deterministically, by key, so every org's library is right
-- regardless of re-seed timing. Idempotent; values match the SKILL.md source.
--
-- Logic (see web/skills/README.md): category = the skill's DOMAIN, not its holder.
--   product  — building the product (strategy, roadmap, architecture, engineering)
--   gtm      — market-facing (positioning, messaging, personas, narrative, battlecards)
--   research — scoring/analyzing evidence (the analysis layer feeding GTM)
--   general  — cross-cutting org/agent operations
-- Scoped to library templates (scope='library'); per-agent instances keep their own.
-- ============================================================================

update skills set category = 'product'
 where scope = 'library' and key in ('cpo_product_truth','ceng_buildable_truth','demo_roadmap_prioritization','demo_architecture_review');

update skills set category = 'gtm'
 where scope = 'library' and key in ('cco_one_narrative','cro_win_the_category','demo_positioning_sharpening','demo_persona_messaging','demo_competitive_battlecard','demo_narrative_voice','competitive_messenger');

update skills set category = 'research'
 where scope = 'library' and key in ('capability_evidence_scoring','competitive_evidence_analyst');

update skills set category = 'general'
 where scope = 'library' and key = 'cos_roster_stewardship';

-- Child areas (cornerstones intentionally keep areas = []). Drives the agent
-- skill picker's relevance match (skills.areas ∩ the agent's connected areas).
update skills set areas = '["product","roadmap","strategy"]'::jsonb where scope = 'library' and key = 'demo_roadmap_prioritization';
update skills set areas = '["gtm","competitive","market"]'::jsonb    where scope = 'library' and key = 'demo_positioning_sharpening';
update skills set areas = '["product","frontier"]'::jsonb            where scope = 'library' and key = 'demo_architecture_review';
update skills set areas = '["gtm","market"]'::jsonb                  where scope = 'library' and key = 'demo_persona_messaging';
update skills set areas = '["competitive","gtm"]'::jsonb             where scope = 'library' and key = 'demo_competitive_battlecard';
update skills set areas = '["gtm","content"]'::jsonb                 where scope = 'library' and key = 'demo_narrative_voice';
update skills set areas = '["competitive","market","signals"]'::jsonb where scope = 'library' and key = 'capability_evidence_scoring';
update skills set areas = '["competitive","signals"]'::jsonb         where scope = 'library' and key = 'competitive_evidence_analyst';
update skills set areas = '["competitive","content"]'::jsonb         where scope = 'library' and key = 'competitive_messenger';
