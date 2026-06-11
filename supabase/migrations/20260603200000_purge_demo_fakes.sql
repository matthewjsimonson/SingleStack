-- ============================================================================
-- Purge demo-seeded FAKE work so the workflow is real.
--
-- Earlier demo seeds inserted pretend initiatives ("Agent orchestration v1",
-- "Pricing clarity") with tasks pre-marked active, plus pretend releases, a
-- campaign, and launch content. The seed script no longer creates these, but
-- rows already inserted persist — so a Build Item showed "In build" with no real
-- work behind it. This deletes them by their exact seed identities (initiatives
-- cascade to their workstreams / fields / context links / signal links).
--
-- Reference intel (product, modules, competitors, capabilities, signals) is
-- intentionally kept — it's real intake that feeds Product Strategy.
-- One-time cleanup; DELETE is idempotent on re-run.
-- ============================================================================

delete from initiatives where title in ('Agent orchestration v1', 'Pricing clarity');

-- Defensive: any launch content the seed left without a parent initiative.
delete from initiative_workstreams where title in (
  'Launch blog — orchestration v1',
  '90s orchestration explainer',
  'Launch-week teaser thread',
  'Design-partner testimonial — orchestration'
);

delete from releases where name in ('Agent orchestration', 'Pricing & onboarding');
delete from campaigns where name = 'Orchestration launch week';
