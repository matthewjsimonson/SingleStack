-- ============================================================================
-- personas — dynamic, reusable buyer audiences the customer defines.
-- The product is multi-tenant on three axes: products (already dynamic via scope),
-- industries, and personas. Personas/industries were only freeform text buried in a
-- GTM record's Buyer fields — not first-class, not reusable, not selectable. This
-- makes the AUDIENCE a real entity: a named persona (role + industry + definition)
-- the customer creates once and APPLIES across inputs/products to frame messaging.
-- Customers build for different personas and industries, so nothing is hardcoded.
-- ============================================================================

create table if not exists personas (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- scope: product-specific when set, org-wide (reusable across products) when null
  product_id    uuid references product_records (id) on delete cascade,
  -- optional source/tighter scope (where it was lifted from)
  gtm_record_id uuid references gtm_records (id) on delete set null,

  name          text not null,        -- e.g. "Product Manager"
  role          text,                 -- title / seniority detail
  industry      text,                 -- the vertical this audience sits in (dynamic, freeform)
  description   text,                  -- goals, pains, the persona definition
  source        text not null default 'manual'   -- manual | record_field | market_intel
);

comment on table personas is 'Dynamic, reusable buyer audiences (persona + industry + definition) the customer defines and applies across inputs/products to frame messaging. Product is multi-tenant on products/industries/personas — none hardcoded.';

create index if not exists personas_org_id_idx on personas (org_id);
create index if not exists personas_product_id_idx on personas (product_id);

alter table personas enable row level security;

create policy personas_org_isolation on personas
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- The audience a messaging brief is framed toward (optional; selected at draft time).
alter table messaging_artifacts
  add column if not exists persona_id uuid references personas (id) on delete set null;

comment on column messaging_artifacts.persona_id is 'The buyer persona/audience this brief is framed for (optional). Feeds the AI grounding so the message is tailored to that persona/industry.';

-- ----------------------------------------------------------------------------
-- Backfill: lift existing persona fields out of GTM record_fields into first-class
-- personas, so customers start with what they already wrote (Buyer > *persona*).
-- ----------------------------------------------------------------------------
insert into personas (org_id, gtm_record_id, product_id, name, description, source)
select rf.org_id, rf.gtm_record_id, g.product_id,
       nullif(trim(rf.label), ''), rf.value, 'record_field'
from record_fields rf
join gtm_records g on g.id = rf.gtm_record_id
where rf.gtm_record_id is not null
  and rf.field_key ilike '%persona%'
  and coalesce(trim(rf.value), '') <> ''
  and nullif(trim(rf.label), '') is not null;
