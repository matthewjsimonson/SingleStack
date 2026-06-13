-- ============================================================================
-- C2b — extend the HITL write-gate to INSERTs that carry a value, and add the
-- human bulk-create channel.
--
-- C2a (20260613020000) gated UPDATE OF value. But a field can also be born with a
-- value (insert), and an agent inserting a populated field directly would still
-- bypass the propose→ratify loop. This closes that: the gate now also fires on
-- INSERT, but only when a real value is written — an empty-slot insert (value
-- NULL, e.g. a metric field whose data lives in record_metrics, or a blank field
-- the user will fill later) is additive and stays open.
--
-- Human/setup flows that legitimately create populated fields (SectionedFields,
-- RecordSetup, ProfileReadiness, demoSeed) route their inserts through
-- human_add_fields(), the bulk sibling of human_set_field_value — it sets
-- app.human_edit, derives org_id from the session (never trusts client input),
-- and validates each row's parent belongs to the org. Agent add_field still flows
-- through accept_proposal (app.proposal_id), unchanged.
-- ============================================================================

-- ---- 1) human_add_fields(): the human bulk-create channel --------------------
-- Accepts a JSON array of field rows: { product_id|gtm_record_id|module_id,
-- field_key, label, value, section, position, field_kind, metric_unit }. org_id
-- is taken from current_org_id() (client-supplied org_id is ignored), and each
-- parent is checked to belong to the org. Sets app.human_edit so the gate admits
-- the writes; the revision trigger records each with proposal_id = NULL.
create or replace function public.human_add_fields(p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org  uuid := public.current_org_id();
  r      jsonb;
  v_prod uuid;
  v_gtm  uuid;
  v_mod  uuid;
begin
  if v_org is null then
    raise exception 'no org in context';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array of field rows';
  end if;

  perform set_config('app.human_edit', 'on', true);

  for r in select * from jsonb_array_elements(p_rows) loop
    v_prod := nullif(r->>'product_id', '')::uuid;
    v_gtm  := nullif(r->>'gtm_record_id', '')::uuid;
    v_mod  := nullif(r->>'module_id', '')::uuid;

    -- Exactly one parent, and it must belong to the caller's org (defense beyond
    -- the FK, which carries no org check). Mirrors record_fields_one_parent.
    if (v_prod is not null)::int + (v_gtm is not null)::int + (v_mod is not null)::int <> 1 then
      raise exception 'each field row needs exactly one parent (product_id, gtm_record_id, or module_id)';
    end if;
    if v_prod is not null and not exists (select 1 from product_records where id = v_prod and org_id = v_org) then
      raise exception 'product % not in this org', v_prod;
    end if;
    if v_gtm is not null and not exists (select 1 from gtm_records where id = v_gtm and org_id = v_org) then
      raise exception 'gtm record % not in this org', v_gtm;
    end if;
    if v_mod is not null and not exists (select 1 from modules where id = v_mod and org_id = v_org) then
      raise exception 'module % not in this org', v_mod;
    end if;

    insert into record_fields (org_id, product_id, gtm_record_id, module_id, field_key, label, value, section, position, field_kind, metric_unit)
    values (
      v_org, v_prod, v_gtm, v_mod,
      r->>'field_key',
      r->>'label',
      r->>'value',
      r->>'section',
      coalesce((r->>'position')::int, 0),
      coalesce(nullif(r->>'field_kind', ''), 'narrative'),
      r->>'metric_unit'
    );
  end loop;

  perform set_config('app.human_edit', '', true);
end
$$;

comment on function public.human_add_fields(jsonb) is
  'Human bulk-create channel for record fields. Takes a JSON array of field rows; sets org_id from current_org_id() (ignores client org_id), enforces exactly-one in-org parent per row, sets app.human_edit so the write-gate admits the inserts. Use instead of a raw record_fields insert from the client when rows carry a value.';

-- ---- 2) extend the gate to INSERT-with-value --------------------------------
create or replace function public.guard_record_field_value_write()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- An insert with no value is an empty slot (a metric field, or a blank field to
  -- be filled later) — additive, nothing to clobber, so it's not gated.
  if tg_op = 'INSERT' and new.value is null then
    return new;
  end if;

  -- A real value is being written (INSERT with value, or UPDATE OF value):
  -- require a trusted channel — a migration/dashboard (superuser), a ratified
  -- proposal (app.proposal_id), or a human edit (app.human_edit).
  if current_setting('is_superuser', true) = 'on'
     or coalesce(nullif(current_setting('app.proposal_id', true), ''), '') <> ''
     or current_setting('app.human_edit', true) = 'on' then
    return new;
  end if;

  raise exception
    'record_fields.value can change only through a ratified proposal (accept_proposal), a human edit (human_set_field_value), or a human create (human_add_fields) — direct writes are blocked by the HITL gate'
    using errcode = 'check_violation';
end
$$;

comment on function public.guard_record_field_value_write() is
  'BEFORE INSERT OR UPDATE OF value gate on record_fields: refuses any value write (insert-with-value or value update) not made through accept_proposal (app.proposal_id), human_set_field_value / human_add_fields (app.human_edit), or a superuser (migrations). Empty-slot inserts (value NULL) are allowed. Makes "agents propose, humans ratify" a database invariant.';

drop trigger if exists record_fields_value_write_gate on record_fields;
create trigger record_fields_value_write_gate
  before insert or update of value on record_fields
  for each row execute function public.guard_record_field_value_write();
