-- ============================================================================
-- Bridges — cross-lens Product↔GTM patterns. The differentiated insight.
-- Plain English: themes are siloed into product OR gtm. But the insight that
-- actually moves a business is usually the one that SPANS both — "positioning
-- works, but token economics is the build-side blocker." A bridge links a
-- product-side theme and a gtm-side theme into one pattern with its own
-- synthesized insight and a recommendation that typically demands action on
-- BOTH sides.
--
-- Honest confidence carries through: a bridge is only as strong as its WEAKER
-- leg (least of the two themes' honest confidence). A bridge that clears that
-- bar survived independent corroboration across two domains — the strongest
-- signal in the system. A bridge proposes in 'proposed' state; the human
-- confirms (active) or dismisses (graduated HITL, consistent with themes).
-- ============================================================================

create table bridges (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null,
  created_at       timestamptz not null default now(),

  title            text not null,
  insight          text,    -- the cross-lens synthesis (what the two halves mean together)
  recommendation   text,    -- the prescriptive move (usually two-sided)
  state            text not null default 'proposed',  -- proposed | active | dismissed

  product_theme_id uuid references signal_themes (id) on delete cascade,
  gtm_theme_id     uuid references signal_themes (id) on delete cascade,

  constraint bridges_state_shape check (state in ('proposed', 'active', 'dismissed')),
  -- A bridge must link exactly one product theme and one gtm theme.
  constraint bridges_two_legs check (product_theme_id is not null and gtm_theme_id is not null and product_theme_id <> gtm_theme_id),
  unique (product_theme_id, gtm_theme_id)
);

comment on table bridges is 'Cross-lens Product↔GTM patterns: a product theme and a gtm theme synthesized into one insight. Confidence is the weaker leg (bridge_confidence). The differentiated, hard-to-see insight a siloed feed misses.';

create index bridges_org_id_idx on bridges (org_id);
create index bridges_state_idx on bridges (state);
create index bridges_product_theme_idx on bridges (product_theme_id);
create index bridges_gtm_theme_idx on bridges (gtm_theme_id);

alter table bridges enable row level security;
create policy bridges_org_isolation on bridges
  for all using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

-- bridge_confidence(): a bridge is only as strong as its weaker leg. Honest by
-- construction — you can't paper over a thin side with a strong one.
create or replace function public.bridge_confidence(p_bridge_id uuid)
returns numeric
language sql
stable
as $$
  select case
    when b.product_theme_id is null or b.gtm_theme_id is null then 0::numeric
    else least(public.theme_confidence(b.product_theme_id), public.theme_confidence(b.gtm_theme_id))
  end
  from bridges b
  where b.id = p_bridge_id;
$$;

comment on function public.bridge_confidence(uuid) is 'A bridge is as strong as its WEAKER leg: least of the two themes'' honest confidence. Prevents a strong side from masking a thin one.';

-- A convenience view: bridges with both legs' titles + each side's confidence +
-- the bridge confidence, for the UI.
create or replace view bridge_strength as
  select
    b.id as bridge_id,
    b.title, b.insight, b.recommendation, b.state,
    b.product_theme_id, pt.title as product_theme_title, public.theme_confidence(b.product_theme_id) as product_conf,
    b.gtm_theme_id, gt.title as gtm_theme_title, public.theme_confidence(b.gtm_theme_id) as gtm_conf,
    public.bridge_confidence(b.id) as bridge_conf
  from bridges b
  left join signal_themes pt on pt.id = b.product_theme_id
  left join signal_themes gt on gt.id = b.gtm_theme_id;

comment on view bridge_strength is 'Per-bridge breakdown: both legs (title + honest confidence each) and the weaker-leg bridge confidence.';
