-- ============================================================================
-- field_revisions — the moving, auditable truth.
-- Plain English: every value a field has ever held, in order, with a link to
-- the proposal that produced it (when a proposal did). The current value still
-- lives on record_fields.value; this table is its history. A trigger records a
-- revision automatically on every value change — whether someone hand-edits a
-- field or a proposal is accepted — so the trail is never missed.
--
-- The accept_proposal() function at the bottom is the engine in one place:
-- accepting a proposal applies each of its field edits, writes a ratification
-- for each, and (via the trigger) records a revision linked back to the
-- proposal. That is the whole "signals -> proposal -> approval -> record moves"
-- loop, made real and testable.
-- ============================================================================

create table field_revisions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  created_at      timestamptz not null default now(),

  record_field_id uuid not null references record_fields (id) on delete cascade,
  value           text,
  proposal_id     uuid references proposals (id) on delete set null  -- which proposal drove this (if any)
);

comment on table field_revisions is 'History of every value a field has held, in order. proposal_id links the change to its cause when a proposal drove it. The current value stays on record_fields.value.';

create index field_revisions_org_id_idx on field_revisions (org_id);
create index field_revisions_record_field_id_idx on field_revisions (record_field_id);
create index field_revisions_proposal_id_idx on field_revisions (proposal_id);

alter table field_revisions enable row level security;

create policy field_revisions_org_isolation on field_revisions
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- ----------------------------------------------------------------------------
-- Trigger: record a revision whenever a field's value is set or changes.
-- It reads an optional transaction-local "app.proposal_id" so revisions made
-- through accept_proposal() are linked to that proposal; direct edits get NULL.
-- ----------------------------------------------------------------------------
create or replace function public.record_field_revision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (tg_op = 'INSERT' and new.value is not null)
     or (tg_op = 'UPDATE' and new.value is distinct from old.value) then
    insert into field_revisions (org_id, record_field_id, value, proposal_id)
    values (
      new.org_id,
      new.id,
      new.value,
      nullif(current_setting('app.proposal_id', true), '')::uuid
    );
  end if;
  return new;
end
$$;

create trigger record_fields_revision
  after insert or update of value on record_fields
  for each row execute function public.record_field_revision();

-- ----------------------------------------------------------------------------
-- accept_proposal(): apply a pending proposal through the full loop.
-- SECURITY DEFINER (so it can write across tables) but it refuses to act on a
-- proposal outside the caller's own org.
-- ----------------------------------------------------------------------------
create or replace function public.accept_proposal(p_proposal uuid, p_ratifier text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org   uuid;
  v_prod  uuid;
  v_gtm   uuid;
  c       record;
  v_field uuid;
begin
  select org_id, product_id, gtm_record_id
    into v_org, v_prod, v_gtm
    from proposals
    where id = p_proposal;

  if v_org is null then
    raise exception 'proposal % not found', p_proposal;
  end if;
  if v_org is distinct from public.current_org_id() then
    raise exception 'not authorized for this org';
  end if;

  -- Link any revisions made below back to this proposal (transaction-local).
  perform set_config('app.proposal_id', p_proposal::text, true);

  for c in select * from proposal_changes where proposal_id = p_proposal loop
    if c.change_kind = 'add_field' then
      insert into record_fields (org_id, product_id, gtm_record_id, field_key, label, value, position)
        values (v_org, v_prod, v_gtm, c.field_key, c.label, c.proposed_value, 0)
        returning id into v_field;
    else
      v_field := c.record_field_id;
      update record_fields set value = c.proposed_value where id = v_field;
    end if;

    insert into ratifications (org_id, record_field_id, ratifier, status, ratified_at)
      values (v_org, v_field, p_ratifier, 'ratified', now());
  end loop;

  update proposals set status = 'accepted' where id = p_proposal;

  -- Clear the link so later edits in the same transaction aren't attributed.
  perform set_config('app.proposal_id', '', true);
end
$$;

comment on function public.accept_proposal(uuid, text) is
  'Applies a pending proposal: writes each field edit (updating or adding a record_field), records a ratification per edit, links the resulting revisions to the proposal, and marks the proposal accepted. Refuses proposals outside the caller''s org.';
