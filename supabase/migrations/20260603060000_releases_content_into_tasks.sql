-- ============================================================================
-- Roadmap (releases) and Content become OUTPUTS of task completion — not
-- separate artifact silos. Everything is a task (initiative_workstreams);
-- Roadmap and Content are lenses over tagged tasks.
--
--   • Build/product tasks gain change_type (feature | feature_update |
--     module_update | bug_fix | enhancement) and release_id — so finishing
--     them populates the Roadmap's release changelog (the output people want
--     to see).
--   • GTM/content tasks gain content_type (social | video | blog |
--     thought_leadership | case_study | white_paper | testimonial), a body,
--     and a details JSONB (the video/Descript flow) — so Content is a typed
--     studio over content tasks. They tie to a release and/or campaign, and
--     still roll up to their initiative like any task.
-- ============================================================================
alter table initiative_workstreams add column if not exists release_id   uuid references releases (id)  on delete set null;
alter table initiative_workstreams add column if not exists campaign_id  uuid references campaigns (id) on delete set null;
alter table initiative_workstreams add column if not exists change_type  text;   -- build/product: feature | feature_update | module_update | bug_fix | enhancement
alter table initiative_workstreams add column if not exists content_type text;   -- gtm content: social | video | blog | thought_leadership | case_study | white_paper | testimonial
alter table initiative_workstreams add column if not exists body         text;   -- content body (article / outline / talk track)
alter table initiative_workstreams add column if not exists details      jsonb;  -- rich payload: { hook, script, prompts[], descript_steps[], ... }

comment on column initiative_workstreams.release_id   is 'Roadmap link: when a build task is done, it appears in this release''s changelog. Launch content can tie to a release too.';
comment on column initiative_workstreams.campaign_id  is 'Campaign link for GTM/content tasks.';
comment on column initiative_workstreams.change_type  is 'For build/product tasks — what ships: feature | feature_update | module_update | bug_fix | enhancement.';
comment on column initiative_workstreams.content_type is 'For content tasks — social | video | blog | thought_leadership | case_study | white_paper | testimonial.';
comment on column initiative_workstreams.details      is 'Rich content payload (e.g. the video/Descript flow: hook/script/prompts/steps).';

create index if not exists initiative_workstreams_release_idx  on initiative_workstreams (release_id);
create index if not exists initiative_workstreams_campaign_idx on initiative_workstreams (campaign_id);
create index if not exists initiative_workstreams_content_idx  on initiative_workstreams (content_type);
