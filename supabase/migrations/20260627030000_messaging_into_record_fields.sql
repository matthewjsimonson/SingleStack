-- ============================================================================
-- Unify the messaging framework into the GTM record's FIELD system.
--
-- The messaging house lived in gtm_tabs — a second-class store with none of the
-- record machinery (no proposals, no agents, no review queue, no write-gate, no
-- revisions). Move it into record_fields under a dedicated "Messaging" section so
-- it becomes first-class: the Sweep, Refine, officer advisors, agent proposals,
-- the human-ratify write-gate, and full revision history all work on it natively,
-- exactly like the rest of the record. The Messaging tab renders the "Messaging"
-- section; the Strategy tab renders the rest.
--
-- Content-preserving + idempotent: copy each framework gtm_tab into its field
-- (skip if the field already exists), then retire gtm_tabs entirely (the leftover
-- "Other sections" were not real). Migration runs as superuser → write-gate exempt.
-- ============================================================================

with mapping(k, lbl, pos) as (
  values
    ('positioning_statement', 'Positioning statement',        1),
    ('strategic_narrative',   'Strategic narrative',          2),
    ('value_proposition',     'Value proposition',            3),
    ('pillar_1',              'Messaging pillar 1',           4),
    ('pillar_2',              'Messaging pillar 2',           5),
    ('pillar_3',              'Messaging pillar 3',           6),
    ('persona_messaging',     'Persona messaging',            7),
    ('tone_of_voice',         'Tone of voice',                8),
    ('proof_points',          'Proof points',                 9),
    ('elevator_pitch',        'Elevator pitch & boilerplate', 10)
)
insert into record_fields (org_id, gtm_record_id, field_key, label, section, value, position, field_kind)
select gt.org_id, gt.gtm_record_id, m.k, m.lbl, 'Messaging', gt.body->>'text', m.pos, 'narrative'
from gtm_tabs gt
join mapping m on m.k = gt.tab_key
where coalesce(btrim(gt.body->>'text'), '') <> ''
  and not exists (
    select 1 from record_fields rf
    where rf.gtm_record_id = gt.gtm_record_id and rf.field_key = m.k
  );

-- gtm_tabs is deprecated (messaging now lives in record_fields). Clear it — the
-- framework content is migrated above; the leftover custom sections were not real.
delete from gtm_tabs;
