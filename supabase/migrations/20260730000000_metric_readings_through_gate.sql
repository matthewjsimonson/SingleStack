-- ============================================================================
-- Metric readings through the proposal gate — completes dogfood finding #5
-- (docs/architecture/living-records.md).
--
-- The narrative half of "living records" already flows through the gate:
--   propose -> proposal_changes -> accept_proposal() -> value + ratification + revision.
-- The metric half did not. record_metrics carried unused `proposal_id`/`source_id`
-- columns, but no proposal could ever populate them: proposal_changes only knew
-- 'update_field' / 'add_field', and accept_proposal() only applied those.
--
-- This makes a metric reading a first-class proposed change: an incoming, sourced
-- value ("NPS = 42 for May 2026, from Delighted") arrives as a proposal and lands
-- ONLY when a human accepts it — through the SAME accept_proposal() engine, with a
-- record_metrics row linked back to the ratifying proposal. Same gate for both.
--
-- Integrity is preserved end to end: the proposal layer enforces the SAME
-- anti-fabrication rule as record_metrics — no unsourced numbers, ever.
--
-- Additive. Narrative fields, the conflict-aware/locking accept path, and the
-- direct manual-entry path in MetricField are all untouched.
-- ============================================================================

-- 1. New change kind. Extend the enum (matching this repo's pattern for
--    proposal_status 'conflicted' in 20260613000000). The shape CHECK below
--    compares via change_kind::text so creating it never coerces the fresh enum
--    literal at DDL time — safe whether or not the runner wraps this file in a txn.
alter type proposal_change_kind add value if not exists 'metric_reading';

-- 2. Metric payload — populated only when change_kind = 'metric_reading'.
--    (record_field_id already exists; it points at the target metric field.)
alter table proposal_changes
  add column if not exists metric_period       date,     -- the period this value is for (1st of month)
  add column if not exists metric_value        numeric,  -- the number (NPS = 42)
  add column if not exists metric_origin       text,     -- 'source' (pulled) | 'manual' (human override)
  add column if not exists metric_source_label text,     -- WHERE it came from (e.g. 'Delighted NPS')
  add column if not exists metric_source_ref   text,     -- backup/citation: url, doc, signal id, query
  add column if not exists metric_source_id    uuid references sources (id) on delete set null, -- connected source, when pulled
  add column if not exists metric_note         text;

comment on column proposal_changes.metric_period is
  'For metric_reading changes: the period (month) the proposed value is for. Applied to record_metrics.period on acceptance.';

-- 3. Shape: each kind carries exactly what it needs. A metric_reading mirrors
--    record_metrics' anti-fabrication invariant at the proposal layer — a proposed
--    number cannot exist without a source and a backup ref (or source_id).
alter table proposal_changes drop constraint if exists proposal_changes_shape;
alter table proposal_changes add constraint proposal_changes_shape check (
      (change_kind = 'update_field' and record_field_id is not null)
   or (change_kind = 'add_field'    and field_key is not null and label is not null and record_field_id is null)
   or (change_kind::text = 'metric_reading'
         and record_field_id is not null
         and metric_period is not null
         and metric_value  is not null
         and metric_origin in ('source', 'manual')
         and length(btrim(coalesce(metric_source_label, ''))) > 0
         and (
              (metric_origin = 'source' and (metric_source_ref is not null or metric_source_id is not null))
           or (metric_origin = 'manual' and metric_source_ref is not null)
         ))
);
comment on constraint proposal_changes_shape on proposal_changes is
  'update_field points at an existing field; add_field introduces one; metric_reading proposes a sourced numeric value for a metric field (same no-naked-numbers rule as record_metrics).';

-- 4. Teach accept_proposal() to apply a metric_reading. This is develop's
--    conflict-aware, row-locking accept_proposal (from 20260613010000) with the
--    metric_reading branch added — the locking, drift pre-check, unique_violation
--    subtransaction, and 'accepted'|'conflicted'|prior-status contract are all
--    preserved verbatim. A metric reading is an UPSERT by (field, period) — a
--    correction supersedes intentionally — so it takes no part in drift detection.
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
  v_kind      text;
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
  -- re-reads the committed value and sees the drift. (metric_reading is an upsert
  -- by period and carries no old-value snapshot, so it contributes no conflict.)
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
  begin
    perform set_config('app.proposal_id', p_proposal::text, true);

    for c in select * from proposal_changes where proposal_id = p_proposal loop
      if c.change_kind::text = 'metric_reading' then
        -- A sourced metric value lands in record_metrics, provenance-bound and
        -- linked to this proposal. A correction for the same period supersedes.
        v_field := c.record_field_id;

        select field_kind into v_kind from record_fields where id = v_field;
        if v_kind is distinct from 'metric' then
          raise exception 'field % is not a metric field (field_kind=%)', v_field, coalesce(v_kind, '<missing>');
        end if;

        insert into record_metrics (
          org_id, record_field_id, period, value_num,
          origin, source_label, source_ref, source_id, proposal_id, note
        ) values (
          v_org, v_field, c.metric_period, c.metric_value,
          c.metric_origin, c.metric_source_label, c.metric_source_ref, c.metric_source_id, p_proposal, c.metric_note
        )
        on conflict (record_field_id, period) do update set
          value_num    = excluded.value_num,
          origin       = excluded.origin,
          source_label = excluded.source_label,
          source_ref   = excluded.source_ref,
          source_id    = excluded.source_id,
          proposal_id  = excluded.proposal_id,
          note         = excluded.note,
          created_at   = now();

      elsif c.change_kind = 'add_field' then
        insert into record_fields (org_id, product_id, gtm_record_id, field_key, label, value, section, position)
          values (v_org, v_prod, v_gtm, c.field_key, c.label, c.proposed_value, c.section, 0)
          returning id into v_field;

      else -- update_field
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
  'Applies a pending proposal with race-safe optimistic concurrency (locks proposal + target fields, refuses on drift as status=conflicted). Narrative edits update/add a record_field (honoring section); a metric_reading upserts a provenance-bound record_metrics row linked to the proposal (correction supersedes by period). Writes a ratification per edit, links narrative revisions to the proposal. Returns ''accepted'' | ''conflicted'' | prior status if not pending. Refuses proposals outside the caller''s org.';
