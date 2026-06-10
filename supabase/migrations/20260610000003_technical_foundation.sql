-- ============================================================================
-- Phase 3 — Technical foundation (product & module level).
-- Plain English: the product record captures WHAT the product is and WHO it's
-- for, but nothing captures HOW the solution actually does what it does — its
-- architecture, what each module is built on, and where the implementation is
-- aging. That technical layer is what lets a team evolve deliberately as new
-- technologies come online, instead of silently accruing tech debt.
--
-- Two additive changes, no new tables (reuse the agnostic record_fields spine):
--
--   1. record_fields.module_id — a THIRD parent, so a MODULE can carry its own
--      technical fields (how it works / what it's built on / debt notes), the
--      same way a product or gtm record carries fields. The "exactly one parent"
--      invariant widens from two to three.
--
--   2. signals.module_id — so a product-lens signal that flags a technical shift
--      (a new model, API, or platform capability) can attach to the MODULE it
--      affects. The module's technical panel then shows its open signals beside
--      its stated technical detail — drift between the two is the tech-debt
--      early warning.
--
-- NOTE: this is the STANDING technical description of the product/module. It is
-- distinct from a Build Item's Technical Scope (build_context_links), which is
-- an executable context bundle for a coding agent on one initiative. Different
-- jobs: this says "how the module works today"; that says "what an agent needs
-- to ship this change".
-- ============================================================================

-- ---- 1. record_fields: add MODULE as a third parent -------------------------
alter table record_fields add column if not exists module_id uuid references modules (id) on delete cascade;
comment on column record_fields.module_id is 'When set, this field describes a MODULE (its technical detail). The third parent alongside product_id and gtm_record_id; exactly one is set.';

-- Widen the "exactly one parent" invariant from two parents to three. The
-- existing rows (product or gtm parent, module_id null) still satisfy it, and
-- accept_proposal()'s inserts (product/gtm parent) stay valid.
alter table record_fields drop constraint if exists record_fields_one_parent;
alter table record_fields add constraint record_fields_one_parent check (
  (product_id is not null)::int + (gtm_record_id is not null)::int + (module_id is not null)::int = 1
);
comment on constraint record_fields_one_parent on record_fields is 'Each field points at exactly one parent: a product_record, a gtm_record, OR a module.';

-- A field key is unique within its module parent (mirrors the product/gtm uniqs).
create unique index if not exists record_fields_module_key_uniq
  on record_fields (module_id, field_key) where module_id is not null;
create index if not exists record_fields_module_id_idx on record_fields (module_id);

-- ---- 2. signals: attach to the module a technical shift affects -------------
-- on delete set null: deleting a module never destroys the intelligence it
-- informed — the signal just loses its module link (consistent with the
-- "intelligence is never destroyed" principle used across the spine).
alter table signals add column if not exists module_id uuid references modules (id) on delete set null;
comment on column signals.module_id is 'The module this signal informs (a technical shift affecting it). NULL = not module-specific. Product-lens; pairs with the module''s technical fields to flag drift / evolution.';
create index if not exists signals_module_id_idx on signals (module_id);
