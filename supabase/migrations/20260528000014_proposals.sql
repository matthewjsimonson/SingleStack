-- ============================================================================
-- proposals — a proposed change to a record, awaiting human approval.
-- Plain English: this is the unit of change. An agent (or a human) proposes
-- that a record should change — with a title, a rationale, a confidence, who
-- proposed it, and a status that moves pending -> accepted / rejected /
-- deferred. A proposal targets exactly one record (a product record OR a GTM
-- record). The specific field edits live in proposal_changes; the evidence
-- behind it lives in proposal_signals.
-- ============================================================================

-- Lifecycle of a proposal.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'proposal_status') then
    create type proposal_status as enum ('pending', 'accepted', 'rejected', 'deferred');
  end if;
end
$$;

create table proposals (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  created_at    timestamptz not null default now(),

  -- Target: exactly one of these is set (enforced by the CHECK below).
  product_id    uuid references product_records (id) on delete cascade,
  gtm_record_id uuid references gtm_records (id) on delete cascade,

  title         text not null,
  rationale     text,                                    -- the "why"
  conf_level    numeric(3,2),
  conf_label    text,
  proposed_by   text not null,                           -- agent name or human name
  status        proposal_status not null default 'pending',

  constraint proposals_one_target check (
    (product_id is not null)::int + (gtm_record_id is not null)::int = 1
  ),
  constraint proposals_conf_level_range
    check (conf_level is null or (conf_level >= 0 and conf_level <= 1))
);

comment on table proposals is 'A proposed change to a record, awaiting human approval. Field edits live in proposal_changes; backing evidence in proposal_signals.';
comment on constraint proposals_one_target on proposals is 'Each proposal targets exactly one record: a product_record OR a gtm_record.';

create index proposals_org_id_idx on proposals (org_id);
create index proposals_product_id_idx on proposals (product_id);
create index proposals_gtm_record_id_idx on proposals (gtm_record_id);
create index proposals_status_idx on proposals (status);

alter table proposals enable row level security;

create policy proposals_org_isolation on proposals
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());
