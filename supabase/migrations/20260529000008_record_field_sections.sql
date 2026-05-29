-- ============================================================================
-- record_fields.section — group fields into visual sections.
-- Plain English: a record is more than a flat list of fields. A product record
-- has an Overview, Technical details, etc.; a GTM record has Company narrative,
-- Product messaging, Personas. Rather than hardcode those (which would break the
-- agnostic model), we add an optional free-text `section` to each field so the
-- UI can group fields into labelled, visually-structured panels. NULL section =
-- ungrouped ("Details"). Clients/templates choose their own section names.
-- ============================================================================

alter table record_fields add column if not exists section text;

comment on column record_fields.section is
  'Optional grouping label so the UI can render fields in structured sections (e.g. "Overview", "Technical", "Personas"). NULL = ungrouped. Free text — section names are data, not a fixed enum.';

create index if not exists record_fields_section_idx on record_fields (section);
