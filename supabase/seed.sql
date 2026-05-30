-- ============================================================================
-- seed.sql — local development seed. Intentionally a BLANK SLATE.
-- Plain English: this runs on a local `supabase db reset` (NOT on production
-- deploys — production gets schema only). SingleStack is a product any team
-- uses to build any software, so local dev should start empty too: no example
-- product, no demo signals, nothing to delete before you begin.
--
-- We create only the tenant root (one org) so that local signups have an org to
-- auto-join via the on_auth_user_created trigger. Everything else — product
-- records, GTM records, signals, agents — you create in the app. (On a real
-- deploy the self-heal migration already guarantees an org exists.)
--
-- History note: this file previously seeded an illustrative "GrowthStudio"
-- example; that data was removed from the live DB by the clean-slate migration
-- and is no longer recreated here.
-- ============================================================================

insert into orgs (name)
select 'SingleStack'
where not exists (select 1 from orgs);
