---
name: singlestack-schema
description: Govern the SingleStack data model — what becomes a table, what becomes a column, naming conventions, multi-tenancy, foreign keys, versioning, and the rules for adding new entities or modules. Use this skill any time you are designing or modifying a Supabase table, writing a migration, adding a new module to SingleStack, deciding whether something deserves its own table, or modeling a new artifact (Product Record, Module, Feature, GTM Record, Signal, Source, Agent, Ratification, Proposal). This skill governs structure; the singlestack-ui skill governs surfaces; the supabase-patterns skill governs implementation safety.
---

# SingleStack Schema Skill

This skill is the constitution of the SingleStack data layer. Every table, column, foreign key, and relation in the platform answers to these rules. The point is consistency under pressure: when the product is moving fast and adding modules, the rules below are what keep the schema from drifting into a swamp.

The non-negotiables come first. Everything else is in service of them.

---

## 1. The Five Non-Negotiables

These are absolute. A migration that violates any of them does not ship, even if the feature ships without it.

**1.1 The Product Record is the hub.** Every meaningful artifact in SingleStack ultimately belongs to a Product Record — directly via foreign key, or indirectly through one hop (e.g., a Feature belongs to a Product Record; a Ratification belongs to a Feature). No artifact floats free. If you cannot trace an artifact to a Product Record in ≤2 joins, the model is wrong.

**1.2 Every table carries `org_id`.** No exceptions. Not auxiliary tables, not enums-as-tables, not pivot tables. `org_id` is the multi-tenancy boundary, the RLS predicate, and the leading column of every composite index. A table without `org_id` is a future security incident.

**1.3 Provenance is a first-class concern, not a column.** Sources are a table, not a string. Anything an AI agent generated, retrieved, or referenced is linked to a Source row. The Source table earns its keep by being queryable, joinable, and versionable. A `source_url TEXT` column is a code smell.

**1.4 Ratification is field-level.** Approval lives on the relationship between a human, a field, and a value at a moment in time. Not on the row, not on the artifact, not on the module. A Ratification row identifies what was approved, by whom, when, against what prior value, and from what Source. This is the audit trail and the rollback target.

**1.5 Real foreign keys, always.** Every relationship is a `FOREIGN KEY` constraint with explicit `ON DELETE` and `ON UPDATE` behavior. Application-level joins ("we'll just match by UUID in code") are forbidden. The database enforces structural integrity; the application enforces business rules.

---

## 2. Mental Model: Hub-and-Spoke

SingleStack is a hub-and-spoke graph, not a flat relational warehouse.

- **The hub** is the Product Record. One per product the org tracks. Owns identity, positioning, and the canonical "what is this thing."
- **The first-ring spokes** are the artifact tables: Modules, Features, GTM Records, Signals, Sources, Agents, Ratifications, Proposals. Each has a direct FK to `product_records.id`.
- **The second-ring spokes** are scoped to a first-ring artifact: a Treatment belongs to a Recording, a Chunk belongs to a Source, a Ratification belongs to a Feature.
- **Cross-cutting tables** (audit log, agent runs, system events) reference whichever artifact they touch, never bypassing the Product Record entirely.

When designing a new table, the first question is: *what is this thing's parent in the graph?* If the answer is "nothing," you are probably building it wrong.

---

## 3. The Spine: What Every Table Has

Every table in SingleStack carries the same six-column spine. This is the audit, tenancy, and identity contract. Migrations that omit any of these columns fail review.

```sql
create table example (
  -- Identity
  id            uuid primary key default gen_random_uuid(),

  -- Tenancy (non-negotiable)
  org_id        uuid not null references orgs(id) on delete cascade,

  -- Audit
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references users(id) on delete set null,
  updated_by    uuid references users(id) on delete set null

  -- Table-specific columns follow
);

-- Tenancy index is mandatory.
create index example_org_id_idx on example(org_id);

-- updated_at trigger is mandatory.
create trigger example_updated_at
  before update on example
  for each row execute function set_updated_at();
```

Two notes on this:

- **`created_by` / `updated_by` are nullable** because the actor may be an agent, a system process, or a deleted user. Use a separate `actor_type` column (enum: `user`, `agent`, `system`) when the artifact's table cares about *who acted*, and pair it with `actor_id` that references the appropriate table.
- **Soft delete is opt-in, not default.** Add a `deleted_at timestamptz` column only when the artifact has audit value after deletion (Content drafts, Ratifications, Proposals — yes; ephemeral system rows — no). When soft delete is present, every query and RLS policy filters `deleted_at is null` unless explicitly fetching the trash.

---

## 4. The First-Class Test: When Something Becomes a Table

The most common modeling mistake is putting something on a row that should have been a row. Apply this test before adding a column that looks like a string of metadata.

**Promote to a table when ANY of these is true:**

1. **It has its own lifecycle.** A Source is created, updated, possibly deprecated, possibly merged. A `source_url` string has none of those states.
2. **It is referenced by more than one artifact.** If the same Source supports a Signal *and* a Content draft *and* a CI claim, it must be a row that all three can FK to.
3. **It has its own provenance.** Where did this thing itself come from? When was it fetched? What chunk of it did the agent use? Strings cannot carry that load.
4. **It has its own children.** If Sources have Chunks, Sources is a table. If Agents have Runs, Agents is a table.
5. **It will need to be queried independently.** "Show me all Sources from Gong in the last 30 days" is a query against a table, not a `WHERE jsonb_field @> '{"type":"gong"}'`.

**Keep it a column when:**

- It is a single scalar that belongs to exactly one parent and never moves.
- It has no lifecycle of its own (`title`, `description`, `priority`, `status`).
- No other artifact will ever reference it.

When in doubt, promote. The cost of promoting a column to a table later (migration + backfill) is much higher than the cost of having a small table early.

---

## 5. Naming Conventions

Boring rules, applied consistently, save more hours than any clever rule.

- **Tables: `snake_case`, plural.** `product_records`, `gtm_records`, `ratifications`, `agent_runs`. Never `productRecord`, never `product_record` (singular), never `tbl_` prefixes.
- **Columns: `snake_case`, singular.** `created_at`, `org_id`, `display_name`.
- **Foreign keys: `<referenced_table_singular>_id`.** `product_record_id`, `source_id`, `agent_id`. Never `productRecordId`, never `fk_product_record`.
- **Booleans: `is_<state>` or `has_<thing>`.** `is_archived`, `has_been_ratified`. Never bare `active` or `enabled` — they read ambiguously in WHERE clauses.
- **Timestamps: `<verb>_at`.** `created_at`, `published_at`, `ratified_at`, `archived_at`. Never `creation_date`, never `created_date`.
- **Enums (Postgres types): `<table_singular>_<field>`.** `source_kind`, `ratification_status`, `agent_role`.
- **Indexes: `<table>_<columns>_idx`.** `ratifications_field_id_idx`, `sources_org_id_kind_idx`. Composite indexes always lead with `org_id`.
- **Constraints: `<table>_<columns>_<kind>`.** `ratifications_field_id_fkey`, `users_email_uniq`, `proposals_status_chk`.

Consistency over cleverness, every time.

---

## 6. Foreign Keys & Cascades

Real FKs, always. Be explicit about cascade behavior — the default is rarely what you want.

| Relationship | `ON DELETE` | Why |
|---|---|---|
| Child belongs to parent and has no value without it (Chunks → Source) | `cascade` | Orphans are noise. |
| Child has independent audit value (Ratifications → Feature) | `restrict` | Force explicit handling; never silently lose the trail. |
| Reference is informational, not structural (created_by → users) | `set null` | The action happened; the actor's deletion shouldn't erase the action. |
| Cross-tenant impossible by design (anything → orgs) | `cascade` | If the org is gone, everything goes. |

`ON UPDATE` is almost always `cascade`. Surrogate UUIDs rarely change, but be explicit anyway.

Avoid `ON DELETE no action` — it is the same as `restrict` but obscures intent. Pick `cascade`, `restrict`, or `set null` deliberately.

---

## 7. Enums vs. Lookup Tables

Use Postgres **enum types** when:
- The set is small (≤10 values), bounded, and changes rarely.
- Values have no metadata of their own (no description, no display order, no color).
- Example: `ratification_status` (`pending`, `approved`, `rejected`, `superseded`).

Use a **lookup table** when:
- The set may grow, be edited by admins, or carry metadata.
- The values have display names, colors, ordering, or descriptions distinct from their identifier.
- Example: `agent_roles` (id, slug, display_name, identity_color, scope_description).

Never use a string column with a `CHECK` constraint where an enum would do. Never use an enum where the set will need user-editable metadata.

Migrating between the two is painful in both directions, so spend an extra minute up front.

---

## 8. JSON Columns: Use Sparingly

`jsonb` is a legitimate tool with two legitimate uses in SingleStack:

1. **Configuration blobs** that the application reads as a whole and rarely queries by inner field. Example: `agent_config jsonb` on `agents`.
2. **External payloads** captured verbatim for provenance. Example: `raw_payload jsonb` on `signals` storing the original webhook body from Gong or Salesforce.

`jsonb` is **not** a legitimate tool for:

- Avoiding the work of designing a real schema.
- Storing relationships ("here's an array of source IDs as JSON" — no, that's a join table).
- Storing anything you will need to filter, group, or join on with any frequency.

If you find yourself reaching for `jsonb` more than twice in a single migration, stop and re-model.

---

## 9. The Ratification Pattern

Ratifications are field-level, versioned, and traceable. This is unusual and worth its own section.

**The shape:**

```sql
create table ratifications (
  -- Spine columns omitted for brevity

  -- What was ratified
  artifact_table   text not null,           -- e.g., 'features', 'gtm_records'
  artifact_id      uuid not null,
  field_name       text not null,           -- e.g., 'positioning_statement'

  -- The values
  prior_value      text,                    -- nullable (first ratification)
  new_value        text not null,

  -- The actors
  ratified_by      uuid not null references users(id),
  source_id        uuid references sources(id),

  -- The state
  status           ratification_status not null default 'approved',
  superseded_by    uuid references ratifications(id),

  ratified_at      timestamptz not null default now()
);

create index ratifications_artifact_idx
  on ratifications(org_id, artifact_table, artifact_id, field_name);
```

**Rules:**

- A Ratification points at a *field*, not a row. The composite `(artifact_table, artifact_id, field_name)` is the addressable unit.
- New ratifications do not delete old ones. They point back via `superseded_by`, forming a chain. The current value is the head of the chain.
- `prior_value` is denormalized intentionally — it lets you read the diff without walking the chain.
- A Ratification may carry a `source_id` to record what evidence supported the approval.

The Ratification pattern is the spine of the trust layer in the product. Treat it as load-bearing.

---

## 10. The Source Pattern

Sources are first-class. They have lifecycle, provenance, and children.

```sql
create table sources (
  -- Spine columns omitted

  -- What kind of source
  kind             source_kind not null,   -- enum: 'gong', 'salesforce', 'web', 'doc', 'upload', 'gmail', 'slack', etc.
  external_id      text,                   -- the source's own ID in its system of origin
  uri              text,                   -- canonical URL or URI

  -- Identity
  title            text not null,
  fetched_at       timestamptz not null,
  fetched_by_agent uuid references agents(id),

  -- Metadata
  raw_payload      jsonb,                  -- legitimate use of jsonb
  is_active        boolean not null default true,

  unique (org_id, kind, external_id)       -- prevents duplicate captures
);

create table source_chunks (
  -- Spine columns omitted
  source_id        uuid not null references sources(id) on delete cascade,
  chunk_index      int not null,
  content          text not null,
  embedding        vector(1536),           -- pgvector for retrieval

  unique (source_id, chunk_index)
);
```

**Rules:**

- Every AI-generated artifact references at least one Source by FK. No exceptions in customer-shareable surfaces (CI, Content, Enablement).
- Chunks are the unit of citation, not Sources. The UI's Source Chip resolves to a Chunk, not just a Source.
- Sources are never hard-deleted. Use `is_active = false` to retire. The Ratification trail must remain joinable.
- The `unique (org_id, kind, external_id)` constraint is non-negotiable — it prevents the same Gong call or Salesforce record from existing twice.

---

## 11. Module Isolation

The five modules — Competitive Intelligence, Campaigns, Content, Enablement, Insights — share the hub (Product Record, Sources, Agents, Ratifications) but own their own artifacts.

**Rules:**

- Module-specific tables are prefixed by module: `content_drafts`, `campaign_emails`, `enablement_cards`, `ci_battlecards`, `insights_dashboards`.
- Module tables FK to shared tables (Sources, Ratifications, Agents, Product Records). Shared tables never FK to module-specific tables.
- A module can read from another module's tables in queries, but cannot own FK constraints into them. If two modules need a shared artifact, it gets promoted to a shared table.
- Adding a new module never modifies existing module tables. It adds its own.

This keeps modules independently shippable and independently breakable.

---

## 12. Anti-Patterns

The fastest way to keep the schema clean is to refuse the following on sight.

- **Boolean soup.** `is_active`, `is_published`, `is_archived`, `is_draft` on the same row. That's a `status` enum waiting to be born.
- **String enums.** `status text check (status in ('draft','published'))`. Use a real Postgres enum or a lookup table.
- **Composite primary keys.** Surrogate UUID PK, always. Use `UNIQUE (org_id, slug)` to enforce business uniqueness; don't make the PK composite.
- **Bidirectional foreign keys.** A FK B and B FK A is a modeling error 95% of the time. One side is the parent.
- **`metadata jsonb` as a catch-all.** If three different things go in there, they want three different columns or a child table.
- **Implicit ordering.** `created_at DESC` is not an ordering guarantee for display. If order matters, add a `position int` column.
- **Generic `notes` columns.** They become trash heaps. If notes have value, they're Ratifications, Comments, or Annotations — first-class tables.
- **Tables without `org_id`.** Already covered; called out again because it is the most common slip.
- **Migrations without RLS.** Every new table gets an RLS policy in the same migration. (Enforcement lives in `supabase-patterns`; the rule lives here.)

---

## 13. Adding a New Entity: Checklist

Before writing the migration for a new artifact, answer all of these in writing.

1. **What is the parent in the hub-and-spoke graph?** (Must be ≤2 joins from a Product Record.)
2. **Does it pass the First-Class Test?** (Section 4. If not, it's a column, not a table.)
3. **What spine columns does it carry?** (Always six. Sometimes seven with `deleted_at`.)
4. **What are the FK relationships and cascade behaviors?** (Section 6 table.)
5. **What enums or lookup tables does it need?** (Section 7 decision.)
6. **Does it require Ratification?** (If yes, the field-level pattern applies — section 9.)
7. **Does it reference Sources?** (If yes, FK directly; never embed source data.)
8. **Which module owns it?** (Module prefix in the table name — section 11.)
9. **What composite indexes does it need?** (Leading with `org_id`, always.)
10. **What is its delete behavior?** (Hard delete, soft delete, or never delete?)

A migration whose author cannot answer all ten in a sentence each is not ready for review.

---

## 14. Self-Check

Before claiming a schema change is done, walk through this list. Any "no" or "not sure" means it is not done.

- Does every new table have all six spine columns?
- Does every new table have an `org_id` index?
- Does every relationship use a real foreign key with explicit `ON DELETE` behavior?
- Is every AI-touchable field traceable to at least one Source via FK?
- If the new artifact is approvable, does it use the field-level Ratification pattern — not a `is_approved` boolean?
- Are there any `jsonb` columns? If yes, do they pass section 8?
- Is the table name `snake_case`, plural, and module-prefixed where applicable?
- Will the next module added be able to use this table without modifying it?

When all answers are right, the migration is ready for `supabase-patterns` to govern how it ships.
