# The PLG Ecosystem — coverage of the product-led-growth process

Status: **defined (researched, grounded)** · Owner: SingleStack · Re-frames the
Ecosystem surface (`skills-agents-buildout.md` G). The cost dial (F2) is the spend
lens and is unaffected; **this is the coverage lens.**

## What it is (the correction)

The Ecosystem is a **circle, not a line**, and about **coverage, not cost**: the
**Product Record and GTM Record at the centers** of their two connected circles,
the areas of the product-led-growth process orbiting each, and every area
answering — for each of its **tasks** —

> *Is there an **agent**, with the right **skills / child-skills**, running the
> right **workflow**, to actually do this?*

A task with no agent, an agent missing the skill, or no workflow is a **gap** —
and a gap anywhere stalls the flywheel.

## What SingleStack is (the spine of this whole model)

SingleStack **converges product management and product marketing** on one platform,
humans and frontier-model agents co-running both. That convergence is the
differentiator — and it splits the PLG process cleanly into the two circles:

- **Build / Product circle = the PM areas of PLG.** Its heart is **execution**:
  working *with frontier models* to ship — new products, new modules, new features,
  enhancements, bug fixes. **In product-led growth there is no growth without
  execution.** (These capabilities are the lightest today and the highest-leverage
  to build out — this is the true difference maker.)
- **GTM circle = the PMM areas of PLG.** The growth motion across the flywheel —
  positioning, messaging, competitive, content, enablement, and the product-led
  signal (PQL).

This is **PRODUCT-led** growth: the product *is* the growth engine, so the engine
only spins if you build it. The Build circle makes the product worth growing; the
GTM circle grows it; the intelligence loop connects them.

## The PLG model (researched, then mapped)

PLG is a **flywheel**: users move **Evaluator → Beginner → Regular → Champion**,
advanced by **Activate → Adopt → Adore → Advocate**; champions bring new evaluators
and it spins. Wrapped in the funnel **Acquire → Activate → Convert → Retain →
Expand → Advocate**, with **PQLs** (usage-driven leads) as the product→sales bridge.
The best-documented failure is teams **over-investing acquisition/activation and
starving expansion & advocacy** — *exactly* the coverage gap this surface catches.
SingleStack already encodes the flywheel: `accounts.pql_state` tracks a customer
`none → activating → qualified → expansion → at_risk`. (Sources at the end.)

## The shape: two circles + a shared loop

```
     BUILD / PRODUCT ECOSYSTEM (PM)                 GTM ECOSYSTEM (PMM)
       (Product Record center)                     (GTM Record center)
   make the product worth growing —             grow it across the flywheel
        execution is the heart

   Product Truth                            Positioning
   Capabilities & Differentiation  ──────▶  Messaging & Value   (Acquire/Activate)
   Technical Foundation                     Audience & ICP
   Strategy & Decisions          ◀──────    Motion & Packaging  (Convert)
   ►► BUILD & SHIP (execution                Competitive
      WITH frontier models) ◄◄              Demand & Content    (Acquire/Adopt)
      new products · modules ·              Enablement          (Convert, assisted)
      features · enhancements ·             Lifecycle & PQL     (Activate→Expand→Advocate)
      bug fixes

        └────────── SHARED INTELLIGENCE LOOP (the engine) ──────────┘
         Sense (signals, usage) → Synthesize (themes) → Decide
              (decisions) → BUILD/SHIP → Validate (outcomes) ↺
```

Capabilities feed GTM positioning/competitive (what you can claim); GTM market & PQL
signals feed product strategy & the build queue (what to build); the loop senses,
synthesizes, decides, **ships**, validates — and validation becomes new signals that
spin both circles again. **Execution is where the loop closes into growth.**

---

## Build / Product ecosystem — areas → tasks (PM side, Product Record center)

The first four areas **ground** the build; **Build & Ship is the engine** — and the
one that's weakest today.

| Area · area-key | Goal | Tasks (the unit a workflow covers) | Record / functions |
|---|---|---|---|
| **Product Truth** · `products` | A current, accurate product identity. | refresh Overview from signals; reconcile drift; keep vision/intent live | Product · Overview · `synthesize-profile`, `agent-propose`, `refine-record` |
| **Capabilities & Differentiation** · `products`,`capabilities`,`competitive` | Know what it does + where it wins/lags. | maintain core/diff capabilities + roadmap themes; score vs rivals; track frontier-model capability | Product · Capabilities + matrix · `score-capabilities`, frontier |
| **Technical Foundation** · `products` | The buildable truth that grounds every "How". | maintain architecture/stack/security; flag debt + evolution-watch | Product · Technical · *(thin today)* |
| **Strategy & Decisions** · `signals`,`products` | A prioritized, evidence-grounded direction. | synthesize product themes; hone strategy; **draft decisions** (options + tradeoffs); propose dimensions; bundle verified signals → build candidates | Strategy · `synthesize-signals`, `draft-decision`, `profile-to-strategy`, `propose-dimensions` |
| **► BUILD & SHIP — execution with frontier models** · `products` | **Turn decisions into shipped product. No growth without execution.** | **scope** the build (Why/What: problem, evidence, acceptance criteria); **plan** the approach (How: frontier-aware, dependencies, risks); **build with frontier models** (the actual make — *the weak, highest-leverage part*); **ship/release**; **validate** outcomes → new signals — across **new products · modules · features · enhancements · bug fixes** | Roadmap/Ship · `draft-how`, `run-workflow`, `orchestrate-roster`, `outcome-watch`, `distill-lessons` |

> **The gap that matters most:** today the build area can *draft a How* and *watch
> an outcome*, but the actual **build-with-frontier-models execution** (and a per-
> build-type workflow) is thin. Building this out is the differentiator — the PM
> half of the convergence, and the place "product-led" earns the word *product*.

## GTM ecosystem — areas → tasks (PMM side, GTM Record center)

| Area · area-key | Goal | Tasks | Flywheel · record |
|---|---|---|---|
| **Positioning** · `gtm` | A sharp, defensible market frame. | maintain category POV / positioning / differentiation; sharpen vs rivals | frames all · Positioning |
| **Messaging & Value** · `gtm` | A clear promise + value narratives. | maintain value prop + pillars; persona-tune; activation narratives | Acquire/Activate · Messaging |
| **Audience & ICP** · `gtm` | Know exactly who you grow. | maintain ICP, industries, personas; refresh from PQL + market | targeting · Buyer |
| **Motion & Packaging** · `gtm` | The right motion + pricing. | maintain win themes, GTM motion, pricing; PLG/sales-assist fit | Convert · Motion |
| **Competitive** · `gtm`,`competitive` | Win competitive deals. | analyze rivals (evidence-cited battlecard items); draft seller copy (talk track, objections) | Convert · Battlecard · `battlecard-analyst`, `battlecard-messaging` |
| **Demand & Content** · `gtm` | Acquisition + adoption assets. | draft content grounded in the record; run campaigns | Acquire/Adopt · Content/Campaigns |
| **Enablement** · `gtm` | Reps/champions ready to sell. | build enablement from ratified facts | Convert (assisted) · Enablement |
| **Lifecycle & PQL** · `gtm`,`signals` | Read the product-led signal; surface PQLs. | ingest usage; score accounts (activation/expansion/churn); qualify PQLs; emit GTM signals on state change; feed positioning + sell desk | Activate→Expand→Advocate · accounts/`usage-ingest`/`score-accounts`/PQL/Sell |

## The shared intelligence loop (the engine that spins both)

`Sense` (signals via `connector-runner`/`scheduled-pulls`; usage via `usage-ingest`)
→ `Synthesize` (`synthesize-signals` → living themes) → `Decide` (`draft-decision` +
human ratify) → **`Build/Ship`** (`draft-how`/`run-workflow`/`orchestrate-roster`) →
`Validate` (`outcome-watch`/`distill-lessons` → new signals). Not its own column —
the loop every area feeds and draws from. A starved stage (Sense dark, **Build
dark**, Validate dark) is the recursion-level gap.

---

## Coverage model (graded **per area and per task**)

A task is **covered** when the workforce can actually do it:

1. **Agent** — an agent is connected to the area (`connections.area`, kind=internal).
2. **Cornerstone** — that agent has an identity (`skills.kind='cornerstone'`).
3. **Child skills** — child skills tagged to the task's area (`skills.areas` ∩ area,
   `kind='child'`) — the playbook for *this* task.
4. **Workflow** — a workflow runs the task on a cadence/trigger (`workflows`).

**Grade the task** on all four; **roll up to the area** — **Covered** (all tasks
equipped) · **Partial** (an agent is there but a task's skill/workflow is missing) ·
**Gap** (no agent, or no skills for the work). Show both levels: the area badge for
scanning, the task list for the actual fix.

**Today's reality (from the codebase):** the seeded roster (CPO/CENG →
`products,signals,capabilities`; CRO/CCO → `gtm,signals,capabilities`; COS →
`records`) gives broad *agent* coverage, but **skills & workflows are thin on the
Build execution tasks and on Technical Foundation** (the PM circle the user wants
built out), and on several **GTM** areas (Positioning, Messaging, Motion,
Demand/Content, Enablement). The Build circle being underpowered is the headline
gap — the PM half of the convergence.

## How this reshapes the surface (the rebuild)

- **Two circles**, Product & GTM Records at the centers; areas orbit each; the
  flywheel + product↔GTM edges drawn between; **Build & Ship visually central** in
  the Product circle.
- Each area shows **coverage** + **what's missing per task** + a **control to fix
  it**: *put an agent on this area*, *attach/tailor a child skill for this task*,
  *create a workflow* — reusing the agent-create / skill-tailor / workflow builders
  (Phases B/C). HITL throughout; nothing auto-applies.
- **Gap-first**, and **build-forward**: the surface leads with what's unattended,
  and makes the Build execution area easy to staff because that's the differentiator.

## What changes vs the shipped G.0–G.2

- `web/lib/lifecycle.ts` (sense→…→validate **token-spend** balance) was the wrong
  frame. **Re-pointed**: areas become the PLG Build/GTM areas above; the metric
  becomes **coverage** (agents/skills/workflows per task/area), not spend. The
  intelligence loop is preserved as the shared engine; **Build/Ship is elevated**.
  (Spend stays in the F2 cost dial.)
- `Ecosystem.tsx` rebuilt as the two-circle, gap-first, build-forward coverage map.
- "Loop risk" → "**a feeder area is uncovered**" (e.g. Sense, **Build**, Capabilities).

## Sources (PLG model)

- ProductLed — the Growth Flywheel: https://productled.com/blog/product-led-growth-flywheel/
- OpenView — PQLs / 5 pillars of PLG: https://openviewpartners.com/blog/the-5-pillars-for-product-led-growth-using-product-qualified-leads
- Pendo — how product-led marketers drive growth: https://www.pendo.io/product-led/how-marketers-use-product-led-strategies-to-drive-growth/
- ProductLed.org — the PLG flywheel: https://www.productled.org/foundations/the-product-led-growth-flywheel

## Confirmed with the operator

- SingleStack = **PM + PMM converged**; Build circle = PM areas (execution with
  frontier models is the heart and the differentiator); GTM circle = PMM areas.
- Coverage graded **per area and per task**.
- Open next: build out the Build/Product areas (weak today) once the surface lands.
