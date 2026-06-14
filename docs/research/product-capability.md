# The Product Capability — Research & Recommendation

Status: **finding + recommendation** · Method: 6 parallel workstreams (1 internal codebase
audit + 5 cited external research angles, 2024–2026 sources) · Feeds:
`agent-orchestration.md`, `plg-ecosystem.md`.

## The question

Product is not just another module — in Product-Led Growth, **the product is the growth
engine**. Before we finish the orchestration layer, we needed to know: what must the
product capability *be*, how does build/execution actually work in PLG, what does an
AI-native PM (who codes) do — and does our architecture let features/builds be
first-class? This synthesizes the answer and recommends the work.

## What the research says (cited)

**1. In PLG the product *is* the go-to-market.** The product drives acquisition,
activation, expansion, retention — not a sales org (Pendo; OpenView; Reforge, 2024).
**Activation — the empirically-defined "aha" — is the central lever**: activated users
retain ≥2× (Lenny's Newsletter; Statsig). **PQLs** infer buying intent from in-product
behavior and convert ~25% vs ~9% for MQLs (Mixpanel, 2026). Honest counterpoint: **pure
PLG is being out-performed by hybrid** (67% of hybrid firms hit NRR targets vs 58% pure
— OpenView 2024); design for product-led *plus* sales-assist handoffs, not dogma.

**2. Execution is a dual-track loop, not a queue.** Discovery ∥ delivery; the
**Opportunity Solution Tree** (Outcome → Opportunity → Solution → Experiment, Teresa
Torres) is the canonical lineage (Product Talk; Product School, 2024). Good execution
**closes the loop**: every ship pairs a **feature flag + instrumentation + a
pre-registered success metric**, so outcomes auto-generate new signals and shrink the
"product-decision gap" (Mixpanel; Optimizely, 2024-26). Optimize an *input-metrics tree*
(activation → retention → PQL → expansion/NRR), not a lone north star (Reforge).

**3. The PLG PM owns a metric, not a backlog.** Core PM *creates* value (features);
Growth PM *owns a metric* and runs many parallel experiments across surfaces (GrowthTalent,
2026; Elena Verna). A roadmap with no metric attached makes you "a glorified order-taker"
(Aakash Gupta, 2026). PQL scoring is the product→sales trigger the PM owns.

**4. AI made the PM a builder — "prototype, not PRD."** "Vibe coding" (Karpathy, Feb
2025) went mainstream — Collins Word of the Year 2025; YC reports ~25% of a 2025 batch
had ~95% AI-generated code (Garry Tan). Microsoft's CPO: *"if you aren't prototyping with
AI, you're doing it wrong."* Tools split by job — v0 (UI), Lovable (MVPs, ~$400M ARR by
2/2026), Bolt, Replit Agent (full-stack). Figma: *"A PRD tells your team what you want;
a prototype shows them."* **The unit of product work is shifting from PRD → working
prototype** (Lenny's Newsletter; Figma; Reforge, 2025).

**5. …and the differentiator is the last 30%, not the first 70%.** Addy Osmani's "70%
problem": AI gets you 70% fast; security, edge cases, maintainability are the human 30%.
Measured risk is real: **45% of LLM-generated code introduced an OWASP Top-10 vuln**
(Veracode, 2025); **8× increase in duplicated code** (GitClear). The emerging governance
model is **human-in-the-loop as policy + exception oversight** (define guardrails, review
flagged outliers), not line-by-line — and multi-agent **planner → executor → reviewer**
swarms (McKinsey; CSA, 2026). *Provenance, review, and ratification are exactly where a
governed platform wins.*

## The internal diagnosis (codebase audit)

Our product circle is **a specification-and-decision system that hands off at the
boundary of the actual build.** It models everything *up to* the build (signals →
strategy → decisions → scope Why/What → approach How) and everything *after* shipping
(`expected_outcomes` → validation → signal). But **the make itself is an off-platform
markdown brief** (`web/lib/agentBrief.ts`) copied to an external coding agent.

- **No build artifact entity.** `initiatives.build_state='shipped'` is a flag pointing at
  nothing — no PR/commit/preview/diff/prototype. (A `prototype_url` was even dropped.)
- **No build function.** Every product-side function only *drafts text*; `agent-run`'s
  only write is `propose_change`. Nothing produces a build.
- **`shipped` is a manual claim** → `expected_outcomes` validation has an unverified `t=0`.
- **Agent asymmetry.** GTM has a deep bench and closed loops (`usage-ingest →
  score-accounts → PQL → signal`); product has two *advisory* officers and no builder.
- **`build_ship` is flagged `is_engine=true` — the declared engine of the platform — yet
  it's the least executable area in the codebase. The declared engine has no motor.**

The match is exact: the industry moved the unit of work to *the working build*, and that
is precisely the row our model is missing.

## Recommendation — build the motor (P2.5: the Build Capability)

Make the build a first-class, governed, orchestratable thing. Five moves, smallest-first:

1. **`builds` artifact table** (child of `initiatives`, per schema §4/§1.1): `status`
   (queued|building|built|failed|shipped), the produced artifact (PR/branch/commit/preview
   URL + diff), the model/agent used, links to `build_context_links` + the brief, and the
   `area_task` it satisfies. *Now `workflow_steps` has a real thing to target for
   `build_with_frontier` — the single highest-leverage gap.*
2. **A real `build` edge function.** Consumes the assembled brief, invokes a frontier model,
   and lands its output as a **proposed diff/PR in the existing HITL review queue** (mirrors
   `propose_change` — nothing auto-applies). This turns `build_with_frontier` from a label
   into an executable `function_key`.
3. **A reviewer/critic pass = the differentiator.** Pair generation with an automatic
   review agent running security + duplication + test checks (directly answering Veracode
   45% / GitClear 8×) before the human sees it. This is the governed "last 30%" competitors
   leave exposed — provenance + ratification + RLS already give us the substrate.
4. **A verified ship transition.** `shipped` becomes an *observed* event (artifact
   merged/released), giving `expected_outcomes` a trustworthy `t=0` and genuinely closing
   **build → ship → validate → new signal**. Auto-pair instrumentation at ship.
5. **An execution-grade builder agent + the Core/Growth split.** A "builder" officer with
   write capability beyond `propose_change`; CPO owns *outcomes* (a north-star + driver
   tree), a Growth-PM agent owns a metric and runs parallel experiments, and PQL scoring
   bridges product → GTM (the cross-circle loop the two-hearts model needs).

**Governance posture (non-negotiable):** HITL = policy + exceptions. Humans set guardrails
(security thresholds, data/access scope, ship gates) and ratify; agents propose. Every
build is provenance-linked and field/diff-ratifiable. This is the enterprise-credible
answer to the vibe-coding risk data — and our moat.

## The build lifecycle & handoff model (research-grounded)

A second research pass (4 cited workstreams, 2024–2026) on *how PMs actually build,
prototype, and hand off to frontier models* — the spec the engine (P2.5b) builds to:

- **The handoff is a structured spec, not a blob.** requirements → design → tasks; EARS
  machine-checkable acceptance criteria; **tests as the contract** ("done" is a predicate
  CI checks); a context bundle of **lightweight identifiers** (file paths, schema entity
  IDs) resolved just-in-time + a scoped rules file. (GitHub Spec Kit; AWS Kiro; Anthropic
  context-engineering; Osmani.) → *SingleStack:* `build_context_links` **is** the
  lightweight-ref bundle; the `skills` are the scoped rules; the `brief` should be
  structured (req/design/tasks) with a pre-handoff consistency check.
- **Prototype ≠ production.** prototype = reference implementation + a known-limitations
  list; production still needs data model, integration, and NFRs (security/tests/a11y).
  The gap is measured (Veracode 45% vuln; CodeRabbit AI PRs 1.7× issues). (Figma; Reforge;
  CHI 2025.) → `builds.kind` (`prototype|production`); a productionization/NFR checklist
  gate before merge (P2.5b).
- **PR-centric lifecycle; the agent cannot declare itself done.** agent opens a PR →
  reviewer pass + human review → merge → deploy. GitHub's coding agent **cannot merge/
  approve its own work**. (GitHub Copilot agent; Graphite; merge-gate analysis.) →
  `builds.status` lifecycle; the reviewer pass is a **required machine-readable status
  check** (P2.5b); the HITL merge gate is non-delegable.
- **"merged" ≠ "shipped" ≠ "verified".** shipped = a production deploy that passed
  post-merge checks (Vercel Deployment Checks); verified = outcome metrics met → the
  existing **`expected_outcomes`** loop. → verified-ship floor trigger (built in P2.5a.2);
  `verified` wired to `expected_outcomes` (P2.5b).
- **Oversight as a design property** (EU AI Act Art. 14): the surface must show the agent's
  plan, diff, reviewer findings, and check status *at the merge moment*, so a human can
  detect anomalies and override against automation bias — not approve blind.

## Where this sits in the plan

```
P1  governed areas/area_tasks ........................... DONE
P2  bind orchestration to areas (connections/skills/      NEXT (then pause to validate)
    signals→product/area_sections; seed wiring)
P2.5  THE BUILD MOTOR (this doc): builds table + build     NEW — the product circle's engine
    function→HITL + reviewer pass + verified ship +
    builder agent + instrumentation
P3  workflow_steps (can now target a build) ............. then
P4  prescriptive coverage (credits real builds) ......... then
P5  living surface (two balanced hearts) ................ then
P6  seed exemplar workflows incl. cross-circle build→PQL  then
```

P2.5 is sequenced **after** P2's vocabulary binding (so a build's `area_task` resolves)
and **before** `workflow_steps` (so steps have a build to orchestrate). It is a
significant capability, not a migration — scope it deliberately.
