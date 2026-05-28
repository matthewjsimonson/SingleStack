-- ============================================================================
-- proposal_changes — the specific field edits inside a proposal.
-- Plain English: one proposal can change several fields at once (like the
-- prototype's multi-row proposal cards). Each row here is one edit: either
-- updating an existing field (point at the record_field, give the proposed new
-- value, and we snapshot the old value), or adding a brand-new field (give the
-- field key, label, and proposed value). When the proposal is accepted, each of
-- these is applied to the record.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'proposal_change_kind') then
    create type proposal_change_kind as enum ('update_field', 'add_field');
  end if;
end
$$;

create table proposal_changes (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  created_at      timestamptz not null default now(),

  proposal_id     uuid not null references proposals (id) on delete cascade,
  change_kind     proposal_change_kind not null,

  -- For update_field: which existing field, and a snapshot of its value now.
  record_field_id uuid references record_fields (id) on delete cascade,
  old_value       text,

  -- For add_field: the new field's identity.
  field_key       text,
  label           text,

  proposed_value  text,           -- the value to set (both kinds)

  constraint proposal_changes_shape check (
    (change_kind = 'update_field' and record_field_id is not null)
    or
    (change_kind = 'add_field' and field_key is not null and label is not null and record_field_id is null)
  )
);

comment on table proposal_changes is 'The field-level edits in a proposal. update_field points at an existing record_field; add_field introduces a new one. Applied on acceptance.';

create index proposal_changes_org_id_idx on proposal_changes (org_id);
create index proposal_changes_proposal_id_idx on proposal_changes (proposal_id);
create index proposal_changes_record_field_id_idx on proposal_changes (record_field_id);

alter table proposal_changes enable row level security;

create policy proposal_changes_org_isolation on proposal_changes
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());
