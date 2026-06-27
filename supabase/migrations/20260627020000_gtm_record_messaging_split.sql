-- ============================================================================
-- Split the GTM record (strategy & ops) from the messaging framework.
--
-- The GTM record had grown half-messaging: positioning, category POV, value prop,
-- pillars, win themes, and differentiation lived as record_fields — duplicating
-- the new messaging & narrative framework (gtm_tabs / lib/messagingFramework.ts).
-- The GTM record's real job is go-to-market STRATEGY & OPERATIONS (audience,
-- motion, tools & frontier-model leverage, processes/handoffs, execution). The
-- messaging house belongs in the framework, where it's updated by signals and
-- product updates rather than by strategy/tooling changes.
--
-- This migration is content-preserving and idempotent:
--   1) copy each existing GTM messaging field value into its framework section
--      (gtm_tabs), but NEVER clobber a section the user has already built;
--   2) delete the now-redundant messaging fields from the GTM records.
-- Battlecard copy fields are left as-is (competitor enablement is a separate axis;
-- relocating it to the competitive module is a follow-up). record_fields deletes
-- cascade cleanly to ratifications/revisions/proposal_changes; the value
-- write-gate is UPDATE-only, so deletes are unaffected.
-- ============================================================================

-- 1) Preserve messaging content into the framework (gtm_tabs), without clobbering.
with mapping(old_key, tab_key, tab_label) as (
  values
    ('positioning',     'positioning_statement', 'Positioning statement'),
    ('category_pov',    'strategic_narrative',   'Strategic narrative'),
    ('value_prop',      'value_proposition',     'Value proposition'),
    ('pillars',         'pillar_1',              'Messaging pillar 1'),
    ('win_themes',      'pillar_2',              'Messaging pillar 2'),
    ('differentiation', 'pillar_3',              'Messaging pillar 3')
)
insert into gtm_tabs (org_id, gtm_record_id, tab_key, label, body)
select rf.org_id, rf.gtm_record_id, m.tab_key, m.tab_label, jsonb_build_object('text', rf.value)
from record_fields rf
join mapping m on m.old_key = rf.field_key
where rf.gtm_record_id is not null
  and coalesce(btrim(rf.value), '') <> ''
  and not exists (
    select 1 from gtm_tabs gt
    where gt.gtm_record_id = rf.gtm_record_id
      and gt.tab_key = m.tab_key
  );

-- 2) Retire the now-redundant messaging fields from the GTM records.
delete from record_fields
where gtm_record_id is not null
  and field_key in ('positioning', 'category_pov', 'value_prop', 'pillars', 'win_themes', 'differentiation');
