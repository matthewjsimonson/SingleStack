-- ============================================================================
-- Anti-conformity — surface the system's own MISSES, and flag STALE convictions.
-- Plain English: a system that learns from what you accept drifts toward telling
-- you what you already think. Two mechanisms push the other way:
--   • theme_misses — a theme you (or the engine) let FADE that has since picked
--     up fresh, independent evidence. The system says "you were wrong to drop
--     this; here's why it now looks right." Flattery's opposite.
--   • decision_staleness — a decision whose CITED evidence has shifted since it
--     was made (a cited theme gained contradicting evidence, faded, or lost
--     confidence). The best PMs revisit; this forces the revisit.
-- Both are deterministic VIEWS over existing data — no model guessing.
-- ============================================================================

-- ---- decisions.decided_at: anchor "since the decision was made" ------------
alter table decisions add column if not exists decided_at timestamptz;

-- Backfill: any already-decided/routed decision is anchored to its creation.
update decisions set decided_at = created_at where decided_at is null and status in ('decided','routed');

comment on column decisions.decided_at is 'When the decision was committed (status -> decided/routed). Anchor for staleness: evidence that shifts AFTER this is what makes a decision worth revisiting.';

-- ---- theme_misses: faded themes that picked up fresh evidence afterward -----
-- "When did this theme last go quiet?" = the most recent state_changed event to
-- fading/dormant. Supporting evidence added AFTER that timestamp = a miss.
create or replace view theme_misses as
  with faded as (
    select te.theme_id, max(te.created_at) as faded_at
      from theme_events te
     where te.kind = 'state_changed'
       and (te.detail->>'to') in ('fading','dormant')
     group by te.theme_id
  )
  select
    t.id as theme_id,
    t.title,
    t.category,
    t.state,
    f.faded_at,
    count(*) filter (where ts.stance = 'supports' and ts.added_at > f.faded_at) as new_support_signals,
    count(distinct coalesce(s.source_id::text, s.origin, s.id::text))
      filter (where ts.stance = 'supports' and ts.added_at > f.faded_at)        as new_support_sources,
    max(ts.added_at) filter (where ts.added_at > f.faded_at)                    as latest_new_evidence
  from faded f
  join signal_themes t on t.id = f.theme_id
  join theme_signals ts on ts.theme_id = t.id
  left join signals s on s.id = ts.signal_id
  where t.state in ('fading','dormant')        -- still sidelined…
  group by t.id, t.title, t.category, t.state, f.faded_at
  having count(*) filter (where ts.stance = 'supports' and ts.added_at > f.faded_at) > 0;  -- …but evidence kept coming

comment on view theme_misses is 'Themes that were let fade but have since accrued fresh supporting evidence (independent sources counted). The system surfacing its own misses — the antidote to learning only what the user already believes.';

-- ---- decision_staleness: convictions whose ground has shifted --------------
-- For each decided/routed decision, look at the themes it cited as evidence and
-- detect shifts that happened AFTER decided_at: contradicting evidence added,
-- the theme fading, or low current confidence.
create or replace view decision_staleness as
  with cited as (
    select d.id as decision_id, d.title, d.decided_at, de.theme_id
      from decisions d
      join decision_evidence de on de.decision_id = d.id and de.theme_id is not null
     where d.status in ('decided','routed') and d.decided_at is not null
  )
  select
    c.decision_id,
    c.title,
    c.decided_at,
    -- contradicting evidence added to a cited theme AFTER the decision
    count(*) filter (where ts.stance = 'contradicts' and ts.added_at > c.decided_at) as new_contradictions,
    -- a cited theme that has since faded/dormant
    bool_or(t.state in ('fading','dormant')) as cited_theme_faded,
    -- current honest confidence of cited themes (min, to flag the weakest)
    min(public.theme_confidence(t.id)) as min_cited_confidence
  from cited c
  join signal_themes t on t.id = c.theme_id
  left join theme_signals ts on ts.theme_id = t.id
  group by c.decision_id, c.title, c.decided_at
  having
       count(*) filter (where ts.stance = 'contradicts' and ts.added_at > c.decided_at) > 0
    or bool_or(t.state in ('fading','dormant'))
    or min(public.theme_confidence(t.id)) < 0.4;

comment on view decision_staleness is 'Decided/routed decisions whose cited evidence has shifted since decided_at: gained contradictions, the cited theme faded, or confidence fell below 0.4. Forces the revisit a great PM would make.';
