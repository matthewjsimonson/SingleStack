-- ============================================================================
-- decisions — the missing link between Intelligence and Ship.
-- Plain English: a synthesized theme produces a recommendation, but a
-- recommendation isn't an action — a DECISION is. A decision is a deliberate
-- human call on a bet/question, chosen among OPTIONS that each carry explicit
-- tradeoffs, backed by cited EVIDENCE (themes/signals). Ratifying a decision can
-- ROUTE it downstream — most importantly, spawn a Ship build item whose "Why" is
-- pre-filled from the decision. Pointed and configurable: not a text box, but
-- options + tradeoffs + a chosen call, all traceable.
--
--   decisions          — the bet/question, scope, status, the chosen option, owner
--   decision_options   — each option with its tradeoffs; one may be 'recommended'
--   decision_evidence  — what backs it: a real FK to a signal_theme or a signal
--   initiatives.decision_id — a build item spawned by a decision (provenance)
-- ============================================================================

create table decisions (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  created_at    timestamptz not null default now(),

  -- Scope: org-wide, or tied to a product / gtm line of business.
  scope         text not null default 'org',   -- org | product | gtm
  product_id    uuid references product_records (id) on delete set null,
  gtm_record_id uuid references gtm_records (id) on delete set null,

  -- Optional origin: the theme this decision was made from.
  theme_id      uuid references signal_themes (id) on delete set null,

  title         text not null,                 -- the bet, e.g. "How we answer post-demo pricing friction"
  question      text,                           -- the precise question being decided
  status        text not null default 'open',  -- open | decided | routed
  chosen_option_id uuid,                        -- set when decided (FK added after options table)
  rationale     text,                           -- why this call (the human's reasoning)
  owner         text,                           -- who owns the decision (name/agent, text for now)
  conf_level    numeric(3,2),

  constraint decisions_conf_range check (conf_level is null or (conf_level >= 0 and conf_level <= 1)),
  constraint decisions_scope_shape check (
    (scope = 'org'     and product_id is null and gtm_record_id is null) or
    (scope = 'product' and product_id is not null and gtm_record_id is null) or
    (scope = 'gtm'     and gtm_record_id is not null and product_id is null)
  )
);

comment on table decisions is 'A deliberate human call on a bet, chosen among options with tradeoffs, backed by cited evidence. Can route downstream (spawn a Ship build item). The link between synthesized intel and action.';

create index decisions_org_id_idx on decisions (org_id);
create index decisions_theme_id_idx on decisions (theme_id);
create index decisions_status_idx on decisions (status);

alter table decisions enable row level security;
create policy decisions_org_isolation on decisions
  for all using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

-- ---- decision_options: the choices, each with explicit tradeoffs -----------
create table decision_options (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  created_at    timestamptz not null default now(),

  decision_id   uuid not null references decisions (id) on delete cascade,
  title         text not null,                 -- the option in a phrase
  detail        text,                           -- what it means concretely
  tradeoffs     text,                           -- the cost/risk of choosing it
  recommended   boolean not null default false, -- AI/human flag: the suggested pick
  position      integer not null default 0
);

comment on table decision_options is 'An option for a decision, with its concrete detail and explicit tradeoffs. One may be flagged recommended. Pointed & configurable — decisions are made among real options, not freetext.';

create index decision_options_org_id_idx on decision_options (org_id);
create index decision_options_decision_id_idx on decision_options (decision_id);

alter table decision_options enable row level security;
create policy decision_options_org_isolation on decision_options
  for all using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

-- Now that decision_options exists, point decisions.chosen_option_id at it.
alter table decisions
  add constraint decisions_chosen_option_fk
  foreign key (chosen_option_id) references decision_options (id) on delete set null;

-- ---- decision_evidence: real FK provenance to themes / signals -------------
create table decision_evidence (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  created_at    timestamptz not null default now(),

  decision_id   uuid not null references decisions (id) on delete cascade,
  -- Exactly one of these is set: the evidence is a theme OR a signal.
  theme_id      uuid references signal_themes (id) on delete cascade,
  signal_id     uuid references signals (id) on delete cascade,

  constraint decision_evidence_one_kind check (
    (theme_id is not null)::int + (signal_id is not null)::int = 1
  )
);

comment on table decision_evidence is 'What backs a decision: a real FK to a signal_theme or a signal. Provenance is a relationship, never a text field.';

create index decision_evidence_org_id_idx on decision_evidence (org_id);
create index decision_evidence_decision_id_idx on decision_evidence (decision_id);

alter table decision_evidence enable row level security;
create policy decision_evidence_org_isolation on decision_evidence
  for all using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

-- ---- initiatives.decision_id: a build item spawned by a decision -----------
alter table initiatives
  add column if not exists decision_id uuid references decisions (id) on delete set null;

comment on column initiatives.decision_id is 'If set, this build item was routed from a decision — the Why traces back to the decision and its cited evidence.';

create index if not exists initiatives_decision_id_idx on initiatives (decision_id);
