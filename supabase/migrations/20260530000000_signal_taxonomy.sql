-- ============================================================================
-- Signal taxonomy — give every signal two clean, orthogonal axes.
-- Plain English: until now a signal's "product vs gtm" lens only existed on
-- synthesized THEMES, and its "internal vs external" origin only lived on the
-- attached SOURCE (so a signal with no source had no real origin). That made
-- the intel tabs impossible to organize by the two lenses that matter, and made
-- it impossible to point an agent at "product signals" vs "gtm signals".
--
-- This adds both axes directly onto a signal:
--   • category — what it INFORMS: 'product' (how you build/update the product),
--                'gtm' (how you go to market — sales, messaging, marketing,
--                pricing), or 'both'. NULL = not yet sorted (surfaced for triage
--                and auto-categorized by the synthesis engine).
--   • origin   — where it CAME FROM: 'internal' (your own tools & engagements)
--                or 'external' (the web / market / outside your org).
--
-- Backfill is conservative: origin is derived from the signal's source (inline
-- source_id first, then the signal_sources provenance join), defaulting to
-- 'internal'. category is left NULL so the synthesis engine can classify the
-- existing backlog without us guessing.
-- ============================================================================

-- ---- category: the product vs gtm lens -------------------------------------
alter table signals add column if not exists category text;

alter table signals drop constraint if exists signals_category_shape;
alter table signals add constraint signals_category_shape
  check (category is null or category in ('product', 'gtm', 'both'));

comment on column signals.category is
  'What the signal informs: product | gtm | both. NULL = unsorted (triage queue; auto-classified on synthesis). The Signals intel tabs are organized along this lens.';

-- ---- origin: the internal vs external lens ---------------------------------
-- Default 'internal' so manually-logged observations land somewhere sensible;
-- the log form sets it explicitly, and the synthesis engine reads it.
alter table signals add column if not exists origin text not null default 'internal';

alter table signals drop constraint if exists signals_origin_shape;
alter table signals add constraint signals_origin_shape
  check (origin in ('internal', 'external'));

comment on column signals.origin is
  'Where the signal came from: internal (your tools & engagements) vs external (web / market). Replaces deriving origin by joining the source, so source-less signals are categorized correctly.';

-- ---- backfill origin from the existing source linkage ----------------------
-- 1) inline primary source (signals.source_id).
update signals s
   set origin = src.origin
  from sources src
 where s.source_id = src.id
   and src.origin in ('internal', 'external');

-- 2) otherwise the first source in the many-to-many provenance join.
update signals s
   set origin = src.origin
  from signal_sources ss
  join sources src on src.id = ss.source_id
 where ss.signal_id = s.id
   and s.source_id is null
   and src.origin in ('internal', 'external');

-- 3) anything still unset defaults to internal (column default already covers
--    new rows; this normalizes any legacy nulls just in case).
update signals set origin = 'internal' where origin is null;

create index if not exists signals_category_idx on signals (category);
create index if not exists signals_origin_idx on signals (origin);
