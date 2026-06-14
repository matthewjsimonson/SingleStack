# Agent Orchestration & the Governed Knowledge Layer

Status: **proposed (architecture)** · Owner: SingleStack · Builds on
`plg-ecosystem.md` (the coverage taxonomy) and governs how the Ecosystem becomes
a *legible, prescriptive, actionable* orchestration surface — the true
agent-orchestration layer. Answers to `singlestack-schema` (data model) and
`singlestack-ui` (surface).

## Why this exists

The Ecosystem coverage map is only as good as the layer underneath it. Today that
layer is **ungoverned**, and it shows:

- **The area vocabulary is scattered and drifting.** `AREA_KEYS` is a hardcoded
  array in `web/app/agents/[id]/AgentDetail.tsx`; `connections.area` is free text;
  `skills.areas` is loose `jsonb`; `web/lib/ecosystem.ts` carries its own
  `connAreas`. There is already literal drift (`"product"` vs `"products"`). Nothing
  is the source of truth, so nothing can be cohesive.
- **Workflows can't express what the engine already does.** `run-workflow` runs an
  ordered chain of steps — each step *one agent applying one skill* — so multi-agent,
  **cross-circle** orchestration is already latent. But the steps live in
  `workflows.steps jsonb` and the workflow is pinned to a single
  `target_type (product|gtm|none)`. A workflow's real **footprint** (which areas its
  steps touch) can't be queried, so coverage can't credit it correctly and the map
  can't draw it.

Cohesion is the whole game in orchestration. So the fix is structural, not cosmetic:
**make areas a governed *orchestration vocabulary*, and make a workflow's footprint a
queryable fact derived from real step rows.** Then the surface can be prescriptive.

## What already exists — areas are a lens, not a new knowledge layer

The product **already has a governed knowledge layer**, and it is well-built. Areas do
not replace it; they sit over it as the orchestration lens.

```
product_records / gtm_records                         the hubs
  └─ record_fields (field_key, label, value, section) the content — FIELD-LEVEL
       ├─ proposals → proposal_changes  (target a record_field)   proposed change
       ├─ ratifications / field_revisions (approve + version)     trust + audit
       └─ sources                                                 provenance
  └─ signals (evidence; today: gtm_record only)
```

This layer is **deliberately domain-agnostic**: `record_fields.section` is *free text*
("section names are data, not a fixed enum"), fields are client-defined, no migration
to add them. We honor that. So:

- **The record stays domain-agnostic.** Areas never replace `record_fields.section`.
  Each area instead **declares the section(s) it maintains** — a governed bridge
  (`area_sections`), reconciled to real section values. That is the only coupling
  between the opinionated PLG operating-model and the client-configurable content.
- **Orchestration unifies on areas** — `connections.area_id`, `skill_areas`,
  `workflow_steps.area_id`. Who-does-what is exactly where a governed vocabulary
  belongs (and replaces the loose free-text `connections.area`).
- **Proposals + ratifications stay field-level** and are *attributed* to an area via
  the field's section. Coverage then reads: "for this area — are its sections
  maintained, its proposals worked, its signals ingested, and by which agent/skill/
  workflow?" Cohesion by attribution, not a parallel vocabulary.
- **Signals become bi-circle.** Today `signals.gtm_record_id` is `not null` (GTM-only).
  We extend signals to product (nullable `product_record_id` + the one-parent CHECK
  that `record_fields`/`proposals` already use) and add an optional `area_id` tag, so
  the build circle has a first-class evidence substrate uniform with GTM.

So the accurate name for this work is the **governed orchestration vocabulary**: the
lens that lets agents, skills, workflows, proposals, and signals all be reasoned about
through one set of areas — *over* the knowledge layer that already governs the content.

## The architecture, in one picture

```
            THE GOVERNED KNOWLEDGE LAYER (one vocabulary)
                          areas  ──<  area_tasks
                            ▲              ▲
        ┌───────────────────┼──────────────┼────────────────────┐
   connections.area_id   skill_areas   workflow_steps.area_id   signals.area_id
     (agent ↔ area)     (skill ↔ area)   (step ↔ area/task)     (signal ↔ area)
        │                   │                  │                    │
        └─────────── everything speaks `areas` ────────────────────┘

   COVERAGE = for each (area, task): is there an agent · cornerstone ·
              child-skill · workflow-step that serves it?  → covered/partial/gap
   FOOTPRINT(workflow) = DISTINCT area over its workflow_steps
              → product-only · gtm-only · CROSS-CIRCLE (spans both)
   PRESCRIPTION = the specific missing piece + the action that closes it (HITL)
```

## 1) The governed orchestration vocabulary — `areas` + `area_tasks` (the lens)

The PLG taxonomy (`plg-ecosystem.md`) stops being hardcoded TypeScript and becomes
**data** — a lookup table, per schema §7 (display names, ordering, metadata). It is the
*orchestration* spine (who-does-what), bound to the content layer via `area_sections`
— not a second copy of the record's structure.

```
areas                         -- the canonical PLG areas (the vocabulary)
  id, org_id, created_at, updated_at, created_by, updated_by   -- the six-col spine
  key            text        -- stable, e.g. 'build_ship'  (unique per org)
  label          text
  circle         area_circle -- enum: product | gtm
  record_section text        -- the record section it maintains (e.g. 'Capabilities')
  flywheel_stage text        -- GTM stage it drives (nullable)
  blurb          text
  is_engine      boolean      -- the Build engine (execution)
  position       int          -- explicit ordering (§12: no implicit order)
  unique (org_id, key)

area_tasks                    -- the unit a workflow step covers (promoted per §4)
  …spine…
  area_id        uuid  references areas(id) on delete cascade
  key            text
  label          text
  position       int
  unique (org_id, area_id, key)
```

Then the existing loose references become **real FKs** (§1.5), so the vocabulary is
enforced, not hoped-for:

- `connections.area_id → areas(id)` (replacing the free-text `connections.area`).
- `skill_areas (skill_id, area_id)` — a join table replacing `skills.areas jsonb`
  (§8: jsonb is not for relationships; §4: it's queried independently — "which child
  skills serve this area?").
- `area_sections (area_id, section)` — the bridge to the content layer: which
  `record_fields.section`(s) each area maintains (1-to-many; reconciled to real values).
- `signals`: add nullable `product_record_id` + the one-parent CHECK (make it bi-circle)
  and an optional `area_id` tag, so signals are attributable to the area they feed.

> **Reconciliation note (load-bearing):** this migration must resolve the existing
> `"product"`/`"products"` drift to one canonical key set as it backfills. That is the
> point — one vocabulary, enforced by FK from here on.

## 2) The orchestration model — promote `workflow_steps`

Steps come out of `jsonb` and become real rows, because a step **references multiple
artifacts** (agent, skill, area) and the set **must be queried** to compute footprint
and draw arcs (§4.2, §4.5; §8 forbids jsonb-as-relationship).

```
workflow_steps
  …spine…
  workflow_id  uuid  references workflows(id) on delete cascade
  position     int                                   -- ordered chain (§12)
  agent_id     uuid  references agents(id)  on delete restrict
  skill_id     uuid  references skills(id)  on delete set null
  area_id      uuid  references areas(id)   on delete restrict   -- what it serves
  task_id      uuid  references area_tasks(id) on delete set null -- finer grain
  signals      workflow_signal_kind  -- enum: none | internal | external | both
  instruction  text
  unique (workflow_id, position)
```

This unlocks the three workflow shapes from one model:

- **Product-only** — every step's `area.circle = product` (e.g. *Ship from signal*:
  synthesize → decide → draft How → validate).
- **GTM-only** — every step's `area.circle = gtm` (e.g. *Competitive refresh*).
- **Cross-circle PLG** — steps span both (e.g. *Launch a capability*: CPO capability
  → CRO positioning → CCO content + enablement). **The differentiator**, and now a
  queryable fact: `FOOTPRINT spans product ∧ gtm`.

`run-workflow` and `orchestrate-roster` change from reading `wf.steps` to reading
`workflow_steps` (ordered by `position`) — behavior identical, provenance better.
`workflows.target_type` is retained only as an *optional runtime focus* (a record to
aim a run at), never as the coverage binding.

## 3) Prescriptive coverage — the orchestration intelligence

With the governed layer, coverage is no longer a yes/no badge — it **prescribes**.
For each `(area, task)` it computes the missing piece *and* the action that closes it:

| Missing | Prescription (the HITL action) |
|---|---|
| no agent on the area | **Assign an agent** (connect an existing officer) or **draft one** |
| agent, no cornerstone | **Give it a cornerstone** (its identity) |
| no child-skill for the task | **Attach/tailor the matching skill** (e.g. `draft_decision`) to the area's agent |
| no workflow-step touches the task | **Add a step** to an existing workflow, or **place a new workflow** (incl. cross-circle) |

Prescriptions are **specific** ("attach `draft_decision` to the CPO, or add it as a
step to *Ship from signal*"), because the knowledge layer knows the agents on the
area, the skills tagged to it, and the workflows whose steps already pass through it.
This is the orchestration level: the system tells you what your agent workforce is
missing, and lets you act on it in one place.

## 4) The living Ecosystem surface (HITL UX)

Per `singlestack-ui`: a workbench, calm density, **state color is load-bearing**
(covered = `--state-done` green, partial = `--state-working` amber, gap =
`--state-blocked` red), provenance visible, status always answerable, interruptible.

- **A breathing radial map.** Two **record hearts** at center — Product and GTM —
  each its circle's hub. Area **nodes** orbit their heart, colored by coverage. Subtle
  breathing/pulse (§6, ≤320ms, 60fps; respects `prefers-reduced-motion`). This is the
  "living, breathing" read the operator asked for — gaps are *seen*, not listed.
- **Workflows are the connective tissue.** Each workflow draws as a path through the
  nodes its steps touch — **intra-circle spokes** and, for PLG workflows, **cross-circle
  arcs spanning Product↔GTM**. The orchestration is literally visible.
- **Gaps are vectors you click.** A gap node / broken vector opens a **right-rail
  action panel** (not a reasoning modal — §4/§8) showing: the area's tasks, the four
  checks, the **prescription**, and the **inline HITL actions** — assign agent, attach/
  tailor skill, place/extend a workflow (build a step-chain across areas, including
  cross-circle). Every action is human-initiated and ratified; nothing auto-applies.
- **Reuse, don't re-skin.** The panel reuses the shipped agent-create, skill-tailor,
  and workflow builders (Phases B/C) rather than duplicating them.

## 5) Cohesion principle

`areas` is the spine. Records, signals, skills, connections, **workflow steps**, and
coverage all speak it. One source of truth means: rename an area once and the whole
graph follows; a child skill tagged to an area is *the same area* a workflow step
serves and *the same area* an agent connects to. Cohesion is the property that makes
orchestration trustworthy.

## Build sequence (phased, no shortcuts)

1. **P1 — knowledge layer (additive, safe).** Create `areas` + `area_tasks` (enum
   `area_circle`), seed the PLG taxonomy from `plg-ecosystem.md`. RLS in-migration.
2. **P2 — bind orchestration to areas (reconcile + backfill).** `skill_areas` join;
   `connections.area_id` (reconcile the free-text `area`, incl. `"product"/"products"`);
   `area_sections` bridge; extend `signals` to product (`product_record_id` + one-parent
   CHECK + optional `area_id`); wire `seed_plg_areas` into org bootstrap + backfill
   existing orgs. The careful one — reshapes shipped tables; its own migration set +
   verify. **Pause here to run through the deploy pipeline before P3+.**
3. **P3 — orchestration model.** `workflow_steps` (+ enum); backfill from
   `workflows.steps jsonb`; repoint `run-workflow` + `orchestrate-roster`; keep a
   compatibility read until cut over.
4. **P4 — prescriptive coverage lib.** `web/lib/ecosystem.ts` reads the governed
   layer; footprint-from-steps; prescriptions. Extend `verify-ecosystem.mjs`.
5. **P5 — the living surface.** Radial breathing map + workflow arcs + right-rail
   action panel.
6. **P6 — seed good workflows.** Product-only, GTM-only, and cross-circle PLG
   exemplars, so the map shows real arcs on day one.

Each phase ships behind the prior one; the surface (P5) only renders facts the model
(P1–P4) can prove.
