-- ============================================================================
-- seed.sql — one org + a complete worked example.
-- Plain English: this runs on a local `supabase db reset` (NOT on production
-- deploys — production gets schema only). It creates one organization and one
-- fully wired example that touches every Foundation table, so you can see the
-- whole shape end to end, then delete the example and hand-enter your own.
--
-- The example mirrors the prototype (GrowthStudio) purely for familiarity — it
-- is illustrative data, not anything the schema depends on.
-- ============================================================================

do $$
declare
  v_org    uuid;
  v_ga     uuid;
  v_beta   uuid;
  v_ea     uuid;
  v_prod   uuid;
  v_field  uuid;
  v_module uuid;
  v_gtm    uuid;
  v_signal uuid;
  v_source uuid;
begin
  -- The org. (Every new signup auto-joins this one via the on_auth_user_created trigger.)
  insert into orgs (name) values ('Acme GovCon') returning id into v_org;

  -- Client-defined status vocabulary.
  insert into statuses (org_id, kind, key, label, position)
    values (v_org, 'release', 'GA', 'Generally Available', 0) returning id into v_ga;
  insert into statuses (org_id, kind, key, label, position)
    values (v_org, 'release', 'BETA', 'Beta', 1) returning id into v_beta;
  insert into statuses (org_id, kind, key, label, position)
    values (v_org, 'release', 'EA', 'Early Access', 2) returning id into v_ea;

  -- Product hub (minimal spine).
  insert into product_records (org_id, name, status_id)
    values (v_org, 'GrowthStudio', v_ga) returning id into v_prod;

  -- Client-defined content fields on the product (no schema change needed).
  insert into record_fields (org_id, product_id, field_key, label, value, position) values
    (v_org, v_prod, 'what_it_is',  'What it is',
       'An AI-native business development and capture platform for government contractors.', 0),
    (v_org, v_prod, 'who_its_for', 'Who it''s for',
       'Mid-market GovCon firms ($25M–$500M) with dedicated BD teams of 3+.', 1),
    (v_org, v_prod, 'owner',       'Owner', 'M. Schmidt', 2);

  -- A ratification trail on one field (by real FK).
  select id into v_field from record_fields where product_id = v_prod and field_key = 'what_it_is';
  insert into ratifications (org_id, record_field_id, ratifier, status, ratified_at)
    values (v_org, v_field, 'M. Schmidt', 'ratified', now() - interval '4 days');

  -- A module and one of its features.
  insert into modules (org_id, product_id, status_id, name, description, icon, version)
    values (v_org, v_prod, v_ga, 'Opportunity capture', 'Scan, score, plan. Front-end of the BD workflow.', 'ti-target', 'v4.3')
    returning id into v_module;
  insert into features (org_id, module_id, status_id, name, description)
    values (v_org, v_module, v_ga, 'Pursuit alerts', 'Real-time pursuit alerting.');

  -- A GTM messaging branch (minimal spine) with content fields + a tab.
  insert into gtm_records (org_id, product_id, status_id, name)
    values (v_org, v_prod, v_ga, 'Product messaging · Hero') returning id into v_gtm;
  insert into record_fields (org_id, gtm_record_id, field_key, label, value, position) values
    (v_org, v_gtm, 'statement', 'Statement',
       'Win more federal work — with AI you can actually explain.', 0),
    (v_org, v_gtm, 'why',       'Why',
       'Explainability is the defensible wedge versus autonomous-first competitors.', 1);
  insert into gtm_tabs (org_id, gtm_record_id, tab_key, label, body)
    values (v_org, v_gtm, 'overview', 'Overview',
       '{"blocks":[{"type":"text","text":"Hero positioning for the explainable-AI wedge."}]}'::jsonb);

  -- A signal backing the branch, linked to a source (many-to-many).
  insert into sources (org_id, icon, label) values (v_org, 'ti-microphone', 'Gong') returning id into v_source;
  insert into signals (org_id, gtm_record_id, conf_level, conf_label, observed_at, title, why)
    values (v_org, v_gtm, 0.89, 'High', now() - interval '6 hours',
       'Lead hero with "explainable AI"',
       '"Explainable AI" mentions up 3x QoQ in discovery calls.')
    returning id into v_signal;
  insert into signal_sources (org_id, signal_id, source_id) values (v_org, v_signal, v_source);
end
$$;
