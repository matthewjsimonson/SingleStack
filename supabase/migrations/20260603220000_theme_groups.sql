-- ============================================================================
-- Theme groups — the strategic grouping layer over merged signals.
--
-- signal_themes already MERGE related signals (AI via synthesize-signals, or a
-- human merge). This adds the GROUP axis: a theme is classified into a strategic
-- category — feature_gap | expansion | big_bet | quality | adjacent — formed
-- from customer feedback, bug tickets, competitive-matrix gaps, frontier-model
-- capabilities, and persona/industry signals. NULL = unsorted. No hard CHECK:
-- AI and humans can introduce new groups over time.
-- ============================================================================

alter table signal_themes add column if not exists group_label text;
comment on column signal_themes.group_label is 'Strategic group: feature_gap | expansion | big_bet | quality | adjacent (Product Strategy). NULL = unsorted.';
create index if not exists signal_themes_group_idx on signal_themes (org_id, group_label);

-- Mark how a theme was merged, so AI vs human merges are distinguishable.
alter table signal_themes add column if not exists merged_by text not null default 'human';
comment on column signal_themes.merged_by is 'How the theme was formed: human | synthesis (AI).';
