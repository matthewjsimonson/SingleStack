# Multi-Product Foundation — architecture design

Status: **implemented — Phases 1-6 complete** (see status below) · Owner: SingleStack

## Implementation status (2026-06-10, reconciled against develop)

- **Phase 2 (bind org-only entities) — largely DONE** on develop:
  `signal_themes`, `competitors`, `sources`, `objectives`, and `bridges` all
  carry a nullable `product_id` (migrations `20260530210000_multi_product` +
  `20260530280000_cross_product_scope`), with delete-demotion to company-wide
  instead of cascading destruction.
- **Competitor intel — DONE (Phase 4, `20260610000004_competitor_intel`).**
  `signals.competitor_id` promotes the former `metadata->>'competitor_id'` JSON
  link to a first-class FK (backfilled; the Feed dual-writes metadata for legacy
  readers); `signal_themes.competitor_id` enables per-competitor synthesis.
  `synthesize-signals` stamps a theme's competitor when its evidence unanimously
  points at one, grouped by the existing `category` axis (product | gtm). UI:
  each competitor gains a Themes tab splitting Product moves from GTM moves.
  Sources can also be competitor-scoped (`sources.competitor_id`) and
  per-competitor signal profiles exist (`20260608000001_signal_profiles`).
- **Battlecard agent pair — DONE (Phase 5, `20260611000000_battlecard_agents`),
  expressed in the cornerstone + child skills model per the note below.** The
  user builds the agents and skills and attaches them to a workflow (e.g.
  "Competitive analysis & messaging"): step 1 = agent × analyst skill, step 2 =
  agent × messenger skill. `battlecard-analyst` / `battlecard-messaging` are
  execution substrates + gates only — they compose the step's agent system
  prompt + cornerstone skills + child skill + the PAGE's context (the
  competitor's themes, matrix, signals, items) with cross-page awareness
  (product value prop, GTM voice), then write through the gates: analyst →
  evidence-cited `battlecard_items` via `intel_updates` (kind
  `battlecard_item`); messenger → the GTM record's Battlecard section via
  `proposals` (`proposal_changes.section` added so agent-added fields land in
  their section). Items carry provenance (`signal_ids`, `theme_id`,
  `proposed_by` = the step agent's name). Both honor the autonomy dial for
  their surface; unconfigured = buttons disabled with guidance (the system
  never improvises a prompt).
- **Technical layer — DONE (Phase 3, `20260610000003_technical_foundation`).**
  `record_fields.module_id` (the third parent) gives each module its own
  technical fields; `signals.module_id` attaches tech-shift intel to the module
  it affects. UI: the product Technical section gained debt + evolution-watchlist
  fields, and each module now has a technical panel (fields + attached signals +
  a build readout). This is the STANDING technical description, distinct from a
  Build Item's executable Technical Scope (`build_context_links`).
- **Homepage roll-up — DONE (Phase 6, view-layer only).** The homepage was
  already line-scoped when a product is active (completeness, signals, and now
  pending reviews via product_id/GTM mapping). "All products" on a multi-line
  org adds the per-line portfolio roll-up (recommended answer to open question
  4): a card per line with template-expected completeness, 7-day signals,
  pending reviews, and active themes — clicking a card switches the app-wide
  context. Single-product orgs see no change.
- **Agents:** plays were built then retired (`20260607000300_drop_plays`) in
  favor of the cornerstone + child skills model. The battlecard agent pair
  below should be expressed as skills in that model, not as plays.

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
    ├── Modules → Features   (+ technical foundation — see below)
    ├── Releases (roadmap)   product_id → product
    ├── Initiatives (ship/roadmap/content/enablement)  product_id / gtm_record_id
    ├── Signals              scope: org | product | gtm
    ├── Signal themes        (today: org-only — needs product binding)
    ├── Competitors / market (today: org-only — usually per product line)
    │   └── Competitor signals & themes  (planned — see below)
    └── Agents               (today: org-only — see "Agent scoping" below)
```

Two records, two jobs: the **product record** is product-focused — what the
solution is, how it works, how it's built (including its technical foundation).
The **GTM record** is market-focused — how it's positioned, messaged, and sold.
The designs below keep that separation sharp.

## Scoping audit (current state → target)

| Entity | Today | Target |
|---|---|---|
| `gtm_records` | `product_id` ✓ | unchanged |
| `record_fields` | under product/gtm ✓ | unchanged |
| `modules` / `features` | under product ✓ | unchanged |
| `releases` | `product_id` ✓ | unchanged |
| `initiatives` | `product_id` + `gtm_record_id` ✓ | unchanged |
| `signals` | `scope` org/product/gtm ✓ | default to product when logged in a product context; add nullable `module_id` (tech-evolution intel) and `competitor_id` (competitor intel) |
| `signal_themes` | **org-only** | add nullable `product_id` (null = org-wide synthesis) and nullable `competitor_id` (per-competitor themes) |
| `record_fields` | product/gtm parents | add `module_id` as a third exactly-one parent (module technical fields) |
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

## Technical foundation (product & module level)

The product record is product-focused, but today nothing captures **how** the
solution actually does what it does. That technical layer is what lets an org
see, as new technologies and capabilities come online, where its implementation
is aging — and evolve deliberately instead of accruing tech debt.

**Where it lives — reuse `record_fields`, don't invent a new table:**

- **Product level:** a "Technical" `section` of `record_fields` already fits the
  agnostic model (the section column was designed with exactly this in mind).
  Template fields: *Architecture & stack*, *Key dependencies*, *Build vs buy
  choices*, *Known constraints / debt*, *Evolution watchlist* (technologies that
  could obsolete or upgrade parts of the stack).
- **Module level:** `record_fields` currently allows only a product or GTM
  parent. Add a nullable `module_id` to the same exactly-one-parent CHECK
  pattern, so each module gets its own technical fields (*How it works*, *What
  it's built on*, *Debt / refactor notes*). Additive and consistent with the
  existing FK-integrity approach.

**How it stays alive (the feedback loops the user experience must surface):**

- **From signals:** product-lens signals that flag a technical shift (a new
  model, API, platform capability) should be attachable to a module — add a
  nullable `signals.module_id`. The module's technical panel shows its open
  signals; synthesis can emit "tech evolution" themes whose recommendation
  targets a specific technical field ("re-evaluate X, signal suggests Y is now
  viable").
- **From build:** the module's technical panel also shows recent ship/roadmap
  activity (features and releases touching that module), so the stated
  technical detail and the actual build work sit side by side — drift between
  them is the tech-debt early warning.

## Competitor signals & themes

Competitive intel today has a dashboard (capability matrix), battlecards, and a
read-only signal feed. Two gaps:

1. **Logging:** you can't capture a competitor observation from the UI as a
   first-class signal. Add a nullable `signals.competitor_id` and a "log signal"
   action inside the Competitive module (and on each competitor's detail page)
   that pre-fills it. Tracking topics watching a competitor tag their harvested
   signals the same way.
2. **Synthesis:** competitor signals deserve the same signal → theme treatment
   GTM and product strategy get. Add a nullable `signal_themes.competitor_id`
   and run synthesis per competitor.

**Grouping recommendation:** reuse the existing `category` axis rather than
inventing a competitor-specific taxonomy. Per competitor, themes group into:

- **Product themes** — capability and roadmap moves (launches, deprecations,
  platform bets). These inform the **capability matrix** (suggest score
  changes) and our own **technical foundation** ("they rebuilt on X").
- **GTM themes** — pricing, packaging, messaging, and positioning moves. These
  inform **battlecards** and our GTM record's messaging sections.

This keeps one taxonomy across the whole app (a signal is product-lens or
GTM-lens everywhere), and each competitor theme lands next to the artifact it
should change. Org-wide market themes (not tied to one competitor) remain
`competitor_id = null` — the existing Market view.

## Battlecard agents (analyst + creative)

Battlecards now live in two places with different jobs:

| Area | Nature | Source of truth for |
|---|---|---|
| Competitive module → `battlecard_items` | Structured, factual (win / lose / objection / trap) | What is *true* about us vs them |
| GTM record → "Battlecard" messaging section | Narrative, seller-facing | What we *say* about it |

Curate them with **two complementary agent archetypes**, not one:

- **Competitive analyst agent (realistic).** Reads a competitor's product + GTM
  themes, the capability matrix, and our technical foundation. Proposes
  `battlecard_items` — new wins/loses when the matrix shifts, new objections
  when a competitor theme shows a repeated attack — every item citing its
  supporting signals. Grounded and conservative: its job is accuracy.
- **Messaging agent (creative).** Reads the ratified battlecard items plus the
  GTM record (personas, positioning) and drafts the GTM Battlecard section,
  talk tracks, and objection responses — turning the analyst's strengths and
  weaknesses into a message in the org's voice. Generative by design: its job
  is persuasion built on the analyst's facts.

**Curation flow:** signals → competitor themes → analyst agent proposes
battlecard items → human ratifies → messaging agent drafts seller-facing copy →
human ratifies. Both agents write through the existing **proposals /
ratification** system rather than editing directly, so the factual layer stays
trustworthy and the creative layer stays on-brand. Under the agent-scoping
model above, both are natural per-product (dedicated) agents.

## Rollout phases

1. **Context + switcher (no schema change).** Add `ProductContext`, the Shell
   switcher, and product filtering to the already-product-aware views (products,
   GTM, signals, ship, roadmap, initiatives). Immediate correctness for the
   common case. Single-product orgs see no change.
2. **Bind the org-only entities.** Add nullable `product_id` to `signal_themes`,
   `competitors`/market, `tracking_topics`, `agents`; update their views + the
   synthesis function to scope per product with an org-wide roll-up.
3. **Technical foundation.** Add `record_fields.module_id` and
   `signals.module_id`; ship the "Technical" section templates at product and
   module level; add the module technical panel showing its fields alongside
   open signals and recent ship activity. (Independent of multi-product, but
   builds on the per-product views from Phases 1–2.)
4. **Competitor signals & themes.** Add `signals.competitor_id` and
   `signal_themes.competitor_id`; "log signal" from the Competitive module and
   competitor detail pages; per-competitor synthesis grouped into Product
   themes and GTM themes, feeding the capability matrix and battlecards.
   (Depends on Phase 2: competitors are product-scoped first, so themes inherit
   the right product line.)
5. **Battlecard agent pair.** The competitive analyst agent (proposes
   `battlecard_items` from competitor themes + the matrix, evidence-linked) and
   the messaging agent (drafts the GTM Battlecard section from ratified items),
   both writing through proposals/ratification. (Depends on Phases 3–4 for
   their inputs.)
6. **Homepage roll-up.** Make the Foundation homepage product-aware: per-product
   completeness and activity, plus an org roll-up across lines. (Independent —
   can run in parallel with 3–5.)
7. **(Optional, later) Route segments** for canonical, shareable per-product
   URLs, once the model has settled.

## Open questions for review

1. **Switcher vs routes** — OK to start with the Context + `?product=` switcher
   (Phase 1) and defer route segments? (Recommended.)
2. **Default scope when logging a signal inside a product** — default to
   `product` scope (recommended), with an explicit "applies org-wide" toggle?
3. **Agents** — adopt the hybrid (shared `null` + dedicated per-product) model?
4. **Homepage** — when "All products / Org-wide" is selected, show a roll-up of
   all lines, or a portfolio picker? (Recommended: roll-up with per-line cards.)
5. **Competitor theme grouping** — reuse the existing product/GTM `category`
   axis per competitor (recommended above), or a competitor-specific taxonomy
   (e.g. pricing / capability / positioning)? The former keeps one taxonomy
   app-wide; the latter is finer-grained but fragments synthesis.
6. **Module technical fields** — seed them from a template on module creation,
   or leave empty until filled? (Recommended: seed the template — an empty
   technical section invites drift from day one.)
7. **Agent write access** — both battlecard agents go through
   proposals/ratification (recommended), or may the messaging agent draft
   directly into the GTM section since it's downstream of ratified facts?
