-- ============================================================================
-- Initiatives get a SCOPE, and workstreams get a LIFECYCLE STAGE.
--
-- Plain English: an initiative is a Product effort, a GTM effort, or both — the
-- scope changes what its card/page looks like and what work it carries. And the
-- work itself (initiative_workstreams) is tagged with WHICH lifecycle stage it
-- belongs to (signal | plan | build | launch | live), because each stage dictates
-- different tasks (product: spec→prototype→build→ship→track; gtm: messaging→
-- content/campaign→launch→report). The initiative's own `lifecycle` is the
-- current stage; advancing is gated on the current stage's tasks being done.
-- ============================================================================
alter table initiatives add column if not exists scope text not null default 'both';
alter table initiatives drop constraint if exists initiatives_scope_shape;
alter table initiatives add constraint initiatives_scope_shape check (scope in ('product', 'gtm', 'both'));

alter table initiative_workstreams add column if not exists lifecycle_stage text not null default 'plan';
alter table initiative_workstreams drop constraint if exists iws_lifecycle_stage_shape;
alter table initiative_workstreams add constraint iws_lifecycle_stage_shape check (lifecycle_stage in ('signal', 'plan', 'build', 'launch', 'live'));

comment on column initiatives.scope is 'product | gtm | both — the kind of motion; drives the card/page shape.';
comment on column initiative_workstreams.lifecycle_stage is 'Which PLG lifecycle stage this task belongs to (signal|plan|build|launch|live).';
