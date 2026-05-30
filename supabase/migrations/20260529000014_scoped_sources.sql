-- ============================================================================
-- Sources go everywhere, and get scoped. Plain English:
--   Source management shouldn't live only in Settings. Sources attach to a
--   place: an org-wide signal source, a competitor's sources (their site,
--   LinkedIn, YouTube, support docs; plus internal transcripts/CRM/SME docs
--   about them), or a market lens. So:
--     • sources.competitor_id  — a source specific to one competitor.
--     • sources.market_lens    — a market source bound to analysts/industry/
--                                persona/tech.
--     • sources.rules          — freeform dynamic rules ("only X", keywords)
--                                so you can get granular about what to pull.
--   These are additive; existing org-wide sources have both null.
-- ============================================================================

alter table sources add column if not exists competitor_id uuid references competitors (id) on delete cascade;
alter table sources add column if not exists market_lens text;   -- analysts | industry | persona | tech | null
alter table sources add column if not exists rules text;          -- dynamic filtering rules, freeform for now

comment on column sources.competitor_id is 'If set, this source is specific to one competitor (their website, LinkedIn, YouTube, support docs, or internal docs about them).';
comment on column sources.market_lens is 'If set, this source feeds a market swimlane: analysts | industry | persona | tech.';
comment on column sources.rules is 'Dynamic rules to get the right info (keywords, filters). Freeform now; structured/executed when the connector runtime ships.';

create index if not exists sources_competitor_id_idx on sources (competitor_id);
create index if not exists sources_market_lens_idx on sources (market_lens);
