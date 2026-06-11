-- ============================================================================
-- Retire plays (step 2 of 2): drop the now-unused tables.
--
-- Step 1 (20260607000100_lift_play_skills_to_child.sql) already preserved every
-- play_skill's content as child skills on the agent, and the app + runtime no
-- longer read or write any of these tables (the Plays UI and the run-play edge
-- function were removed in the same change). Verified there are NO remaining
-- references: no foreign keys into `plays` from other tables, no `play_id`
-- columns elsewhere, and no view/function/trigger depends on them.
--
-- So this drop is the safe, deliberate second step. Children first, then the
-- parent; IF EXISTS keeps it idempotent; CASCADE clears each table's own RLS
-- policies and indexes. This is irreversible for these tables' rows — but that
-- data was already lifted, and nothing has written to them since.
-- ============================================================================

drop table if exists play_placements cascade;
drop table if exists play_skills     cascade;
drop table if exists play_agents     cascade;
drop table if exists plays           cascade;
