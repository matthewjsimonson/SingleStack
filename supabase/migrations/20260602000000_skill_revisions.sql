-- ============================================================================
-- skill_revisions — the evolving, auditable history of an agent skill.
-- Plain English: a skill's `instructions` are its playbook. As the market,
-- positioning, product releases, and strategy change, that playbook should
-- evolve — but never silently. This table records every version a skill's
-- instructions have ever held, in order, with WHY it changed (source) and WHAT
-- drove it (drivers: the signals/themes that prompted the evolution). The
-- current instructions still live on skills.instructions; this is its memory.
--
-- Mirrors field_revisions exactly (house rule: history is sacred). A trigger
-- records a revision on every instructions change — hand-edit or AI-proposed-
-- and-accepted — so the trail is never missed. apply_skill_evolution() is the
-- one place the "signals -> proposed skill update -> human accepts -> skill
-- evolves" loop lands, tagging the revision with its provenance.
-- ============================================================================

create table skill_revisions (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  created_at    timestamptz not null default now(),

  skill_id      uuid not null references skills (id) on delete cascade,
  instructions  text,
  source        text not null default 'edit',   -- edit | evolved | seed
  drivers       jsonb,                           -- e.g. [{kind:'theme'|'signal', title}]
  note          text                             -- short rationale for the change
);

comment on table skill_revisions is 'History of every instructions value a skill has held, in order. source/drivers/note record why it changed and what drove it (signals/themes). Current value stays on skills.instructions.';

create index skill_revisions_org_id_idx on skill_revisions (org_id);
create index skill_revisions_skill_id_idx on skill_revisions (skill_id);

alter table skill_revisions enable row level security;

create policy skill_revisions_org_isolation on skill_revisions
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- ----------------------------------------------------------------------------
-- Trigger: snapshot instructions whenever they are set or change. Reads
-- optional transaction-local settings so an AI-driven evolution carries its
-- provenance; plain edits default to source 'edit' with no drivers.
-- ----------------------------------------------------------------------------
create or replace function public.record_skill_revision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (tg_op = 'INSERT' and new.instructions is not null)
     or (tg_op = 'UPDATE' and new.instructions is distinct from old.instructions) then
    insert into skill_revisions (org_id, skill_id, instructions, source, drivers, note)
    values (
      new.org_id,
      new.id,
      new.instructions,
      coalesce(nullif(current_setting('app.skill_source', true), ''), 'edit'),
      nullif(current_setting('app.skill_drivers', true), '')::jsonb,
      nullif(current_setting('app.skill_note', true), '')
    );
  end if;
  return new;
end
$$;

create trigger skills_revision
  after insert or update of instructions on skills
  for each row execute function public.record_skill_revision();

-- ----------------------------------------------------------------------------
-- apply_skill_evolution(): accept a proposed skill-instruction update, tagging
-- the resulting revision with its provenance. SECURITY DEFINER so the trigger's
-- transaction-local settings are reliably set; refuses skills outside the
-- caller's org.
-- ----------------------------------------------------------------------------
create or replace function public.apply_skill_evolution(
  p_skill uuid, p_instructions text, p_drivers jsonb default null, p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
begin
  select org_id into v_org from skills where id = p_skill;
  if v_org is null then
    raise exception 'skill % not found', p_skill;
  end if;
  if v_org is distinct from public.current_org_id() then
    raise exception 'not authorized for this org';
  end if;

  perform set_config('app.skill_source', 'evolved', true);
  perform set_config('app.skill_drivers', coalesce(p_drivers::text, ''), true);
  perform set_config('app.skill_note', coalesce(p_note, ''), true);

  update skills set instructions = p_instructions where id = p_skill;

  perform set_config('app.skill_source', '', true);
  perform set_config('app.skill_drivers', '', true);
  perform set_config('app.skill_note', '', true);
end
$$;

comment on function public.apply_skill_evolution(uuid, text, jsonb, text) is
  'Applies a proposed skill instructions update and records a provenance-tagged revision (source=evolved, drivers, note). Refuses skills outside the caller''s org.';
