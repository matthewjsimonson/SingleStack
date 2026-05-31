# Intelligence × Ship — the sense→decide→build→validate loop

Status: **proposed (building)** · Owner: SingleStack · Companion to
`multi-product-foundation.md`

This is one design, not two features. Intelligence and Ship are the two ends of
a single loop, and the product only works when intel visibly *steers* what gets
built — and what ships feeds intel back.

```
  Sense            Synthesize        DECIDE             Build               Validate
  sources → signals  signals → themes   themes → decisions   build items → ship   outcome → signal
  (provenance join)  (AI synthesis)     (the missing object) (deep work item)     (closes the loop)
```

Today the loop breaks in two places: there's **no decision object** (a theme's
`recommendation` dead-ends), and the **build item is flat** (`initiatives` =
title/description/kind/priority/stage). Fixing those two is this work.

## Principle: depth is structure + provenance + composition — not freetext

The Foundation already proved the pattern (`templates.ts` + `record_fields.section`
+ `SectionedFields`): a record is sectioned, the sections are *data*, AI fills
them, a human ratifies. Ship/Intelligence never inherited it. We generalize that
substrate. Depth comes from three places, never from a bigger text box:

1. **Structure** — typed sections per entity, configurable like a Foundation template.
2. **Provenance** — every claim links to source-of-truth (Foundation, signals, a decision). Nothing floats unsupported.
3. **Composition** — depth via relationships (a build item traces to a decision and a thesis; a decision cites themes; a theme cites signals).

## The human UX — what a person actually sees and does

This is **not** a prompt box with AI output. AI drafts *into a structure the human
owns*; the human's job is to shape, accept, reject, and ratify — fast.

### Ship — the build-item workspace (`/ship/[id]`)
Clicking a build item opens a **workspace**, not a modal with two fields. Layout:

- **Left: the structured body**, sectioned **Why / What / How / Proof**:
  - *Why* — hypothesis · the **decision/theme it traces to** (a real link back into Intelligence) · the thesis it advances · cited signals (chips)
  - *What* — jobs-to-be-done · scope (in/out) · acceptance criteria · modules/features touched
  - *How* — dependencies · technical approach · risks & unknowns · effort/confidence · prototype URL (AI vibecoding)
  - *Proof* — **success metric = the prediction to validate** · test plan · rollout · validation result
  Each field renders like `SectionedFields`: filled fields show; recommended-but-empty
  live in a quiet "+N recommended" affordance — **the page shows substance, never a wall of empty inputs.**
- **Right rail: the pipeline + the AI/human loop.**
  - The stage rail `Spec → Prototype → Build → Test → Shipped → Validated` with
    **gates**: a stage won't advance while its required fields are empty (e.g.
    can't leave *Spec* without acceptance criteria + a success metric). The gate is
    shown as a checklist, so the human always knows *why* it's blocked.
  - **Proposals inline**: when AI drafts a field (acceptance criteria from the
    hypothesis + cited signals; a success metric; a risk it spotted), it appears as
    a **pending proposal chip on that field** — accept ✓ / edit / reject ✗ — never
    silently written. Reuses `proposals`/`proposal_changes`/`ratifications`.
  - A per-item **activity/ratification trail** (who drafted, who ratified, when).

The feel: a human moves an item through gates; AI keeps the structure filled and
flags what's missing or stale; the human ratifies. Keyboard-first accept/reject.

### Intelligence — from situation room to **decision** engine
Signals (the situation room) stay. We add the layer where intel becomes action:

- **Theme detail** deepens beyond summary+recommendation: the pattern · weighted
  evidence (which signals, how strongly) · implications split **Product vs GTM** ·
  **momentum** (accelerating/fading) · **horizon** (now/next/future).
- **Decision** (new) — the unit a human acts on. A card/workspace with: the bet
  or question · **options with tradeoffs** (AI-drafted, human-editable) · evidence
  cited (themes/signals) · projected impact · the call + owner · and **routing**:
  a ratified decision *spawns* the right downstream object — a **Ship build item**
  (pre-filled Why = this decision + cited signals), a Foundation change (existing
  `proposals`), or a content/positioning move. The human picks an option and
  ratifies; the routing is one click, fully traced.
- **Theses** (extends `tracking_topics`) — long-horizon, falsifiable predictions
  the org is steering toward. Signals accrue for/against over time; AI flags
  supporting/contradicting evidence; theses spawn the build bets meant to make
  that future arrive. This is the "predict & steer," not "address needs," layer.

## The How is AI-owned and capability-aware (the key refinement)

Why/What are human intent; Proof is human-defined success. **How is the AI's
domain** — because the optimal way to build something changes faster than any
human tracks (a coding capability shipped this week can collapse a two-week
build into an afternoon). So How is not a box filled once; it's **AI-authored,
capability-grounded, and re-derivable**.

Honest constraint: the model has a training cutoff, so "this week's" capability
must be **ingested as data**, not assumed. Currency comes from ingestion + the
model reasoning over it — configurable beyond the prompt:

- **Capability knowledge base** — ingest changelogs / release notes / docs
  (Anthropic model + coding updates, frameworks, the org's own code patterns) as
  `sources` → `rag_documents` / `document_chunks`. A `tracking_topic`
  (e.g. *"AI coding capabilities"*) keeps it fed. Capability releases are just
  another **signal stream** — external technical intel about what's now buildable.
- **Build-architect agent** — given a build item's *What* + the product tech
  foundation + retrieval over the capability KB, it drafts approach /
  dependencies / risks / effort **as proposals**, and **cites the capability it
  leans on** ("uses Claude's new X to do Y") so the human sees the basis.
- **Re-steering on change** — a new capability signal lands → the agent
  re-checks affected build items and proposes a better How; the old How is
  **flagged stale, never silently overwritten**.

This closes the loop: capability signals → re-derived How → possibly a new build
approach, all through the same sense→decide→build engine.

## Configurability — the agent-workflow analogy, made real
The *structure itself* is data, not hardcoded: a build item's sections, a
decision's required evidence, the pipeline's gates are **templates an org edits**
(like `templates.ts` for Foundation). AI operates *inside* the configured
structure. You configure the substrate the AI and humans share — beyond a prompt.

## Data model (additive, reversible — matches house rules)

- **`initiative_fields`** — mirrors `record_fields` (org_id, initiative_id,
  section, field_key, label, value, position) so a build item gets sectioned,
  AI-draftable, ratifiable depth with the existing UI pattern. (Later, `record_fields`
  + `initiative_fields` may unify into a generic `entity_fields`; additive now.)
- **`decisions`** — id, org, scope (product/gtm/org), title (the bet), question,
  chosen_option, status (open/decided/routed), conf, owner; **`decision_options`**
  (option text + tradeoffs + recommended flag); **`decision_evidence`** (FK to
  themes/signals). A decision can spawn an initiative (`initiatives.decision_id`)
  or a proposal.
- **`signal_themes`** gains `implications` (jsonb: product/gtm), `momentum`,
  `horizon`. **`tracking_topics`** gains `kind='thesis'` + `horizon` + a
  signal-tally view; **`thesis_signals`** join for for/against evidence.
- Build-item **gates**: required `field_key`s per `build_stage`, defined as
  template data (configurable), enforced in the workspace UI + a DB check later.

Every AI write is a `proposal` a human ratifies; aggregate ratification stats stay
computed from `ratifications`, never stored.

## Build sequence (slices — each shippable to dev, single-product-safe)

1. **Build-item substrate + workspace** — `initiative_fields` (migration), a
   `BUILD_ITEM_TEMPLATE` (Why/What/How/Proof), the `/ship/[id]` workspace with
   sectioned fields + the gated pipeline rail. *Human depth first; no AI yet.*
2. **Capability-aware How (AI-owned) + inline proposals** — a capability KB
   (ingest changelogs/docs as sources→RAG) and a **build-architect agent** that
   drafts the How section as proposals, citing the capability used; accept/edit/
   reject + ratification trail on the workspace. Re-steers when capabilities change.
3. **AI on the rest of the build item** — agent drafts Why/What/Proof fields as
   inline proposals (acceptance criteria from hypothesis+signals, success metric).
4. **Decisions** — `decisions`/`options`/`evidence`, theme→decision, decision→
   build-item routing (pre-fills Why). Intelligence visibly steers Ship.
5. **Theses & validation** — theses layer; build-item `Validated` gate emits an
   outcome signal; the loop closes.

Slice 1 starts now.
