-- Migration: workflow_area_binding  (prescriptive coverage)
-- Purpose: give a workflow its ONE owning area (by purpose) and a link to the
--   STANDARD playbook it instantiates — so coverage can ask "is this area's standard
--   playbook present & staffed?" instead of matching any workflow loosely. Grounded in
--   the playbook research: one-area-by-purpose (single accountable owner; a capability
--   appears once and only once), with skills as the shared many-to-many.
--     • area_id      — the single owning area (FK to areas; null = unmapped/legacy).
--     • standard_key — the STANDARD_PLAYBOOKS key this workflow instantiates
--                      (web/lib/playbooks.ts). null = a CUSTOM workflow (no parent).
--   (Tailored-vs-custom drift tracking — storing the diff against the parent standard —
--   is a later refinement; this lands the binding the coverage rework needs.)
-- Additive + safe. Conventions: matches the existing workflows table (3-col spine,
--   current_org_id RLS already present).
-- Author: SingleStack · Date: 2026-06-15

alter table workflows
  add column if not exists area_id uuid references public.areas (id) on delete set null;
alter table workflows
  add column if not exists standard_key text;

comment on column workflows.area_id is 'The single PLG area this workflow owns/serves (one-area-by-purpose). Null = unmapped — such workflows do not appear under any area.';
comment on column workflows.standard_key is 'The STANDARD_PLAYBOOKS key (web/lib/playbooks.ts) this workflow instantiates. Null = a custom workflow with no standard parent.';

create index if not exists workflows_area_id_idx on workflows (org_id, area_id);
create index if not exists workflows_standard_key_idx on workflows (org_id, standard_key);

-- RLS already enabled on workflows with workflows_org_isolation (current_org_id);
-- the new columns inherit it.
