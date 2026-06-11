-- ============================================================================
-- Phase 5 — Battlecard agent pair (analyst + messaging): the schema half.
-- Plain English: battlecards live in two places with different jobs —
-- battlecard_items (structured facts: why we win/lose) and the GTM record's
-- Battlecard section (the narrative we SAY about it). Two agents curate them:
-- a grounded ANALYST that proposes battlecard items from a competitor's themes
-- + the capability matrix (every item citing its signals), and a creative
-- MESSAGING agent that turns ratified items into seller-facing copy via the
-- existing proposals → accept_proposal field gate.
--
-- Curation flow: signals → competitor themes → analyst proposes battlecard
-- items (intel_updates gate) → human ratifies → messaging agent drafts GTM
-- Battlecard fields (proposals gate) → human ratifies.
-- ============================================================================

-- ---- 1. battlecard_items: provenance for agent-proposed items ---------------
-- An analyst-proposed item cites the evidence that backs it. signal_ids follows
-- the signal_themes.signal_ids precedent (evidence list, not a relationship —
-- theme_signals remains the joinable link for themes). theme_id ties an item to
-- the competitor theme that motivated it; set null on delete because the item
-- stays true even if the theme is later merged away.
alter table battlecard_items add column if not exists theme_id uuid references signal_themes (id) on delete set null;
comment on column battlecard_items.theme_id is 'The competitor theme that motivated this item (analyst-proposed). NULL = human-entered or no single theme.';
alter table battlecard_items add column if not exists signal_ids uuid[] not null default '{}';
comment on column battlecard_items.signal_ids is 'Supporting signal ids cited by the analyst — every agent-proposed item carries its evidence. Empty = human-entered.';
alter table battlecard_items add column if not exists proposed_by text;
comment on column battlecard_items.proposed_by is 'Agent name when agent-proposed (e.g. "Competitive analyst"); NULL = human-entered.';
create index if not exists battlecard_items_theme_id_idx on battlecard_items (theme_id);

-- ---- 2. intel_updates: admit battlecard items to the review gate -------------
-- scope was designed "room to grow"; battlecard_item is the analyst's proposal
-- kind. Same pending → accept/edit/reject loop, same rationale teaching.
alter table intel_updates drop constraint if exists intel_updates_kind_shape;
alter table intel_updates add constraint intel_updates_kind_shape
  check (kind in ('new_theme','escalate','merge','decay','restate','set_dimension','battlecard_item'));

-- ---- 3. proposal_changes.section: added fields land in their section ---------
-- The messaging agent adds fields under the GTM record's "Battlecard" section,
-- but add_field had no way to carry a section — accepted fields fell into the
-- ungrouped bucket. Additive column + accept_proposal propagates it.
alter table proposal_changes add column if not exists section text;
comment on column proposal_changes.section is 'For add_field: the section the new field belongs to (e.g. "Battlecard"). NULL = ungrouped.';

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
end
$$;

comment on function public.accept_proposal(uuid, text) is
  'Applies a pending proposal: writes each field edit (updating or adding a record_field, honoring its section), records a ratification per edit, links the resulting revisions to the proposal, and marks the proposal accepted. Refuses proposals outside the caller''s org.';
