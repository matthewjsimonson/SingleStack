-- ============================================================================
-- campaigns.campaign_kind — how a campaign delivers.
-- The Assign step of the GTM workflow routes produced items to campaigns, and a
-- campaign is one of two kinds: EXTERNAL (market-facing, for pipeline) or INTERNAL
-- (for the GTM org's own use — enablement/ops/field readiness). Additive only.
-- ============================================================================

alter table campaigns
  add column if not exists campaign_kind text not null default 'external';

alter table campaigns drop constraint if exists campaigns_kind_shape;
alter table campaigns
  add constraint campaigns_kind_shape check (campaign_kind in ('external', 'internal'));

comment on column campaigns.campaign_kind is 'external = market-facing campaign for pipeline; internal = for the GTM org''s own use (enablement/readiness). Drives the Assign step routing.';
