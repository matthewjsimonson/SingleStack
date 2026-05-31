-- ============================================================================
-- Connect-a-source — make sources source-type-agnostic, controllable, and
-- secure-by-design. Connectivity is a product goal: G2, LinkedIn (posts + jobs),
-- websites, YouTube transcripts, and whatever's next — all through ONE model.
--
-- Two mandates beyond "ingest more":
--  1. NEVER drown the user. Every source carries a TAILORING + BUDGET so it
--     yields a focused trickle of high-signal items, not a firehose.
--  2. Security is visible. A source declares what it can access (auth_mode,
--     access_scope) and stores NO secrets in config — only a handle to a vault.
--
-- All additive/nullable; existing sources behave unchanged.
-- ============================================================================

-- ---- tailoring + control (anti-overload) -----------------------------------
-- focus: which lens this source feeds (product | gtm | both | null = unset).
alter table sources add column if not exists focus text;
-- include/exclude: natural-language steering, distinct from the freeform `rules`.
alter table sources add column if not exists include_terms text;   -- "only pull items about X, Y"
alter table sources add column if not exists exclude_terms text;    -- "ignore X, Y (bias/noise control)"
-- max_per_pull: hard cap on signals a single pull can create — the budget that
-- guarantees a trickle, not a flood. NULL = use a sensible default per kind.
alter table sources add column if not exists max_per_pull integer;
-- min_relevance: 0..1 floor; the connector drops anything below this so only
-- high-signal items become signals. NULL = default.
alter table sources add column if not exists min_relevance numeric(3,2);
-- cadence: how often a live connector pulls (manual | daily | weekly).
alter table sources add column if not exists cadence text not null default 'manual';

alter table sources drop constraint if exists sources_focus_shape;
alter table sources add constraint sources_focus_shape
  check (focus is null or focus in ('product','gtm','both'));
alter table sources drop constraint if exists sources_cadence_shape;
alter table sources add constraint sources_cadence_shape
  check (cadence in ('manual','daily','weekly'));
alter table sources drop constraint if exists sources_min_relevance_range;
alter table sources add constraint sources_min_relevance_range
  check (min_relevance is null or (min_relevance >= 0 and min_relevance <= 1));
alter table sources drop constraint if exists sources_max_per_pull_range;
alter table sources add constraint sources_max_per_pull_range
  check (max_per_pull is null or (max_per_pull >= 1 and max_per_pull <= 100));

comment on column sources.focus is 'Lens this source feeds: product | gtm | both. Keeps a source on-target.';
comment on column sources.include_terms is 'Natural-language steer: only pull items matching these. Focus control.';
comment on column sources.exclude_terms is 'Natural-language steer: ignore these. Bias/noise control — keeps the source from drifting.';
comment on column sources.max_per_pull is 'Hard cap on signals created per pull (1..100). The budget that prevents overload. NULL = per-kind default.';
comment on column sources.min_relevance is 'Relevance floor 0..1; the connector drops items below it so only high-signal items land. NULL = default.';
comment on column sources.cadence is 'manual | daily | weekly — how often a live connector pulls.';

-- ---- security (visible, secrets never in config) ---------------------------
-- auth_mode: how we reach it. none (public web/youtube) | oauth | api_key | mcp.
alter table sources add column if not exists auth_mode text not null default 'none';
-- access_scope: human-readable "what this can see/do" surfaced in the UI so the
-- user always knows the blast radius (e.g. "read-only: public posts").
alter table sources add column if not exists access_scope text;
-- secret_ref: a HANDLE to a credential in the secret store — NEVER the secret.
-- (The vault/secret store lands with the runner; this reserves the contract.)
alter table sources add column if not exists secret_ref text;
-- last_pull_at / last_pull_count: audit + transparency for the source health UI.
alter table sources add column if not exists last_pull_at timestamptz;
alter table sources add column if not exists last_pull_count integer;

alter table sources drop constraint if exists sources_auth_mode_shape;
alter table sources add constraint sources_auth_mode_shape
  check (auth_mode in ('none','oauth','api_key','mcp'));

comment on column sources.auth_mode is 'How we authenticate to reach the source: none (public) | oauth | api_key | mcp.';
comment on column sources.access_scope is 'Human-readable description of exactly what this source can access (read-only scope), surfaced in the UI so the blast radius is always visible.';
comment on column sources.secret_ref is 'Handle to a credential in the secret store — NEVER the secret itself. Secrets never live in config.';
comment on column sources.last_pull_at is 'When the connector last pulled (audit/transparency).';
comment on column sources.last_pull_count is 'How many signals the last pull produced (so the user sees volume at a glance).';

-- Defense-in-depth: guarantee no one ever stuffs a raw credential into config.
-- (Belt-and-suspenders next to the app contract.)
alter table sources drop constraint if exists sources_no_secrets_in_config;
alter table sources add constraint sources_no_secrets_in_config
  check (
    config is null or not (
      config ? 'password' or config ? 'token' or config ? 'secret'
      or config ? 'api_key' or config ? 'apiKey' or config ? 'access_token'
    )
  );
