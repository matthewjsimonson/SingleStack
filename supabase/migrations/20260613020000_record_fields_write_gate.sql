-- ============================================================================
-- C2 — the structural HITL write-gate on a record's canonical field values.
--
-- Plain English: "agents propose, humans ratify" was a CONVENTION, not an
-- invariant. RLS on record_fields is `for all`, and the only trigger was the
-- revision recorder — so anything holding a valid JWT (a future agent, an edge
-- function, a stray client call) could `update record_fields.value` directly and
-- silently bypass the proposal + ratification loop. This makes the gate
-- STRUCTURAL: a canonical field VALUE may change only through one of two trusted
-- channels, enforced by the database itself:
--   • accept_proposal()      — a ratified proposal (sets app.proposal_id)
--   • human_set_field_value() — an explicit human edit (sets app.human_edit)
-- Anything else that tries to change `value` is refused.
--
-- Scope (this migration): UPDATE OF value — i.e. protecting EXISTING (often
-- ratified) values from silent overwrite, the highest-value control. INSERT of a
-- brand-new field is additive (nothing to clobber) and stays open for now; a
-- follow-up can extend the gate to inserts + a bulk human-add channel for the
-- setup flows. Reorder/relabel (updates that don't touch `value`) are NOT gated.
--
-- Audit (develop) confirms the only direct `value` writers are human/setup client
-- flows (SectionedFields, ProfileReadiness, RecordSetup, demoSeed); every
-- agent/AI write already goes through accept_proposal. So routing the human edit
-- paths through human_set_field_value closes the gate without touching agents.
-- ============================================================================

-- ---- 1) human_set_field_value(): the human direct-edit channel ---------------
-- SECURITY DEFINER + org-checked, mirroring accept_proposal. Sets the
-- transaction-local app.human_edit flag the gate looks for, then writes. The
-- revision trigger still fires with proposal_id = NULL (a direct human edit),
-- exactly as a raw client update used to record.
create or replace function public.human_set_field_value(p_field uuid, p_value text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
begin
  select org_id into v_org from record_fields where id = p_field;
  if v_org is null then
    raise exception 'record field % not found', p_field;
  end if;
  if v_org is distinct from public.current_org_id() then
    raise exception 'not authorized for this org';
  end if;

  perform set_config('app.human_edit', 'on', true);
  update record_fields set value = p_value where id = p_field;
  perform set_config('app.human_edit', '', true);
end
$$;

comment on function public.human_set_field_value(uuid, text) is
  'The human direct-edit channel for a record field value. Org-checked; sets the transaction-local app.human_edit flag the write-gate requires, then updates record_fields.value (recording a revision with proposal_id=NULL). Use this instead of a raw record_fields update from the client.';

-- ---- 2) the gate: value may change only through a trusted channel ------------
-- SECURITY INVOKER (default) so is_superuser reflects the real session — true
-- migrations/dashboard (superuser) are exempt; service_role and authenticated
-- users are NOT, so even trusted server code can't silently bypass the loop.
create or replace function public.guard_record_field_value_write()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Allowed channels: a migration/dashboard (superuser), a ratified proposal
  -- (accept_proposal sets app.proposal_id), or a human edit (human_set_field_value
  -- sets app.human_edit). Anything else is a direct write — refuse it.
  if current_setting('is_superuser', true) = 'on'
     or coalesce(nullif(current_setting('app.proposal_id', true), ''), '') <> ''
     or current_setting('app.human_edit', true) = 'on' then
    return new;
  end if;

  raise exception
    'record_fields.value can change only through a ratified proposal (accept_proposal) or a human edit (human_set_field_value) — direct writes are blocked by the HITL gate'
    using errcode = 'check_violation';
end
$$;

comment on function public.guard_record_field_value_write() is
  'BEFORE UPDATE OF value gate on record_fields: refuses any value change not made through accept_proposal (app.proposal_id) or human_set_field_value (app.human_edit); superuser (migrations) exempt. Makes "agents propose, humans ratify" a database invariant.';

drop trigger if exists record_fields_value_write_gate on record_fields;
create trigger record_fields_value_write_gate
  before update of value on record_fields
  for each row execute function public.guard_record_field_value_write();
