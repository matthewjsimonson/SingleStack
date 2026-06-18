-- ============================================================================
-- workflow_revisions — the evolving, auditable history of a workflow's steps.
-- Plain English: a workflow's `steps` are its operating procedure (the ordered
-- chain of agent + skill + instruction). As the market, positioning, product
-- releases, and strategy change, that procedure should evolve — but never
-- silently. This table records every version a workflow's steps have ever held,
-- in order, with WHY it changed (source) and WHAT drove it (drivers: the
-- signals/themes that prompted the evolution). The current steps still live on
-- workflows.steps; this is its memory.
--
-- Mirrors skill_revisions exactly (house rule: history is sacred). A trigger
-- records a revision on every steps change — hand-edit or AI-proposed-and-
-- accepted — so the trail is never missed. apply_workflow_evolution() is the
-- one place the "signals -> proposed workflow update -> human accepts -> workflow
-- evolves" loop lands, tagging the revision with its provenance.
-- ============================================================================

create table if not exists workflow_revisions (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  created_at    timestamptz not null default now(),

  workflow_id   uuid not null references workflows (id) on delete cascade,
  steps         jsonb,                           -- snapshot of workflows.steps at this revision
  source        text not null default 'edit',    -- edit | evolved | seed
  drivers       jsonb,                           -- e.g. [{kind:'theme'|'signal', title}]
  note          text                             -- short rationale for the change
);

comment on table workflow_revisions is 'History of every steps value a workflow has held, in order. source/drivers/note record why it changed and what drove it (signals/themes). Current value stays on workflows.steps.';

create index if not exists workflow_revisions_org_id_idx on workflow_revisions (org_id);
create index if not exists workflow_revisions_workflow_id_idx on workflow_revisions (workflow_id);

alter table workflow_revisions enable row level security;

create policy workflow_revisions_org_isolation on workflow_revisions
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- ----------------------------------------------------------------------------
-- Trigger: snapshot steps whenever they are set or change. Reads optional
-- transaction-local settings so an AI-driven evolution carries its provenance;
-- plain edits default to source 'edit' with no drivers. On INSERT the first
-- revision is the 'seed' (set by the create path via app.workflow_source).
-- ----------------------------------------------------------------------------
create or replace function public.record_workflow_revision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (tg_op = 'INSERT' and new.steps is not null)
     or (tg_op = 'UPDATE' and new.steps is distinct from old.steps) then
    insert into workflow_revisions (org_id, workflow_id, steps, source, drivers, note)
    values (
      new.org_id,
      new.id,
      new.steps,
      coalesce(nullif(current_setting('app.workflow_source', true), ''), 'edit'),
      nullif(current_setting('app.workflow_drivers', true), '')::jsonb,
      nullif(current_setting('app.workflow_note', true), '')
    );
  end if;
  return new;
end
$$;

drop trigger if exists workflows_revision on workflows;
create trigger workflows_revision
  after insert or update of steps on workflows
  for each row execute function public.record_workflow_revision();

-- ----------------------------------------------------------------------------
-- apply_workflow_evolution(): accept a proposed workflow-steps update, tagging
-- the resulting revision with its provenance. SECURITY DEFINER so the trigger's
-- transaction-local settings are reliably set; refuses workflows outside the
-- caller's org.
-- ----------------------------------------------------------------------------
create or replace function public.apply_workflow_evolution(
  p_workflow uuid, p_steps jsonb, p_drivers jsonb default null, p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
begin
  select org_id into v_org from workflows where id = p_workflow;
  if v_org is null then
    raise exception 'workflow % not found', p_workflow;
  end if;
  if v_org is distinct from public.current_org_id() then
    raise exception 'not authorized for this org';
  end if;

  perform set_config('app.workflow_source', 'evolved', true);
  perform set_config('app.workflow_drivers', coalesce(p_drivers::text, ''), true);
  perform set_config('app.workflow_note', coalesce(p_note, ''), true);

  update workflows set steps = p_steps where id = p_workflow;

  perform set_config('app.workflow_source', '', true);
  perform set_config('app.workflow_drivers', '', true);
  perform set_config('app.workflow_note', '', true);
end
$$;

comment on function public.apply_workflow_evolution(uuid, jsonb, jsonb, text) is
  'Applies a proposed workflow steps update and records a provenance-tagged revision (source=evolved, drivers, note). Refuses workflows outside the caller''s org.';
