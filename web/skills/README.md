# Skills — the built-in skill library (`SKILL.md`)

Each built-in skill is a folder with a **`SKILL.md`** file, in the Agent-Skill format:
YAML-ish frontmatter + a markdown body.

```
---
key: demo_positioning_sharpening      # stable id (matches the DB skills.key)
name: Positioning sharpening          # display name
category: product                     # product | gtm | research | general
description: One line — shown in context; this is what the agent sees by default.
agents: cpo                           # comma-separated officer keys to attach to (cpo, ceng, cco, cro)
---
The markdown body IS the skill's instructions (the playbook). The agent loads this
full body ON DEMAND via the read_skill tool — progressive disclosure. Only the name
+ description sit in context until then.
```

These files are the **canonical, version-controlled source of truth** for the built-in
skills. Per-org customizations still live in the `skills` table (editable in the app).

## Naming (non-negotiable — no marketing headlines)

The library holds two kinds of skill, and the name must say which:

- **Cornerstone = WHO THE AGENT IS.** A cornerstone is the generally-accepted
  **role profile** — the role and its responsibilities (an agent's identity).
  **Name it the role**: `Chief Product Officer`, `Chief Engineering Agent`,
  `Chief Revenue Officer`, `Chief Creative Officer`, `Chief of Staff`. The body is
  "you are the [role]; you own [responsibilities]; how you operate." `cornerstone: true`.
- **Child = FOR A SPECIFIC TASK.** A child is a trait / framework / "hat" a role
  puts on for one job. **Name it the task**: `Competitive battlecard`,
  `Architecture review`, `Roadmap prioritization`. The body is a task playbook.

**No marketing headlines.** Never name a skill with a slogan ("Buildable truth",
"Win the category", "One narrative"). The name is a label, not a tagline — the role
or the task, in plain words. A reader must be able to tell cornerstone-vs-child from
the name alone.

## Category (grouping — apply this logic consistently)

`category` is the skill's **primary domain**, and it must reflect what the skill
actually does — not which officer happens to hold it:

- **product** — building the product: strategy, roadmap, modules/features,
  architecture, engineering, technical accuracy, capabilities.
  *(Chief Product Officer, Chief Engineering Agent, Roadmap prioritization, Architecture review.)*
- **gtm** — going to market: positioning, messaging, personas, narrative,
  competitive battlecards/copy, pricing/packaging.
  *(Chief Revenue Officer, Chief Creative Officer, Positioning sharpening, Persona
  messaging, Competitive battlecard, Narrative & brand voice, Competitive messenger.)*
- **general** — applies to **both product and GTM**, specialized by **tailoring**
  per agent (the same skill informs product strategy for a CPO and GTM for a CRO),
  *or* a cross-cutting org/agent operation tied to neither domain alone.
  *(Capability evidence scoring, Competitive evidence analyst — competitive analysis
  serves both; Chief of Staff — roster ops.)*
- **research** — reserved for pure intelligence-gathering that is itself neither
  product nor GTM work (none built-in yet).

Tests: positioning is **gtm** even on a CPO (it's market-facing); architecture is
**product**, never general; **competitive analysis is `general`** — the product side
turns strengths/weaknesses into strategy, the GTM side turns them into battlecards,
and *tailoring* is what specializes the one skill for each; turning a ratified fact
into seller copy is **gtm** (Competitive messenger).

A `general` (both-domains) skill should set `areas` spanning `product` and `gtm` so
the agent picker offers it to officers on either side.

## Regenerate after editing

```
npm run build:skills      # parses web/skills/**/SKILL.md → web/lib/skills.generated.ts
```

`web/lib/skills.generated.ts` is auto-generated (do not hand-edit). `demoSeed` imports
it and upserts the rows into the org-scoped `skills` table on seed.
