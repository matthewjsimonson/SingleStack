-- ============================================================================
-- Clean slate — remove the GrowthStudio demo content from the live database.
-- Plain English: seed.sql created an illustrative example (the "GrowthStudio"
-- product, with a GTM record, fields, a module/feature, a signal, a source, a
-- proposal, and a release-status vocabulary). seed.sql only runs on a local
-- `db reset`, but this example data was also loaded into the live project — so
-- the app shows "GrowthStudio" and a non-zero "Foundation filled %" instead of
-- a true blank slate. This one-time migration deletes that demo CONTENT so any
-- team starts empty and builds what they want.
--
-- SAFETY: this is deliberately surgical and content-only.
--   • It deletes by the exact identifiers seed.sql used ('GrowthStudio',
--     'Gong', the GA/BETA/EA release statuses) — never anything a real user
--     typed under a different name.
--   • It NEVER touches orgs, memberships, or auth.users. Real signups auto-join
--     the org; deleting the org would lock people out. We leave the tenant root
--     and all access intact and only remove the example rows inside it.
--   • Deleting the product record cascades (verified FKs: on delete cascade) to
--     its gtm_records → signals / gtm_tabs / proposals, its record_fields, and
--     its modules → features. So one delete clears the bulk of the example.
--   • Idempotent: re-running deletes nothing (the rows are already gone).
-- ============================================================================

-- 1. The demo product — cascades to GTM records, fields, modules/features,
--    signals (via the GTM record) and proposals.
delete from product_records where name = 'GrowthStudio';

-- 2. The demo source ('Gong'). Its signal was removed by the cascade above;
--    signal_sources rows cascaded with that signal. Remove the orphan source.
delete from sources where label = 'Gong' and kind = 'manual';

-- 3. The demo release-status vocabulary, but ONLY if nothing still references
--    it (a real record a user created could legitimately use these). The FK
--    from records → statuses is RESTRICT, so guarding avoids any failure and
--    preserves real data.
delete from statuses s
 where s.kind = 'release'
   and s.key in ('GA', 'BETA', 'EA')
   and not exists (select 1 from product_records p where p.status_id = s.id)
   and not exists (select 1 from gtm_records g where g.status_id = s.id)
   and not exists (select 1 from modules m where m.status_id = s.id);

-- 4. Any stray demo signals that were logged at org/product scope (not under the
--    GTM record, so not caught by the cascade) and match the seed's exact text.
delete from signals where title = 'Lead hero with "explainable AI"';
