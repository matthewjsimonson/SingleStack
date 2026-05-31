-- ============================================================================
-- Honest confidence — evidence can CUT AGAINST a theme, and confidence comes
-- from INDEPENDENT corroboration, not signal count.
-- Plain English: a compounding system that only ever accretes agreement becomes
-- an echo chamber — most confident about whatever is most repeated, blind to
-- what would kill the idea. Two changes fix that:
--   • theme_signals.stance — 'supports' (default) or 'contradicts'. Evidence can
--     now disconfirm a theme. Disconfirmation is first-class.
--   • a confidence based on the number of INDEPENDENT SOURCES behind the
--     supporting evidence, dampened by contradiction — not the raw row count.
--     5 signals from one source ≠ 3 from 3 sources. Computed in a function so
--     the synthesis engine and the UI agree.
--
-- Additive; existing evidence defaults to 'supports' so nothing changes shape.
-- ============================================================================

-- ---- 1) stance on evidence -------------------------------------------------
alter table theme_signals add column if not exists stance text not null default 'supports';
alter table theme_signals drop constraint if exists theme_signals_stance_shape;
alter table theme_signals add constraint theme_signals_stance_shape
  check (stance in ('supports', 'contradicts'));

comment on column theme_signals.stance is 'Whether this signal SUPPORTS the theme or CONTRADICTS it. Disconfirming evidence is first-class — a theme that survives contradiction is a real bet, not a bubble.';

create index if not exists theme_signals_stance_idx on theme_signals (stance);

-- ---- 2) theme_confidence(): independence-weighted, disconfirmation-aware ----
-- Confidence reflects how many INDEPENDENT sources corroborate the theme, net of
-- contradiction — NOT how many rows exist. A signal's "source" is its source_id
-- when present, else its origin bucket, else the signal id (treated as its own
-- source). This is the antidote to evidence laundering.
create or replace function public.theme_confidence(p_theme_id uuid)
returns numeric
language sql
stable
as $$
  with ev as (
    select ts.stance,
           coalesce(s.source_id::text, s.origin, s.id::text) as source_key
      from theme_signals ts
      join signals s on s.id = ts.signal_id
     where ts.theme_id = p_theme_id
  ),
  agg as (
    select
      count(distinct source_key) filter (where stance = 'supports')     as support_sources,
      count(distinct source_key) filter (where stance = 'contradicts')  as contra_sources
    from ev
  )
  select case
    when support_sources = 0 then 0::numeric
    else round(
      least(1.0,
        -- diminishing returns on corroboration breadth: 1 src≈.45, 2≈.62, 3≈.73, 5≈.86
        (1 - exp(-0.6 * support_sources))
        -- each independent contradiction meaningfully dampens conviction
        * (1 - least(0.8, 0.30 * contra_sources))
      ), 2)
  end
  from agg;
$$;

comment on function public.theme_confidence(uuid) is 'Honest confidence for a theme: rises with the number of INDEPENDENT sources that support it (diminishing returns), dampened by independent contradicting sources. Not a function of raw signal count — defeats evidence laundering and rewards disconfirmation-tested themes.';

-- A convenience view the UI can read for the breakdown (support vs contra sources).
create or replace view theme_evidence_strength as
  select
    t.id as theme_id,
    count(*) filter (where ts.stance = 'supports')    as support_signals,
    count(*) filter (where ts.stance = 'contradicts') as contra_signals,
    count(distinct coalesce(s.source_id::text, s.origin, s.id::text))
      filter (where ts.stance = 'supports')           as support_sources,
    count(distinct coalesce(s.source_id::text, s.origin, s.id::text))
      filter (where ts.stance = 'contradicts')        as contra_sources,
    public.theme_confidence(t.id)                     as honest_conf
  from signal_themes t
  left join theme_signals ts on ts.theme_id = t.id
  left join signals s on s.id = ts.signal_id
  group by t.id;

comment on view theme_evidence_strength is 'Per-theme evidence breakdown: supporting vs contradicting signals AND independent sources, plus honest_conf. Surfaces "3 signals but only 1 source" and "escalating despite 2 contradictions".';
