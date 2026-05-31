# Cross-sell & the scope vocabulary — architecture design

Status: **Phases 1, 2 & 4 shipped** · Phase 3 (authoring UI) proposed · Owner: SingleStack
Phase 2 = scope-aware active-product context (`web/lib/ProductContext.tsx` + Shell
switcher). Phase 4 = product-aware synthesis with cross-product detection
(`inferScope`) AND a **bounded prompt** (`selectRelevantThemes`/`capCandidates` in
`_shared/synthesis.ts`): synthesis reasons only over themes the new signals could
plausibly touch — flat cost/latency as the org grows, no context-window cliff,
cross-sell detection preserved. Logic verified 12/12 (real compiled module).
Phase 1 lives in `supabase/migrations/20260530280000_cross_product_scope.sql`
(`co_product_ids[]`, `gtm_records.motion_type`, `bridges.span`, the
`spans_product()` helper, GIN indexes, and demote-not-destroy triggers — all
verified on a 3-product Postgres: cross-sell authoring, CHECK invariants,
`spans_product` queries, and primary/secondary product deletion).
Builds on `multi-product-foundation.md` (which establishes per-product separation
+ org roll-up). This doc adds the missing axis: **products and GTM motions that
sometimes run solo and sometimes run together** (cross-sell / co-sell / bundles).

## The problem (precisely)

The data model today expresses two scopes via a single `product_id` FK:

- `product_id = <id>` → belongs to **one** line of business.
- `product_id = NULL` → "company-wide".

That single FK **cannot express "Product A and Product B, together."** The
canonical case is **cross-sell**: a GTM motion, campaign, initiative, decision, or
theme that deliberately spans *two specific lines* — not the whole company, and
not one line. Worse, today "together" can only be approximated as `NULL`, which is
**overloaded**: the system cannot tell *"applies to the entire company"* apart
from *"specifically spans A + B."* And `gtm_records.product_id` is `NOT NULL`, so a
co-sell motion that markets two lines together is **structurally unrepresentable** —
you must pick one line or duplicate the motion.

(Confirmed by the data-model audit: per-product separation + org roll-up are
well-built; `bridges` is the only accidental cross-product carrier, and it
collapses to `NULL product_id`, inheriting the same ambiguity.)

## Principles

1. **Three scopes, named — never an overloaded NULL.** `org` (deliberately
   company-wide), `product` (one line), `cross_product` (a deliberate set of ≥2
   named lines). "Together" becomes a first-class, queryable state.
2. **Additive and reversible** (same as multi-product). The common case —
   single-product rows — must keep working untouched, with zero migration pain.
3. **A primary line is preserved.** A cross-product entity still has ONE primary
   `product_id` (for existing queries, default views, ownership), plus the set of
   additional lines it spans. Nothing that reads `product_id` today breaks.
4. **The scope vocabulary is upstream of the UI.** The active-product switcher and
   every module filter speak this vocabulary; design it before building them.
5. **Cross-sell is a relationship, not a copy.** One initiative/motion spanning A+B,
   not two duplicated rows — so its intelligence, evidence, and provenance stay
   unified.

## The keystone: the scope vocabulary

```
scope = 'org'           → company-wide (product_id NULL).        Applies to all lines, deliberately.
scope = 'product'       → one line     (product_id = A).         The common case. Unchanged.
scope = 'cross_product' → a set of ≥2  (product_id = A primary,  Cross-sell / co-sell / bundle.
                          + the other lines named explicitly)
```

`signals` and `decisions` **already** have a `scope` column (`org | product |
gtm`). Extending the scope concept is consistent with the existing model — we add
the value `cross_product` and a way to name the additional lines. `gtm` stays as
the finer GTM-record binding.

## Data shape — two options

The question is how to store "the additional lines it spans."

**Option A — additive array on the entity (recommended for velocity).**
Add to each entity that can run together:
- `scope` (already exists on signals/decisions; add to the others), and
- `co_product_ids uuid[]` — the *additional* lines beyond the primary `product_id`.

A cross-sell initiative: `scope='cross_product'`, `product_id = A` (primary),
`co_product_ids = {B}`. Company-wide: `scope='org'`, `product_id = NULL`,
`co_product_ids = '{}'`. Single line: unchanged.

- ✅ Purely additive; existing rows/queries untouched (default `scope='product'`,
  empty array). ✅ "Spans A" query: `product_id = A OR co_product_ids @> ARRAY[A]`,
  fast with a GIN index. ✅ Minimal migration, fits the "additive & reversible"
  principle.
- ⚠️ Array elements aren't real FKs — orphan cleanup on product delete needs the
  existing demote/cleanup trigger pattern extended to prune the array.

**Option B — a generic `entity_products` junction.**
`entity_products(org_id, entity_type, entity_id, product_id, role)` where `role ∈
{primary, cross_sell, co_sell}`.

- ✅ Fully normalized; richest queries ("everything where A is the cross-sell
  target"); real per-row roles. ✅ One table to RLS-scope.
- ⚠️ Polymorphic `entity_type/entity_id` → **no real FK integrity** (the thing the
  codebase otherwise prizes: cascade deletes, demote triggers). ⚠️ Every read
  joins through it; larger change to every product-aware query.

**Recommendation: Option A (array + scope), with Option B reserved** for if/when we
need rich relational cross-sell analytics. A keeps the common path identical, is
the smallest reversible step, and the array-orphan concern is solved by extending
the demote-not-destroy triggers that already exist
(`20260530220000_scope_demote_guards.sql`).

### Entities that gain `scope` + `co_product_ids`
`initiatives`, `campaigns`, `decisions` (has scope), `signal_themes`, `objectives`,
`bridges`. Plus **GTM motions**: relax the "one product" assumption *additively* —
keep `gtm_records.product_id NOT NULL` as the **primary** line, add `co_product_ids`
+ a `motion_type ∈ {single, cross_sell, co_sell}`. A co-sell motion = primary A,
`co_product_ids={B}`. No breakage of the NOT-NULL cascade.

`signals` stay single-product at capture (a raw observation is about one thing);
cross-product emerges at the **theme/decision/initiative** layer where things are
deliberately combined.

## Interaction with the active-product context (why this is upstream)

The `multi-product-foundation.md` switcher becomes scope-aware:

- **All products (org roll-up)** — shows `org` + every line + every `cross_product`.
- **A single line (A)** — shows A's `product` rows **plus** `cross_product` rows
  whose set includes A (a cross-sell motion correctly appears in *both* member
  lines' views) **plus** `org` rows surfaced as "company-wide".
- **A combination (A + B)** *(later)* — a saved/ad-hoc cross-sell lens showing only
  what spans exactly those lines.

The switcher's selection model must therefore be "a set of product ids + an
org-rollup flag," not a single id. **This is the concrete reason to lock the
vocabulary before building the switcher** — otherwise it's built single-select and
rebuilt.

## Synthesis implications

`synthesize-signals` runs one org-wide pass today. With the vocabulary:
1. **Per-product pass** — synthesize each line's signals into that line's themes
   (stops cross-line dilution — the original multi-product complaint).
2. **Org pass** — over `org`-scoped signals → company-wide themes.
3. **Cross-product detection** *(the new capability)* — when a coherent theme's
   evidence spans ≥2 lines, propose it as `scope='cross_product'` with the lines
   named, rather than collapsing to NULL. This is the intelligence-side payoff:
   the system can *surface* a cross-sell opportunity ("buyers of A keep asking for
   B"), not just store one a human typed.

`bridges` get a discriminator: `span ∈ {product_gtm, cross_product}` so a
Product-A↔Product-B bridge is labeled as such instead of NUL-collapsed — making
bridges the natural home of the cross-sell insight.

## Rollout phases

1. **Vocabulary + additive columns (no behavior change).** Add `scope` value
   `cross_product`, `co_product_ids uuid[]` (+ GIN indexes), and the gtm
   `motion_type`. Backfill `scope` for existing rows (`product` if product_id set,
   else `org`). Extend demote triggers to prune the arrays. Everything keeps
   working; nothing yet *uses* cross_product.
2. **Scope-aware active-product context.** Build the switcher with the set-based
   selection model; product-aware views filter by the vocabulary (single line
   shows its cross_product rows too).
3. **Cross-sell authoring.** UI to mark an initiative/campaign/motion as spanning
   lines (pick primary + additional). The relationship, not a copy.
4. **Cross-product synthesis + typed bridges.** Per-product/org/cross-product
   passes; bridges labeled `cross_product`. The system *proposes* cross-sell.

## Open questions for review

1. **Storage:** Option A (array + scope) now, Option B (junction) later — agreed?
   (Recommended.)
2. **Primary line:** keep a single `product_id` as the canonical primary on
   cross-product rows (recommended), so existing queries/ownership are unambiguous?
3. **GTM:** relax additively via `motion_type` + `co_product_ids` (recommended),
   rather than dropping the `NOT NULL` / introducing a `gtm_record_products` join?
4. **Synthesis:** is auto-detecting cross-product themes (phase 4) desired, or
   should cross_product be human-authored only at first?
