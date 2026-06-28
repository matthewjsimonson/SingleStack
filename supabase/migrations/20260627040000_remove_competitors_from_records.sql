-- ============================================================================
-- Remove "competitors" from the product & GTM records.
--
-- Competitors are their own entities (the Competitive module), NOT a record field.
-- Competitor-list fields (key_competitors / competitors / known_competitors) and a
-- stray 'positioning' field on the PRODUCT record — which named rivals like
-- "Crayon/Klue/Aha" and is a GTM/messaging concept, not a product one — were
-- feeding the competitor search the wrong rivals and re-seeding them after a Clear.
-- Drop them everywhere. Deletes cascade cleanly (ratifications/revisions/
-- proposal_changes); the value write-gate is INSERT/UPDATE-only, so deletes are
-- unaffected and the migration role needs no special channel.
-- ============================================================================

delete from record_fields
where field_key in ('key_competitors', 'competitors', 'known_competitors', 'competitive_landscape', 'rivals');

-- 'positioning' belongs to the GTM messaging framework now; a copy on the PRODUCT
-- record is misplaced and named rivals — remove it.
delete from record_fields
where product_id is not null and field_key = 'positioning';
