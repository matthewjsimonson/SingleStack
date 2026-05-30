# Multi-Product Foundation — architecture design

Status: **proposed (for review)** · No implementation yet · Owner: SingleStack

## The problem

Product records and GTM records are the cornerstone of SingleStack. Today the
app assumes effectively one of each: most module views query **org-wide**, so
the moment an org has two product lines, their intelligence, build, and GTM work
bleed together:

- Signals/themes from Product A appear in Product B's situation room.
- The homepage "Foundation filled %" averages fields across *all* products.
- Agents, competitors, and tracking topics are org-global with no product lens.

Multiple product records should mean **multiple lines of business**, each with
its own living Foundation, cleanly separated but rolling up to the org.

## Principles

1. **The product record is the unit of a line of business.** Everything
   downstream (GTM, intel, build, content) scopes to a product unless explicitly
   org-wide.
2. **Org-wide is a deliberate choice, not a default.** Some intel genuinely spans
   the company (a market shift). That should be representable — but the default
   home for a signal/theme/competitor is a product.
3. **One active context, everywhere.** The user is always working "in" a product
   line; every module reflects that selection consistently.
4. **Products are an organization boundary, not a security boundary.** RLS stays
   org-scoped (it already is); product scoping is application-level filtering.
   Users in an org can see all its product lines.
5. **Additive and reversible.** New scope columns are nullable; existing single-
   product orgs keep working with zero migration pain.

## Canonical hierarchy

```
Org (tenant root, RLS boundary)
└── Product record  (a line of business)        ← the cornerstone
    ├── GTM record(s)        product_id → product
    ├── Modules → Features
    ├── Releases (roadmap)   product_id → product
    ├── Initiatives (ship/roadmap/content/enablement)  product_id / gtm_record_id
    ├── Signals              scope: org | product | gtm
    ├── Signal themes        (today: org-only — needs product binding)
    ├── Competitors / market (today: org-only — usually per product line)
    └── Agents               (today: org-only — see "Agent scoping" below)
```

## Scoping audit (current state → target)

| Entity | Today | Target |
|---|---|---|
| `gtm_records` | `product_id` ✓ | unchanged |
| `record_fields` | under product/gtm ✓ | unchanged |
| `modules` / `features` | under product ✓ | unchanged |
| `releases` | `product_id` ✓ | unchanged |
| `initiatives` | `product_id` + `gtm_record_id` ✓ | unchanged |
| `signals` | `scope` org/product/gtm ✓ | unchanged; default to product when logged in a product context |
| `signal_themes` | **org-only** | add nullable `product_id` (null = org-wide synthesis) |
| `competitors` / market intel | **org-only** | add nullable `product_id` (null = org-wide) |
| `tracking_topics` | **org-only** | add nullable `product_id` |
| `content_pieces` / `campaigns` | tied to GTM record | inherits product via its GTM record (verify FK) |
| `agents` | **org-only** | add nullable `product_id` (null = shared across products) — see below |

## The active-product context (the key mechanism)

A single, app-wide "active product" selection that every module reads.

**Recommended approach — Context + switcher, URL-syncable:**

- A `ProductContext` (React context) holds `activeProductId`, hydrated from (in
  priority order): a `?product=` URL param → `localStorage` → the org's first
  product. Persisted back to both on change.
- A **product switcher** in the `Shell` (sidebar/topbar) lists the org's product
  records and switches context. An "All products / Org-wide" option shows the
  roll-up.
- Each module's queries add `.eq("product_id", activeProductId)` (or the
  scope-aware equivalent for signals). Org-wide views drop the filter.

**Why not route segments (`/p/[productId]/signals`)?** Cleaner in theory and
fully shareable, but it's a large refactor of every route and link. We can adopt
it later without changing the data model; the Context approach gets us correct
scoping now and keeps URLs shareable via `?product=`.

**Trade-off table**

| Option | Pros | Cons |
|---|---|---|
| React Context + `?product=` (recommended) | Incremental; shareable; small per-view change | Selection is app state, not the canonical URL |
| Route segments `/p/[id]/...` | Canonical, bookmarkable, RSC-friendly | Large refactor of all routes/links now |
| Pure localStorage | Trivial | Not shareable; drifts across tabs |

## Org-level vs product-level intelligence

- **Signals** already support `scope = org | product | gtm`. A product view shows
  `product` + `gtm`-scoped signals for that product, **plus** `org`-scoped
  signals surfaced as "company-wide intel (applies to all lines)".
- **Synthesis** runs **per product** (synthesize this product's signals into this
  product's themes), with an optional **org-level pass** over `org`-scoped
  signals. Hence `signal_themes.product_id` nullable.
- **Competitors** are usually per product line; org-wide competitors (a platform
  rival) stay with `product_id = null`.

## Agent scoping

Two valid models; recommend **hybrid**:

- `agents.product_id` nullable. `null` = a **shared** agent available to every
  product line (e.g. a general CRO agent). Non-null = a **dedicated** agent for
  one line of business.
- When run inside a product context, an agent reasons over that product's record
  + that product's signals. This dovetails with the planned Phase 2 work
  (pointing agents at product-lens vs GTM-lens signals) — the lens filter is
  applied *within* the active product.

## Rollout phases

1. **Context + switcher (no schema change).** Add `ProductContext`, the Shell
   switcher, and product filtering to the already-product-aware views (products,
   GTM, signals, ship, roadmap, initiatives). Immediate correctness for the
   common case. Single-product orgs see no change.
2. **Bind the org-only entities.** Add nullable `product_id` to `signal_themes`,
   `competitors`/market, `tracking_topics`, `agents`; update their views + the
   synthesis function to scope per product with an org-wide roll-up.
3. **Homepage roll-up.** Make the Foundation homepage product-aware: per-product
   completeness and activity, plus an org roll-up across lines.
4. **(Optional, later) Route segments** for canonical, shareable per-product
   URLs, once the model has settled.

## Open questions for review

1. **Switcher vs routes** — OK to start with the Context + `?product=` switcher
   (Phase 1) and defer route segments? (Recommended.)
2. **Default scope when logging a signal inside a product** — default to
   `product` scope (recommended), with an explicit "applies org-wide" toggle?
3. **Agents** — adopt the hybrid (shared `null` + dedicated per-product) model?
4. **Homepage** — when "All products / Org-wide" is selected, show a roll-up of
   all lines, or a portfolio picker? (Recommended: roll-up with per-line cards.)
