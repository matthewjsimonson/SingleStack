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

## The PLG model (researched, then mapped to SingleStack)

Product-led growth is a **flywheel**: users move **Evaluator → Beginner → Regular
→ Champion**, advanced by **Activate → Adopt → Adore → Advocate**, and champions
bring new evaluators — the loop spins. Wrapped in the funnel **Acquire →
Activate → Convert → Retain → Expand → Advocate**, with **PQLs** (usage-driven
leads) as the product→sales bridge. The best-documented failure mode is teams
**over-investing acquisition/activation and starving expansion & advocacy** — the
stages that make the flywheel self-sustaining. *That is the coverage gap this
surface exists to catch.* (Sources at the end.)

**SingleStack already models this flywheel** — `accounts.pql_state` literally
tracks a customer through it: `none → activating → qualified → expansion → at_risk`
(score-accounts; usage-ingest). SingleStack is a product-**marketing** platform,
so its ecosystem is the **product-marketing work that drives each stage**, grounded
in the two records and fed by a shared intelligence loop.

## The shape: two circles + a shared loop

```
        PRODUCT ECOSYSTEM                         GTM ECOSYSTEM
      (Product Record center)                  (GTM Record center)
   what makes the product worth              the growth motion across the
            growing                              PLG flywheel stages

   Product Truth                            Positioning ─┐
   Capabilities & Differentiation  ──────▶  Messaging & Value   (Acquire/Activate)
   Technical Foundation                     Audience & ICP
   Strategy & Decisions          ◀──────    Motion & Packaging  (Convert)
   Roadmap & Ship                           Competitive
                                            Demand & Content    (Acquire/Adopt)
                                            Enablement          (Convert, assisted)
                                            Lifecycle & PQL     (Activate→Expand→Advocate)

        └────────── SHARED INTELLIGENCE LOOP (the engine) ──────────┘
         Sense (signals, usage) → Synthesize (themes) → Decide
              (decisions) → Build/Ship → Validate (outcomes) ↺
```

Product capabilities feed GTM positioning/competitive (what you can claim);
GTM market & PQL signals feed product strategy/roadmap (what to build); the
intelligence loop senses, synthesizes, decides, ships, validates — and the
validation becomes new signals that spin both circles again.

---

## Product ecosystem — areas → tasks (Product Record center)

| Area · area-key | Goal | Tasks (the unit a workflow covers) | Serves / record |
|---|---|---|---|
| **Product Truth** · `products` | A current, accurate product identity. | refresh Overview from signals; reconcile drift; keep vision/intent live | Product · Overview · `synthesize-profile`, `agent-propose`, `refine-record` |
| **Capabilities & Differentiation** · `products`,`capabilities`,`competitive` | Know what it does and where it wins/lags. | maintain core/diff capabilities + roadmap themes; **score capabilities vs rivals**; track frontier-model capability | Product · Capabilities + matrix · `score-capabilities`, frontier |
| **Technical Foundation** · `products` | The buildable truth that grounds "How". | maintain architecture/stack/security; flag debt + evolution-watch | Product · Technical · *(thin coverage today)* |
| **Strategy & Decisions** · `signals`,`products` | A prioritized, evidence-grounded direction. | synthesize product themes; **draft decisions** (options + tradeoffs); propose dimensions; bundle verified signals | Strategy · `synthesize-signals`, `draft-decision`, `profile-to-strategy`, `propose-dimensions` |
| **Roadmap & Ship** · `products` | Build the right things, validated. | draft the capability-aware **How**; run build workflows; **watch outcomes** → signals | Roadmap/Ship · `draft-how`, `run-workflow`, `outcome-watch`, `distill-lessons` |

## GTM ecosystem — areas → tasks (GTM Record center)

| Area · area-key | Goal | Tasks | Flywheel stage · record |
|---|---|---|---|
| **Positioning** · `gtm` | A sharp, defensible market frame. | maintain category POV / positioning / differentiation; sharpen vs rivals | frames all · GTM · Positioning |
| **Messaging & Value** · `gtm` | A clear promise + value narratives. | maintain value prop + pillars; persona-tune; value narratives for activation | Acquire/Activate · GTM · Messaging |
| **Audience & ICP** · `gtm` | Know exactly who you grow. | maintain ICP, industries, personas; **refresh from PQL + market** | targeting · GTM · Buyer |
| **Motion & Packaging** · `gtm` | The right motion + pricing. | maintain win themes, GTM motion, pricing; PLG/sales-assist fit | Convert · GTM · Motion |
| **Competitive** · `gtm`,`competitive` | Win competitive deals. | **analyze rivals** (evidence-cited battlecard items); **draft seller copy** (talk track, objections) | Convert · GTM · Battlecard + Competitive · `battlecard-analyst`, `battlecard-messaging` |
| **Demand & Content** · `gtm` | Acquisition + adoption assets. | draft content grounded in the record; run campaigns | Acquire/Adopt · Content/Campaigns |
| **Enablement** · `gtm` | Reps/champions ready to sell. | build enablement from ratified facts | Convert (assisted) · Enablement |
| **Lifecycle & PQL** · `gtm`,`signals` | Read the product-led signal; surface PQLs. | ingest usage; **score accounts** (activation/expansion/churn); qualify PQLs; emit GTM signals on state change; feed positioning + the sell desk | Activate→Expand→Advocate · accounts/`usage-ingest`/`score-accounts`/PQL/Sell desk |

## The shared intelligence loop (the engine that spins both)

`Sense` (signals via `connector-runner`/`scheduled-pulls`; usage via
`usage-ingest`) → `Synthesize` (`synthesize-signals` → living themes) → `Decide`
(`draft-decision` + human ratify) → `Build/Ship` (`draft-how`/`run-workflow`) →
`Validate` (`outcome-watch`/`distill-lessons` → new signals). It is **not its own
column** — it is the loop every area both feeds and draws from. A starved loop
stage (e.g. Sense dark, Validate dark) is the recursion-level gap.

---

## Coverage model (graded per task, rolled up per area)

A task is **covered** when the workforce can actually do it:

1. **Agent** — an agent is connected to the area (`connections.area`, kind=internal).
2. **Cornerstone** — that agent has an identity (`skills.kind='cornerstone'`).
3. **Child skills** — it has child skills tagged to the task's area
   (`skills.areas` ∩ area, `kind='child'`) — the playbook for *this* work.
4. **Workflow** — a workflow runs the task on a cadence/trigger (`workflows`;
   `trigger ∈ manual|scheduled|on_signal`).

Roll-up per area: **Covered** (all four, for its tasks) · **Partial** (an agent is
there but a skill or workflow is missing — it *can* be asked but isn't equipped or
isn't on a cadence) · **Gap** (no agent, or no skills for the work).

**Today's reality (from the codebase) — the gaps are real and instructive:**
the seeded roster (CPO/CENG → `products,signals,capabilities`; CRO/CCO →
`gtm,signals,capabilities`; COS → `records`) gives broad *agent* coverage, but
**skills and workflows are thin on the GTM areas** (Positioning, Messaging, Motion,
Demand/Content, Enablement) and on **Technical Foundation** — and several areas have
no scheduled workflow. That is exactly the "well-covered acquisition, starved
downstream" PLG failure, made visible.

## How this reshapes the surface (the rebuild)

- **Two circles**, Product & GTM Records at the centers; areas orbit each; the
  flywheel + product↔GTM edges drawn between them.
- Each area shows **coverage** + **what's missing per task** + a **control to fix
  it**: *put an agent on this area*, *attach/tailor a child skill for this task*,
  *create a workflow* — reusing the agent-create / skill-tailor / workflow builders
  already shipped (Phases B/C). HITL throughout; nothing auto-applies.
- **Gap-first.** The surface leads with what's unattended, because that's the
  decision the operator must make to ensure the best PLG.

## What changes vs the shipped G.0–G.2

- `web/lib/lifecycle.ts` (sense→…→validate **token-spend** balance) was the wrong
  frame for this surface. It is **re-pointed**: areas become the PLG Product/GTM
  areas above; the metric becomes **coverage** (agents/skills/workflows per task),
  not spend. The intelligence loop is preserved as the shared engine. (Spend stays
  in the F2 cost dial.)
- `Ecosystem.tsx` is rebuilt around the two-circle, gap-first coverage map.
- "Loop risk" becomes "**a feeder area is uncovered**" (e.g. Sense or Capabilities).

## Sources (PLG model)

- ProductLed — the Growth Flywheel: https://productled.com/blog/product-led-growth-flywheel/
- OpenView — PQLs / 5 pillars of PLG (Evaluators→Champions; Activate→Advocate): https://openviewpartners.com/blog/the-5-pillars-for-product-led-growth-using-product-qualified-leads
- Pendo — how product-led marketers drive growth (PMM's PLG remit): https://www.pendo.io/product-led/how-marketers-use-product-led-strategies-to-drive-growth/
- ProductLed.org — the PLG flywheel: https://www.productled.org/foundations/the-product-led-growth-flywheel

## Open for confirmation (before the rebuild)

1. **Area set & names** — 5 Product + 8 GTM areas above, each mapped to a record
   section / module + the area-key vocabulary already in the schema. Right set?
2. **Tasks as the coverage unit** — grade per task (workflow covers a task), roll
   up to area. Agreed?
3. **Centers** — single Product + single GTM record first; one circle per product
   line for multi-product (cross-sell spans) later. Confirm single-first?
