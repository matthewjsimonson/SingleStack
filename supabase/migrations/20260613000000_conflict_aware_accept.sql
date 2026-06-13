-- ============================================================================
-- Conflict-aware accept_proposal — optimistic concurrency on the record write.
--
-- Plain English: a proposal is drafted against a SNAPSHOT of a field's value
-- (captured in proposal_changes.old_value). Between drafting and acceptance the
-- live field can move — another proposal lands, or a human edits it directly.
-- The old accept_proposal blindly ran `update record_fields set value = …`,
-- SILENTLY CLOBBERING the newer value. With agents proposing at volume, that is
-- exactly how two agents (or an agent and a human) overwrite each other with no
-- trace. The lost-update hazard was invisible.
--
-- This makes acceptance optimistic-concurrency safe: a PRE-CHECK pass compares
-- each edit's live value against the snapshot it was drafted against. If ANY
-- edit has drifted (value moved, target field deleted, or an add_field whose key
-- now already exists), the whole proposal is refused ATOMICALLY and marked
-- 'conflicted' — nothing is applied, nothing is clobbered. The drafter re-reads
-- the moved value and proposes again. A clean proposal applies exactly as before.
--
-- This is schema-skill §1.4 (ratification is the rollback target — never lose the
-- prior value) made safe under concurrency. Mirrors the house pattern: one
-- SECURITY DEFINER function, org-checked, the single place the loop lands.
--
-- Builds on the section-aware accept_proposal from 20260611000000_battlecard_agents
-- (the apply pass still writes proposal_changes.section on add_field) — this only
-- adds the pre-check and the typed return.
-- ============================================================================

-- ---- 1) 'conflicted' as a first-class proposal outcome ----------------------
-- A refused-on-drift proposal is neither accepted nor rejected by a human — it
-- is a distinct lifecycle state the UI surfaces ("the record moved; re-review").
alter type proposal_status add value if not exists 'conflicted';

-- ---- 2) accept_proposal(): pre-check for drift, then apply atomically -------
-- Return type changes void -> text so callers can tell 'accepted' from
-- 'conflicted' (existing callers that ignore the return keep working). A change
-- of return type requires drop+recreate (Postgres can't replace it in place).
drop function if exists public.accept_proposal(uuid, text);

create function public.accept_proposal(p_proposal uuid, p_ratifier text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org       uuid;
  v_prod      uuid;
  v_gtm       uuid;
  v_status    text;
  c           record;
  v_field     uuid;
  v_current   text;
  v_conflicts int := 0;
begin
  select org_id, product_id, gtm_record_id, status::text
    into v_org, v_prod, v_gtm, v_status
    from proposals
    where id = p_proposal;

  if v_org is null then
    raise exception 'proposal % not found', p_proposal;
  end if;
  if v_org is distinct from public.current_org_id() then
    raise exception 'not authorized for this org';
  end if;
  -- Only a pending proposal can be accepted. Re-accepting an already-decided
  -- proposal is a no-op that returns its current state (idempotent, no double-apply).
  if v_status <> 'pending' then
    return v_status;
  end if;

  -- ---- Pre-check pass: optimistic concurrency --------------------------------
  -- Compare each edit against the snapshot it was drafted against. Any drift
  -- means applying would silently overwrite a newer value — refuse the whole
  -- proposal rather than clobber.
  for c in select * from proposal_changes where proposal_id = p_proposal loop
    if c.change_kind = 'update_field' then
      select value into v_current from record_fields where id = c.record_field_id;
      if not found then
        v_conflicts := v_conflicts + 1;                 -- target field deleted under us
      elsif v_current is distinct from c.old_value then
        v_conflicts := v_conflicts + 1;                 -- value moved since the snapshot
      end if;
    elsif c.change_kind = 'add_field' then
      -- The field this proposal wants to ADD already exists on the record (a
      -- concurrent add). Applying would either duplicate-key or shadow it.
      if exists (
        select 1 from record_fields rf
         where rf.field_key = c.field_key
           and ( (v_prod is not null and rf.product_id    = v_prod)
              or (v_gtm  is not null and rf.gtm_record_id = v_gtm) )
      ) then
        v_conflicts := v_conflicts + 1;
      end if;
    end if;
  end loop;

  if v_conflicts > 0 then
    update proposals set status = 'conflicted' where id = p_proposal;
    return 'conflicted';
  end if;

  -- ---- Apply pass (unchanged behavior): link revisions to this proposal ------
  perform set_config('app.proposal_id', p_proposal::text, true);

  for c in select * from proposal_changes where proposal_id = p_proposal loop
    if c.change_kind = 'add_field' then
      insert into record_fields (org_id, product_id, gtm_record_id, field_key, label, value, section, position)
        values (v_org, v_prod, v_gtm, c.field_key, c.label, c.proposed_value, c.section, 0)
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
  return 'accepted';
end
$$;

comment on function public.accept_proposal(uuid, text) is
  'Applies a pending proposal with optimistic concurrency: a pre-check refuses the whole proposal (status=conflicted) if any edit drifted from the snapshot it was drafted against (value moved, field deleted, or add_field key now exists) — never clobbering a newer value. A clean proposal applies each edit, writes a ratification per edit, links revisions to the proposal, and marks it accepted. Returns ''accepted'' | ''conflicted'' | the prior status if not pending. Refuses proposals outside the caller''s org.';
