-- ============================================================================
-- The Sell loop, part 1 — accounts + usage ingest (PLG foundation).
--
-- "Product-led" means the product generates the sales motion: who activated,
-- who's expanding, who's at risk. Until now internal/usage signal was hand-
-- typed. This adds the spine to bring it in continuously and securely:
--
--   accounts       — the companies we track usage for (identity + latest
--                    rollup + scores filled by score-accounts).
--   account_events — append-only usage FACTS (aggregated rollups a customer
--                    posts — not raw clicks), the evidence behind every score.
--   ingest_keys    — per-org bearer keys (stored HASHED) that authenticate the
--                    inbound usage-ingest webhook. The customer pushes to us, so
--                    no outbound credential / secret store is needed — this
--                    ships before the connector secret store lands.
--
-- All org-isolated by RLS. The ingest function writes with the service role
-- (the webhook can't carry a user JWT) and fences every write to the org the
-- presented key resolves to.
-- ============================================================================

-- ---- accounts --------------------------------------------------------------
create table accounts (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  external_ref    text not null,                 -- the customer's id for this account (stable)
  name            text not null,
  domain          text,
  plan            text,
  status          text not null default 'active', -- prospect | active | churned
  metrics         jsonb,                          -- latest rollup snapshot (active_users, seats_used, …)
  last_seen_at    timestamptz,

  -- Filled by score-accounts (P2); nullable until first scored.
  activation_score numeric,                       -- 0..1
  expansion_score  numeric,                        -- 0..1
  churn_risk       numeric,                         -- 0..1
  pql_state        text not null default 'none',   -- none | activating | qualified | expansion | at_risk
  score_reason     text,
  scored_at        timestamptz,

  unique (org_id, external_ref),
  constraint accounts_status_chk check (status in ('prospect', 'active', 'churned')),
  constraint accounts_pql_state_chk check (pql_state in ('none', 'activating', 'qualified', 'expansion', 'at_risk')),
  constraint accounts_scores_chk check (
    (activation_score is null or (activation_score between 0 and 1)) and
    (expansion_score  is null or (expansion_score  between 0 and 1)) and
    (churn_risk       is null or (churn_risk       between 0 and 1))
  )
);
comment on table accounts is 'Companies whose product usage we track — the PLG / Sell loop. Identity + latest rollup; activation/expansion/churn scores filled by score-accounts.';

create index accounts_org_idx on accounts (org_id);
create index accounts_pql_idx on accounts (org_id, pql_state);

alter table accounts enable row level security;
create policy accounts_org_isolation on accounts for all
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

-- ---- account_events (usage facts; append-only evidence) --------------------
create table account_events (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  created_at   timestamptz not null default now(),

  account_id   uuid not null references accounts (id) on delete cascade,
  occurred_at  timestamptz not null default now(),
  kind         text not null,            -- e.g. activation | usage | feature_adopt | seat_add | login | expansion_intent | churn_risk
  value        numeric,                  -- a count/level where it applies
  properties   jsonb,
  ingest_key_id uuid                      -- provenance: which key posted it
);
comment on table account_events is 'Append-only aggregated usage facts per account (not raw clicks) — the evidence behind PQL scores.';

create index account_events_account_idx on account_events (account_id, occurred_at desc);
create index account_events_org_idx on account_events (org_id, occurred_at desc);

alter table account_events enable row level security;
create policy account_events_org_isolation on account_events for all
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

-- ---- ingest_keys (hashed bearer keys for the webhook) ----------------------
create table ingest_keys (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  created_at   timestamptz not null default now(),
  label        text not null,
  token_hash   text not null,            -- sha256(hex) of the raw token; raw is shown to the user ONCE, never stored
  last_used_at timestamptz,
  revoked      boolean not null default false,
  unique (token_hash)
);
comment on table ingest_keys is 'Per-org bearer keys for the usage-ingest webhook. Only the SHA-256 hash is stored; the raw token is shown once at creation. Auth = present the raw key in x-ingest-key; the function hashes + resolves the org.';

create index ingest_keys_org_idx on ingest_keys (org_id);
create index ingest_keys_hash_idx on ingest_keys (token_hash) where revoked = false;

alter table ingest_keys enable row level security;
-- Org members manage their own keys (insert the hash, list, revoke). The raw
-- token never round-trips through the DB. The ingest function reads via the
-- service role (RLS bypassed) to resolve an anonymous webhook to its org.
create policy ingest_keys_org_isolation on ingest_keys for all
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());
