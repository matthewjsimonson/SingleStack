-- ============================================================================
-- accept_proposal — close the TOCTOU race in the optimistic-concurrency check.
--
-- Plain English: 20260613000000 added a pre-check that refuses a proposal whose
-- field drifted since drafting. But the pre-check SELECT took no lock, and the
-- apply UPDATE is a separate statement — so under READ COMMITTED two concurrent
-- accepts of the SAME field could BOTH pass the pre-check (neither sees the
-- other's uncommitted write) and the second would still clobber the first. The
-- guard worked for already-committed drift but NOT for the concurrent-accept
-- case it advertises — which is the one that matters under volume.
--
-- Fix: take row locks so concurrent accepts SERIALIZE.
--   • Lock the proposal row (FOR UPDATE) so two accepts of the same proposal
--     can't double-apply / write duplicate ratifications.
--   • Lock each target field row in the pre-check (FOR UPDATE). A racing accept
--     now BLOCKS there, and when it unblocks it re-reads the committed value and
--     correctly sees the drift → 'conflicted', never a clobber.
--   • add_field can't lock a not-yet-existent row, so a concurrent insert of the
--     same new key can still slip past the EXISTS pre-check. Guard the apply pass
--     with a subtransaction: a unique_violation rolls back the partial apply and
--     resolves to 'conflicted' instead of surfacing a raw error.
--
-- create-or-replace (same signature + return type as 20260613000000) — no drop
-- needed. Idempotent. This is the migration that actually makes the lost-update
-- guarantee hold.
-- ============================================================================

create or replace function public.accept_proposal(p_proposal uuid, p_ratifier text)
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
  -- Lock the proposal row so two concurrent accepts of the SAME proposal
  -- serialize (the loser sees a non-pending status and no-ops below).
  select org_id, product_id, gtm_record_id, status::text
    into v_org, v_prod, v_gtm, v_status
    from proposals
    where id = p_proposal
    for update;

  if v_org is null then
    raise exception 'proposal % not found', p_proposal;
  end if;
  if v_org is distinct from public.current_org_id() then
    raise exception 'not authorized for this org';
  end if;
  if v_status <> 'pending' then
    return v_status;
  end if;

  -- ---- Pre-check pass: optimistic concurrency WITH row locks ------------------
  -- FOR UPDATE on each target field is what makes the check race-safe: a
  -- concurrent accept touching the same field blocks here until we commit, then
  -- re-reads the committed value and sees the drift.
  for c in select * from proposal_changes where proposal_id = p_proposal loop
    if c.change_kind = 'update_field' then
      select value into v_current from record_fields where id = c.record_field_id for update;
      if not found then
        v_conflicts := v_conflicts + 1;                 -- target field deleted under us
      elsif v_current is distinct from c.old_value then
        v_conflicts := v_conflicts + 1;                 -- value moved since the snapshot
      end if;
    elsif c.change_kind = 'add_field' then
      -- The field this proposal wants to ADD already exists on the record.
      -- NOTE: proposals target product OR gtm only (proposals_one_target), so a
      -- proposal can never add a module-scoped field; matching the proposal's
      -- product/gtm parent covers every field it could insert. If proposals are
      -- ever widened to target modules, extend this check (and the insert below).
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

  -- ---- Apply pass: guarded so a raced add_field resolves to 'conflicted' ------
  -- The subtransaction rolls back any partial apply on a unique_violation (a
  -- concurrent insert of the same new key that slipped past the EXISTS pre-check);
  -- we then record the conflict in the outer transaction so the outcome sticks.
  begin
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
  exception when unique_violation then
    -- Partial apply rolled back with the subtransaction; record the conflict.
    update proposals set status = 'conflicted' where id = p_proposal;
    return 'conflicted';
  end;

  update proposals set status = 'accepted' where id = p_proposal;

  -- Clear the link so later edits in the same transaction aren't attributed.
  perform set_config('app.proposal_id', '', true);
  return 'accepted';
end
$$;

comment on function public.accept_proposal(uuid, text) is
  'Applies a pending proposal with race-safe optimistic concurrency: locks the proposal row and each target field (FOR UPDATE) so concurrent accepts serialize, refuses the whole proposal (status=conflicted) on any drift (value moved, field deleted, or add_field key now exists, incl. a raced unique_violation) without clobbering a newer value, otherwise applies each edit, writes a ratification per edit (honoring section on add_field), links revisions to the proposal, and marks it accepted. Returns ''accepted'' | ''conflicted'' | the prior status if not pending. Refuses proposals outside the caller''s org.';
