-- ============================================================================
-- Module tasks can stand alone. The Build (Ship) and GTM (Campaign/Enablement)
-- boards are where work actually gets DONE — their tasks may reference an
-- initiative (so completing them rolls status UP to the initiative board) but
-- don't have to. So initiative_id becomes optional.
-- ============================================================================
alter table initiative_workstreams alter column initiative_id drop not null;
comment on column initiative_workstreams.initiative_id is 'Optional link to the initiative this task rolls up to. NULL = a standalone module task. Completing the last task of an initiative''s current lifecycle stage advances that initiative.';
