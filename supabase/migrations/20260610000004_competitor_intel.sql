-- ============================================================================
-- Phase 4 — Competitor signals → per-competitor themes.
-- Plain English: competitive observations are already logged as signals, but the
-- competitor link lived in `signals.metadata->>'competitor_id'` — a relationship
-- stored as a JSON string, which can't be a real FK, can't cascade, and is
-- awkward for synthesis to read. This promotes that link to a FIRST-CLASS column
-- (schema skill §4 First-Class Test / §8 — relationships are not JSON), and adds
-- the same link to themes so signal → theme synthesis can run PER COMPETITOR.
--
-- Grouping reuses the existing `category` axis (product | gtm) rather than a new
-- competitor taxonomy: per competitor, themes split into PRODUCT moves (launches,
-- deprecations, platform bets → capability matrix / our technical foundation) and
-- GTM moves (pricing, packaging, messaging → battlecards / our GTM messaging).
-- One taxonomy across the whole app; each competitor theme lands next to the
-- artifact it should change. competitor_id = NULL stays the org-wide Market view.
-- ============================================================================

-- ---- 1. signals.competitor_id — promote the JSON link to a real FK ----------
-- on delete set null: a competitor's deletion is an informational reference, not
-- structural — the signal (intelligence) survives, it just loses the link.
alter table signals add column if not exists competitor_id uuid references competitors (id) on delete set null;
comment on column signals.competitor_id is 'The competitor this signal is about (NULL = general/market). First-class promotion of the former metadata->>''competitor_id''; drives per-competitor synthesis.';
create index if not exists signals_competitor_id_idx on signals (competitor_id);

-- Backfill from the legacy JSON link. Guarded: only well-formed UUIDs that point
-- at a competitor that still exists (so the new FK can't be violated). The Feed
-- continues to dual-write metadata.competitor_id, so legacy readers (the
-- capability cell drawer, synthesize-profile) keep working unchanged.
update signals s
set competitor_id = (s.metadata->>'competitor_id')::uuid
where s.competitor_id is null
  and s.metadata ? 'competitor_id'
  and s.metadata->>'competitor_id' ~ '^[0-9a-fA-F-]{36}$'
  and exists (select 1 from competitors c where c.id = (s.metadata->>'competitor_id')::uuid);

-- ---- 2. signal_themes.competitor_id — per-competitor themes ------------------
-- on delete set null: a per-competitor theme without its competitor degrades to
-- an org-wide market theme rather than vanishing — intelligence is never lost.
alter table signal_themes add column if not exists competitor_id uuid references competitors (id) on delete set null;
comment on column signal_themes.competitor_id is 'The competitor this theme synthesizes (NULL = org-wide market theme). Set by synthesis when a theme''s evidence unanimously points at one competitor. Pairs with category (product|gtm) to land the theme next to the artifact it should change.';
create index if not exists signal_themes_competitor_id_idx on signal_themes (competitor_id);
