-- ============================================================================
-- Themes into epics — consolidate the model: signals → THEMES → epics.
--
--   • A theme gains human-editable CONTEXT and a WATCH flag (importance).
--   • A theme is PUSHED INTO an epic via signal_themes.bundle_id (the epic uses
--     its themes; signals reach the epic THROUGH their themes).
-- Groups are not a separate object — group_label (added earlier) is simply how
-- themes are sorted. This migration adds the theme depth + the theme→epic link.
-- ============================================================================

alter table signal_themes add column if not exists context   text;
alter table signal_themes add column if not exists watched   boolean not null default false;
alter table signal_themes add column if not exists bundle_id uuid references strategy_bundles (id) on delete set null;

comment on column signal_themes.context   is 'Human-added context on the theme (beyond the synthesized summary).';
comment on column signal_themes.watched    is 'Watch importance — flagged to keep an eye on.';
comment on column signal_themes.bundle_id  is 'The epic (strategy_bundle) this theme has been pushed into. NULL = not yet in an epic.';

create index if not exists signal_themes_bundle_idx on signal_themes (bundle_id);
