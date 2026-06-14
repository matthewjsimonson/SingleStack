# Skills & Agents buildout — the living plan

Status: **building (Phase A)** · Owner: SingleStack
Governs: the skills-as-files substrate, the agent model, stewardship, and fail-safes.
Companion to `living-records.md` (records) and `compounding-intelligence.md` (themes).

This doc is the source of truth for the multi-phase build. Keep it accurate: before
starting any phase, re-validate it against the current schema and prior commits.
**No shortcuts** — each phase ships the right architecture, reliability, and
performance, verified, before the next.

---

## North star
An agentic system where humans and AI co-maintain product + GTM, where **agents
don't fight or contradict** each other, where **skills are true markdown files**
(uploadable, downloadable, and updated *as files* — including agentically), and
where, when an answer is unclear, an agent **walks a decision tree of fail-safes**
instead of guessing.

## Load-bearing decisions (made)
1. **Control before features.** Canonical record values cannot change except via a
   ratified proposal or an explicit human channel (DB invariant). *(Shipped: C1, C2.)*
2. **Skill body = markdown in the DB** (`skills.instructions`), canonical. A real
   `SKILL.md` is materialized on download and parsed on upload; `skill_revisions`
   is the file-diff history. Storage is used only for the raw uploaded original
   (provenance), never as the canonical body.
3. **Library = generic templates; agent = tailored instances (`template → instance`).**
   A library skill is a generic **template** (cornerstone = a role/purpose profile like
   "one narrative" for a CMO/CCO; child = a general capability like "competitive
   analysis"). Attaching a template to an agent **mints a per-agent tailored
   INSTANCE** — its own markdown body and its own `skill_revisions` history,
   `parent_id → the template` it was tailored from. The same generic child is
   tailored differently for a CPO vs a CMO. *(Validated against agent-design
   research: persistent role identity + reusable skills specialized per role.)*
   Schema: `skills.kind` (cornerstone|child) ✅ A.1; `skills.scope`
   (library|agent) + `skills.agent_id` (instance owner) + `parent_id` re-purposed
   as **instance→template lineage** (A.1b).
4. **One identity source = the cornerstone skill (CONFIRMED).** An agent's identity
   is its **cornerstone instance**; the runtime prompt is *derived* from cornerstone
   + tailored children. The parallel `agents.identity/mandate/principles/voice →
   system_prompt` composition is retired / rendered *from* the cornerstone, so there
   is one source and nothing to contradict. *(Executes in Phase C.)*
5. **The skill hierarchy and the fail-safe decision tree are one graph.** Two edge
   types on the same top-down tree: *composition* edges (`parent_id`: this child
   tailors that parent) and *fallback* edges (when unclear → ask_human / hand to
   another skill node / escalate / hold). The tree drives **AI-assisted setup**
   (grow an agent from its cornerstone down) and makes fail-safes legible. It is
   functional, not decorative.
6. **Fail-safes are evidence-first.** Self-reported model confidence is poorly
   calibrated; gate on independent-source corroboration (`theme_confidence`) +
   abstention, with the autonomy dial (`review_policies`) as ceiling and the
   fail-safe as floor. (Research: arXiv 2601.07767, 2510.20460, 2604.03904.)
7. **Relevance & tailoring reuse existing governed data — no new schema.**
   Agent↔child relevance = `skills.areas` ∩ `connections.area`; the tailor / AI-update
   is grounded in cornerstone + product record + the GTM record's personas/market;
   control = `apply_skill_evolution` / `skill_revisions` + the autonomy dial over
   C2-gated records. Skills live under Agents (IA), not as a top-level tab.
8. **Token budget is a first-class constraint.** Quality and cost are balanced, not
   traded. Levers, in order of preference: (a) prompt-cache stable prefixes — system
   AND the grounding block (multi-turn chats must not reprocess grounding); (b)
   thinking-effort tiering (high only for final drafts, medium for conversational
   turns); (c) model tiering (Opus for hard authoring, Sonnet/Haiku for light steps);
   (d) bounded grounding (fetch only what the task needs). `max_tokens` is a cap, not
   spend. Apply these as we touch each generator; never regress a working path for a
   speculative saving.

## Dependency-ordered phases
- **A. Skills substrate**
  - **A.1** `skills.kind` (cornerstone/child). ✅ *(20260613050000)*
  - **A.1b** `template → instance`: `skills.scope` (library|agent) + `skills.agent_id`
    (instance owner); re-purpose `parent_id` as instance→template lineage (drop the
    old cornerstone-no-parent check). Library view filters to `scope='library'`.
  - **A.2** Files I/O: export skill → `SKILL.md` ✅ (slice 1); import skill ←
    uploaded file (`import-skill` edge fn, AI-structured, HITL draft) + raw original
    kept in `documents` for provenance.
- **B. Tailoring + agent setup (skills live UNDER Agents)**
  - **B.1 IA:** the skills library is a **tab within Agents**, not a top-level nav
    item — skills are agent-scoped knowledge, so they live where agents live.
  - **B.2 Relevant skill picker:** creating/updating an agent opens a popup to attach
    skills; it shows only the **generic child templates relevant to that agent** —
    relevance = `skills.areas` ∩ the agent's connected areas (`connections.area`,
    normalized product(s)/gtm) + cornerstone role. Attaching mints a tailored
    instance (A.1b).
  - **B.3 Chat builder — contextual conversational flows over the generator** (HITL;
    each ends in an accept, nothing auto-applies). Mirrors `RecordRefine`/`refine-record`.
    Every flow surfaces a **controlled, evidence-backed recommendation set** — at most
    a few, each citing its source: **signals/themes**, the **product/GTM record**, a
    **frontier capability** (capability-domain signals), or the **skill quality bar**
    (best practice). "Controlled external" = the distilled quality bar (Anthropic-derived)
    + the capability signals already in the system — **no live web calls**.
    - **B.3a Tailor (= the grounded tailor) — SHIPPED.** `tailor-skill` edge fn +
      `SkillTailorChat`, launched from an agent's attached skill. Grounded in the
      cornerstone + product record + GTM market/personas + signals/themes/capabilities;
      proposes an editable body; Apply writes via `apply_skill_evolution` → `skill_revisions`.
    - **B.3b Create skill (template) — chat — SHIPPED.** `draft-skill` edge fn +
      `SkillCreateChat`, launched from the Skills library ("✦ Create with AI").
      Authors a generic library template (cornerstone or child) conversationally,
      grounded + exemplar-anchored + cited recommendations; accept inserts scope='library'.
    - **B.3c Create agent — chat — SHIPPED** (additive first step of Phase C).
      `draft-agent` edge fn + `AgentCreateChat`, launched from the Agents tab
      ("✦ Create with AI"). An agent IS its cornerstone: proposes name/role + the
      cornerstone identity, grounded + exemplar-anchored + roster-aware (clean
      handoffs); on accept inserts the agent (NO system_prompt — identity = the
      cornerstone) + a cornerstone instance + the attachment. Safe in today's runtime
      (a cornerstone agent without system_prompt already composes correctly).
  - **B.4 Top-down decision-tree view** (replaces the radial depiction); AI-assisted
    setup walks the tree. Real, company-grounded instance content replaces demo
    placeholders.
- **C. Agent rebuild — identity unified onto the cornerstone (decision #4). COMPLETE**
  (careful additive migration, no destructive big-bang):
  - **C2 Create-agent — SHIPPED** (B.3c): new agents stand up on the cornerstone model.
  - **C1 — SHIPPED**: runtime derives identity from the cornerstone (`agent-run/chat/
    propose`); when a cornerstone is attached it IS the identity and `system_prompt` is
    ignored (fallback only when none). Dual-identity contradiction removed.
  - **C3 — SHIPPED**: AgentDetail Overview is cornerstone-aware — when a cornerstone
    exists, identity points to the Skills tab and the 4-window editor is retired; the
    windows remain only as a fallback for an agent with no cornerstone (which nudges
    you to give it one).
  - **C4 — resolved by design**: the seed already attaches a cornerstone per agent, so
    C1 resolves seeded agents' identity to it (legacy `system_prompt` = ignored
    fallback). No data migration needed (and the roster is currently empty).
- **D. Stewardship (C3)** — a steward (agent/role) per field/section so non-steward
  proposals are flagged/routed; binds to the rebuilt agent model.
- **E. Fail-safes** — confidence-gated decision tree (the fallback edges on the
  Phase-B tree); evidence-first; runtime-enforced under the autonomy dial.
- **F. AI cost governance** — manage models / effort / token spend (decision #8).
  No chat; a Settings surface. Reuses the autonomy-dial pattern.
  - **F1 — SHIPPED**: `ai_usage` ledger + shared `logUsage` (one source of PRICING)
    wired into the generators; Settings "AI & token management" shows spend by task
    and model.
  - **F2** — the cost dial: governed cost-↔-quality **alignment**, not a budget cap.
    Per **task / agent / solution-area**, decide *which model* and *what effort* an AI
    action uses, so spend tracks the value of the work. Prescriptive in both directions:
    stop Opus/high being burned on a throwaway extraction, AND stop a customer-facing
    authoring task being starved into garbage. Three composable concepts:
    - **Tiers** (what the work *needs*) — every task is classified by stakes
      (`authoring | reasoning | conversational | extraction`). The tier carries the
      **quality floor**: the minimum (model, effort) below which output degrades. This
      is the prescriptive backbone. (Code: `_shared/ai_policy.ts → TASK_TIER`, `FLOORS`.)
    - **Presets** (how much to *spend*) — `quality | balanced | economy` map each tier
      to a (model, effort) via a guard-railed matrix; `custom` pins raw levers.
      `balanced` is the recommended default: holds high-stakes tiers at today's quality
      (opus/high) while economizing the cheap tiers. (`PRESET_MATRIX`.)
    - **Scopes** (where it *applies*) — one policy row per scope target; resolution is
      **most-specific-wins: task-pin > agent > area > org**. Absent ⇒ the caller's own
      current default (the non-regression guarantee).
    The **floor is clamped at resolve time** (`resolveModelPolicy`), so execution can
    never run below a tier's floor regardless of how a row was written — "quality can't
    silently drop," enforced at the single chokepoint. The dial UI shows each lever's
    **implication** (last-30-day `ai_usage` re-priced under the candidate; model swap is
    exact from `PRICING`, effort is directional) + a quality note.
    - **F2.0 — SHIPPED**: substrate, zero behavior change. `ai_policies` table
      (`20260614040000`; per-org, RLS, partial-unique per scope target, structural
      CHECKs; joins the `review_policies`/`ai_usage` cross-cutting family) +
      `_shared/ai_policy.ts` (tier map, preset matrix, floors, `resolveModelPolicy` with
      floor-default fallback) + `ai_policy.test.ts` (precedence, clamp, matrix≥floor
      invariant — all green). Nothing reads it yet.
    - **F2.1** — wire the chokepoint into all 26 generators in verifiable waves: replace
      the hardcoded `model`/`effort` with `resolveModelPolicy(..., { fallback: <today's
      values> })` (provably non-regressing) AND close the `logUsage` gap (5/26 → 26/26),
      since the implication preview is only honest if every call is measured. Each
      generator's `task` id is registered in `TASK_TIER`.
      - **Wave 1 — SHIPPED**: the four already-logging authoring/reasoning generators
        (`draft_agent`, `draft_skill`, `tailor_skill`, `evolve_draft`+`evolve_skills`)
        now resolve via the dial with today's values as the fallback floor; `logUsage`
        records the resolved model. Parse-verified.
      - **Waves 2-4 — TODO**: the remaining 21 generators, grouped by surface
        (authoring/battlecards/setup → reasoning/synthesis → conversational/connectors),
        each wiring the resolver AND adding the missing `logUsage` call.
    - **F2.2** — the Settings dial beside the autonomy dial: org preset + per-area /
      per-agent overrides + per-task pin, each with the implication preview. The UI
      surfaces floors (a lever at its floor is shown, not silently clamped).
    - **F2.3 (deferred)** — advanced levers per decision #8: `max_tokens` cap,
      grounding-depth, task-budget. Caching stays enforced-on (pure win, not a dial).
    Build E (and beyond) reading this dial.
    - *Open reconciliation:* `agents.model` (legacy free-text runtime field) vs the
      per-agent cost policy — F2.1/F2.2 decide whether agent-scope policy supersedes it.
- **G. The Ecosystem — coverage & harmony across the PLG lifecycle.** The cost dial (F2)
  governs *spend per scope*; it does not, on its own, stop a user from over-committing
  agents/focus/tokens to one area while a feeder stage starves — which breaks the
  **recursive** loop (product/GTM records + agents co-evolving: Build → Ship → Sense →
  Sell → Learn → back to Build). Phase G is the living surface that makes the *whole
  system's balance* legible and steerable: a breathing map of where attention and spend
  sit across the lifecycle, what's covered vs neglected, and where imbalance threatens
  the loop. Depends on F2.1 (full `ai_usage` measurement) + F2.2 (the dial) — you can't
  show balance you don't measure, or rebalance without a governed lever.
  - **G.0 — the model (no new UI).** Define the lifecycle-stage taxonomy + the **feeder
    graph** (which stage feeds which — the recursion edges), validated against
    `intelligence-map.md` / `compounding-intelligence.md` (don't invent a lifecycle —
    surface the one we already model). Map each `task`→stage (alongside its
    `TASK_TIER`) and each agent→area via `connections`. Ship a read-only **balance
    computation**: per (area × stage), derive `{ agent coverage, recent spend (ai_usage
    via agent→area + task→stage), aliveness (record-field freshness, signal/theme/outcome
    cadence, proposal/ratification recency), governance mode }`. Pure + tested, like the
    resolver.
  - **G.1 — health & harmony signals.** Classify each cell: `covered | thin | uncovered`,
    `starved | balanced | over-committed` (spend/attention share vs the loop's needs),
    `fresh | stale`. **Recursion-aware:** flag a *loop risk* when a feeder stage is
    starved/stale/uncovered while a downstream stage is over-invested — the specific
    failure the dial alone can't catch. Thresholds are guard-railed and explainable, not
    magic numbers.
  - **G.2 — the living surface.** A breathing ecosystem view (its own area of the app,
    not a Settings tab): the balance map, the cost dial woven in (adjust a scope and see
    coverage/harmony move), and loop-risk alerts. Reuses the implication-preview engine.
  - **G.3 — conversational rebalance (HITL, under the autonomy dial).** An agent that
    reads the imbalance and *proposes* reallocations — shift focus/agents/preset toward a
    starved feeder, cite the evidence — nothing auto-applies; mirrors the
    `RecordRefine`/chat-builder pattern and the `review_policies` graduated autonomy.
  - *Open decisions for G.0:* the exact stage taxonomy + feeder edges, and whether the
    grid is (area × stage) or area-first with stage as a lens. Settle before G.1.

## Control layer (done, underpins everything)
- **C1** conflict-aware `accept_proposal` (optimistic concurrency, race-safe). ✅
- **C2a/b** structural HITL write-gate on `record_fields.value` (UPDATE + INSERT). ✅
- **P2** org-leading composite indexes. ✅
- Deferred: **P1** (drop `signal_themes.signal_ids[]` dual-source — high-touch),
  **P3** (persist honest confidence vs recompute) — optimizations, not gaps.

## UI/UX backlog (phase in when the relevant surface is touched)
- **Expandable text fields** — a clean popup to expand small textareas across the
  app (record fields, skill body, etc.). Cross-cutting; apply per surface.
- **Top-down skill/decision tree** — see decision #5; lands in Phase B.
- **Conflicted re-review affordance** — a way to act on `conflicted` proposals
  beyond the History chip + inline notice.
