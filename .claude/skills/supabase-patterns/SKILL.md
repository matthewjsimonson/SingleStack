---
name: supabase-patterns
description: Govern how SingleStack ships on Supabase — RLS policies, migration conventions, multi-tenant safety, trigger functions, indexes, pgvector setup, realtime patterns, and the rules for promoting changes from local to staging to production. Use this skill any time you are writing a Supabase migration, adding or modifying an RLS policy, setting up auth or memberships, working with pgvector embeddings, configuring realtime subscriptions, generating types, or doing anything that touches the database layer. This skill governs implementation safety; the singlestack-schema skill governs structure; the singlestack-ui skill governs surfaces.
---

# Supabase Patterns Skill for SingleStack

This skill is the implementation contract for SingleStack on Supabase. The `singlestack-schema` skill says what the data looks like; this skill says how it ships without security holes, performance cliffs, or migrations that cannot be rolled back. Every rule below exists because the alternative cost more than it saved.

The non-negotiables come first. Everything else is in service of them.

---

## 1. The Five Non-Negotiables

These are absolute. A migration that violates any of them does not ship to staging, let alone production.

**1.1 RLS is on. Always. On every table.** No exceptions for "internal" tables, "system" tables, or "we'll fix it later" tables. Row Level Security is the security boundary; without it, a leaked anon key means full database read. Every `create table` is followed in the same migration by `alter table <name> enable row level security;`.

**1.2 The `org_id` boundary is enforced by RLS, never by application code.** Application code can be bypassed, forgotten, or refactored around. RLS cannot. Every policy on every table predicates on `org_id` membership — even tables you "know" only admins will touch.

**1.3 Every migration is idempotent and committed to git.** Migrations run with `create table if not exists`, `create policy if not exists` (or `drop policy if exists` followed by `create policy`), and `create index if not exists`. They are checked into the repo before they run anywhere. The Supabase dashboard SQL editor is for inspection, not for changes.

**1.4 Every new table ships with its RLS policies in the same migration.** A migration that creates a table without policies leaves a table with RLS enabled but no policies — which means *nobody can read or write it*, including the service role for end-user requests. The policies are part of the table definition, not a follow-up.

**1.5 Service role is for trusted server code only.** The service role bypasses RLS. It is used by edge functions, server actions, and agent runners — never by the browser client, never embedded in frontend code, never logged. If service-role code writes data, it sets `org_id` explicitly from a trusted source and never from user input.

---

## 2. Mental Model: Three Environments, One Migration Path

SingleStack runs in three environments, and a change must flow through all three in order.

- **Local** — Supabase running in Docker on your machine (`supabase start`). All migrations are written and tested here first. Migrations live in `supabase/migrations/`. Reset frequently with `supabase db reset`.
- **Staging** — A separate Supabase project. Migrations are applied with `supabase db push --linked` against the staging linked project. Real data shape, test data only.
- **Production** — The live Supabase project. Migrations applied via the same CLI flow, or via Supabase's branching feature for review. Never edited via dashboard.

**The rule:** a migration that has not run cleanly against a fresh local database does not get pushed to staging. A migration that has not been exercised in staging does not get pushed to production. There is no `LOCAL → PROD` shortcut, even for trivial changes.

---

## 3. Migrations: Structure and Naming

The Supabase CLI generates timestamp-prefixed migration files. Use that convention without modification.

**File naming:** `supabase/migrations/<UTC_TIMESTAMP>_<snake_case_description>.sql`

Examples:
- `20260602120000_create_product_records.sql`
- `20260602133000_add_rls_to_sources.sql`
- `20260603090000_add_position_to_features.sql`

**One migration, one concern.** A migration creates *one* table and its associated policies, indexes, and triggers — not five tables. A migration adds *one* column or *one* policy. This keeps rollbacks safe and review readable.

**Standard migration structure for a new table:**

```sql
-- Migration: create_features
-- Purpose: Add the features artifact under product_records hub
-- Author: <name or agent>
-- Date: 2026-06-02

-- 1. Create the table
create table if not exists public.features (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.orgs(id) on delete cascade,
  product_record_id  uuid not null references public.product_records(id) on delete cascade,
  -- spine columns
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references auth.users(id) on delete set null,
  updated_by         uuid references auth.users(id) on delete set null,
  -- domain columns
  name               text not null,
  description        text,
  status             feature_status not null default 'draft'
);

-- 2. Indexes — org_id always leads
create index if not exists features_org_id_idx
  on public.features(org_id);
create index if not exists features_product_record_id_idx
  on public.features(org_id, product_record_id);

-- 3. updated_at trigger
create trigger features_set_updated_at
  before update on public.features
  for each row execute function public.set_updated_at();

-- 4. Enable RLS — mandatory, in the same migration
alter table public.features enable row level security;

-- 5. Policies — see section 4 for the canonical four-policy block
create policy "features_select_org_member" on public.features
  for select using (org_id in (select public.user_org_ids()));
create policy "features_insert_org_member" on public.features
  for insert with check (org_id in (select public.user_org_ids()));
create policy "features_update_org_member" on public.features
  for update using (org_id in (select public.user_org_ids()))
  with check (org_id in (select public.user_org_ids()));
create policy "features_delete_org_member" on public.features
  for delete using (org_id in (select public.user_org_ids()));
```

If a migration has fewer than these five sections (table, indexes, trigger, RLS enable, policies), it is incomplete. Review will reject it.

---

## 4. The Canonical RLS Pattern

Every SingleStack table uses the same four-policy block, predicated on org membership. This is the security model — internalize it.

**Step one: the membership helper.** Create this once, in the initial migration. Every policy in the system calls it.

```sql
-- One row per (user, org) — a user can belong to multiple orgs
create table if not exists public.org_memberships (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  org_id      uuid not null references public.orgs(id) on delete cascade,
  role        membership_role not null default 'member',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (user_id, org_id)
);

-- Returns the set of org_ids the currently authenticated user belongs to
create or replace function public.user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id
  from public.org_memberships
  where user_id = auth.uid()
    and is_active = true
$$;
```

Two things to notice:

- **`security definer`** lets the function read `org_memberships` regardless of the caller's RLS. Without it, a circular RLS check is possible.
- **`set search_path = public`** is a security hardening step — without it, a malicious schema could shadow the function's references. Always include it on `security definer` functions.

**Step two: the four-policy block.** Apply to every table:

```sql
alter table public.<table_name> enable row level security;

create policy "<table>_select_org_member" on public.<table_name>
  for select using (org_id in (select public.user_org_ids()));

create policy "<table>_insert_org_member" on public.<table_name>
  for insert with check (org_id in (select public.user_org_ids()));

create policy "<table>_update_org_member" on public.<table_name>
  for update
    using (org_id in (select public.user_org_ids()))
    with check (org_id in (select public.user_org_ids()));

create policy "<table>_delete_org_member" on public.<table_name>
  for delete using (org_id in (select public.user_org_ids()));
```

**Why all four?** A policy without an `INSERT` rule blocks inserts. A policy without `WITH CHECK` on update allows a user to update a row *into another org*. Both halves are required.

**When to deviate.** Read-only reference tables (e.g., a global `currencies` table with no `org_id`) skip the four-policy block and instead get a single `select` policy with `using (true)`. These are exceptions to the org-scoped rule and require explicit comment-justification in the migration.

---

## 5. RLS Patterns for Specific Cases

**Role-based restriction within an org.** Some operations are admin-only (e.g., deleting a Product Record). Layer the role check on top of the membership check:

```sql
create policy "product_records_delete_admin" on public.product_records
  for delete using (
    org_id in (
      select org_id from public.org_memberships
      where user_id = auth.uid()
        and is_active = true
        and role in ('owner', 'admin')
    )
  );
```

**Self-only access (user reading their own record).** For tables like user preferences:

```sql
create policy "user_prefs_select_self" on public.user_prefs
  for select using (user_id = auth.uid());
```

**Joined access (child inherits parent's permission).** A `source_chunks` row should be visible to whoever can see the parent `sources` row. Predicate on the parent's `org_id`:

```sql
create policy "source_chunks_select_via_source" on public.source_chunks
  for select using (
    exists (
      select 1 from public.sources s
      where s.id = source_chunks.source_id
        and s.org_id in (select public.user_org_ids())
    )
  );
```

This is slower than a direct `org_id` check, which is why §1.2 of `singlestack-schema` insists that every table carry `org_id` directly. Joined RLS is only used when denormalizing `org_id` is genuinely impossible.

**Agent-acting-on-behalf-of-org.** Agents run via edge functions or server processes using the service role, which bypasses RLS. The application code is responsible for setting `org_id` correctly. Pattern:

```typescript
// In an edge function or server action
const { data, error } = await supabaseAdmin
  .from('features')
  .insert({
    org_id: trustedOrgId,        // from a verified source — never user input
    product_record_id,
    name,
    created_by: null,             // null because actor is an agent, not a user
    // Optionally: actor_type: 'agent', actor_id: agentId
  });
```

The service role's power means application code becomes the security boundary. Treat it accordingly: never accept `org_id` from a request body; always derive it from a verified session, JWT claim, or admin-validated source.

---

## 6. The `set_updated_at` Trigger Function

Defined once, used everywhere. Include this in the initial migration.

```sql
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
```

Apply to every table in its create migration (see §3 example). Tables without this trigger will have stale `updated_at` values — and `singlestack-schema` makes the trigger mandatory.

---

## 7. Indexes

**Two rules:**

1. **Every `org_id` column gets an index.** Always. This is the predicate of every RLS policy; without an index, every query is a full table scan with a filter. Mandatory in the table-creation migration.

2. **Composite indexes lead with `org_id`.** A query like `where org_id = ? and product_record_id = ?` benefits from a `(org_id, product_record_id)` index, not the reverse. Order matters; the leading column is the one that filters the most rows.

**When to add more indexes:**

- Foreign key columns that are frequently joined or filtered (Postgres does not auto-index FKs).
- Columns used in `order by` on frequently-fetched lists.
- Composite indexes for known query patterns (`(org_id, status, created_at)` for "show me the active drafts").

**When NOT to add indexes:**

- "Just in case" — every index slows writes. Add when measured, not when imagined.
- On low-cardinality columns alone (a boolean by itself rarely benefits).
- On columns updated on every row (the index gets rewritten constantly).

Use `explain analyze` on slow queries before adding an index. Add it in a focused migration that explains *why*.

---

## 8. Database Functions: When and When Not

Postgres functions (and Supabase RPCs) are powerful but easy to overuse.

**Use a database function when:**

- The operation requires atomicity across multiple tables (a multi-row write that must succeed or fail together).
- The work is fundamentally relational and pushing it to the client would mean 5+ round trips.
- Security requires it (e.g., `security definer` helpers like `user_org_ids()`).

**Do NOT use a database function when:**

- The logic is business logic that will change as the product evolves. Functions are harder to refactor than application code.
- It is reachable from end-user requests without RLS implications. Prefer client queries with RLS doing its job.
- It calls external services. Edge functions are for that.

When you do write a function, always set `search_path` explicitly, mark it `stable` or `immutable` when it doesn't modify data, and version it like any other migration (drop + recreate, never silently `replace` in a way that loses history).

---

## 9. pgvector for Source Chunks

SingleStack uses pgvector for embedding-based retrieval over `source_chunks`. Setup:

```sql
-- Enable in initial migration
create extension if not exists vector;

-- Column on source_chunks
alter table public.source_chunks
  add column if not exists embedding vector(1536);

-- Index — use ivfflat for moderate scale, hnsw for higher recall
-- Note: pick ONE index type, not both
create index if not exists source_chunks_embedding_idx
  on public.source_chunks
  using hnsw (embedding vector_cosine_ops);
```

**Choosing the index:**

- **hnsw** — higher recall, faster query, slower build, more memory. Default choice for SingleStack.
- **ivfflat** — lower memory, requires picking a `lists` parameter, must be built after data is loaded. Use only for very large tables.

**The retrieval RPC.** Wrap the similarity query in a function so the client doesn't construct the SQL:

```sql
create or replace function public.match_source_chunks(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  filter_org_id uuid
)
returns table (id uuid, source_id uuid, content text, similarity float)
language plpgsql
stable
security invoker  -- runs as the calling user; RLS applies
set search_path = public
as $$
begin
  return query
  select sc.id, sc.source_id, sc.content,
         1 - (sc.embedding <=> query_embedding) as similarity
  from public.source_chunks sc
  join public.sources s on s.id = sc.source_id
  where s.org_id = filter_org_id
    and 1 - (sc.embedding <=> query_embedding) > match_threshold
  order by sc.embedding <=> query_embedding
  limit match_count;
end;
$$;
```

Note `security invoker` — the function runs as the caller, so RLS on `sources` and `source_chunks` applies. The `filter_org_id` parameter is a secondary defense; RLS is primary.

---

## 10. Realtime + RLS

Supabase Realtime broadcasts changes via Postgres logical replication. **It respects RLS** — a subscribing client only receives rows it has read permission on. But there are gotchas:

- **Publications must include the table.** New tables aren't realtime-enabled until added to the `supabase_realtime` publication. Include in the create migration:

  ```sql
  alter publication supabase_realtime add table public.<table_name>;
  ```

- **Updates fire on every column change.** If you only care about specific fields, filter client-side or use Postgres triggers to emit narrower events.

- **Old-row values require replica identity.** To get the previous row in `UPDATE` events, set:

  ```sql
  alter table public.<table_name> replica identity full;
  ```

  This has a small performance cost. Use only where the diff is needed (e.g., ratification streams).

Test realtime locally with `supabase start` — it includes the realtime container.

---

## 11. Generated Types Workflow

TypeScript types are generated from the live schema. Regenerate after every migration that touches the schema.

```bash
# Local
supabase gen types typescript --local > src/lib/database.types.ts

# Linked project
supabase gen types typescript --linked > src/lib/database.types.ts
```

**Rules:**

- Generated types are checked into git so the diff is reviewable.
- Regeneration happens in the same PR as the migration. A migration without a types update is not ready for review.
- Application code imports `Database` from this file and uses `Database['public']['Tables']['features']['Row']` — never typed by hand.

---

## 12. Anti-Patterns

Refuse on sight:

- **`alter table ... disable row level security;`** — There is no legitimate use for this in SingleStack. The instinct to disable RLS during debugging is a 5-alarm fire; debug with the service role or a temporary policy instead.
- **`grant all on schema public to anon;`** — The anon role should only have explicitly-granted access, mediated by RLS. Broad grants defeat the security model.
- **Embedding the service role key in client code.** This is the worst possible mistake. Service role bypasses RLS — it belongs only in trusted server contexts.
- **Migrations that drop and recreate a table to "rename a column."** Use `alter table ... rename column`. Drop-and-recreate loses RLS, indexes, triggers, FKs, and the row data unless explicitly preserved.
- **Editing migrations after they have been applied to staging or production.** Migrations are immutable once applied anywhere. Need to change something? Write a new migration.
- **Policies without `WITH CHECK` on INSERT or UPDATE.** Half a policy is a security hole. Always include both halves.
- **Generic policy names like `"allow_all"` or `"users_can_read"`.** Policy names are documentation. Use `<table>_<operation>_<who>` consistently.
- **Functions without `set search_path`.** A subtle but real privilege-escalation surface. Always set it explicitly.
- **JSONB blobs that hide relational data.** Covered in `singlestack-schema` §8 — called out again because it tempts everyone.

---

## 13. Pre-Migration Checklist

Before running a migration against staging or production, answer all of these in writing.

1. Does the migration have a clear single purpose stated in a comment header?
2. Are all `create` statements idempotent (`if not exists`)?
3. Did the migration run cleanly against a fresh `supabase db reset` locally?
4. Does every new table have RLS enabled and at least one policy in the same migration?
5. Do all four policies (`select`, `insert`, `update`, `delete`) exist, and do `update` policies have both `USING` and `WITH CHECK`?
6. Does every `org_id` column have an index?
7. Does every table have the `set_updated_at` trigger?
8. If types changed: have generated TypeScript types been regenerated and committed?
9. If realtime is needed: is the table added to the `supabase_realtime` publication?
10. If a function is created: is `search_path` set, is volatility (`stable`/`immutable`) declared, and is the security mode (`invoker` vs `definer`) deliberate?

A migration without all ten yes-answers is not ready for staging.

---

## 14. Self-Check

Before claiming a database change is done, walk this list. Any "no" or "not sure" means it is not done.

- Has the migration been applied successfully to local and staging, in that order?
- Have I tested at least one read, one insert, one update, and one delete with a non-service-role user in the relevant org?
- Have I confirmed that a user in a *different* org cannot see, modify, or delete the new data?
- Are generated types in sync with the schema?
- Is the migration file checked into git and the diff legible?
- If this change affects an existing artifact (Ratifications, Sources, etc.), did I confirm existing rows still respect the new constraints?
- If this change touches a customer-facing surface, did the `singlestack-ui` skill also get applied to whatever UI was added?

When everything is yes, the change is ready for production. Apply it via the CLI, never via the dashboard.

---

## 15. When Things Go Wrong

The most common SingleStack-on-Supabase failures and their first-look fixes:

- **"No rows returned but I know they exist."** RLS is doing its job; the requesting user is not in the row's `org_id`. Check `auth.uid()` against `org_memberships`.
- **"Insert fails with `new row violates row-level security policy`."** The `WITH CHECK` clause on the insert policy is being violated. Usually means the inserted `org_id` doesn't match the user's memberships.
- **"Migration fails on staging but worked locally."** Almost always means staging has data the migration didn't account for. Add a backfill step or a conditional column add.
- **"Realtime not firing."** Table isn't in the `supabase_realtime` publication, or RLS is filtering the row out for the subscribing client.
- **"`auth.uid()` is null in a function."** The function is being called by the service role, which has no `auth.uid()`. Pass the user ID explicitly or use `security definer` carefully.

Fix the cause, not the symptom. The non-negotiables are non-negotiable for a reason.
