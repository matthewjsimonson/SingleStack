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

## Regenerate after editing

```
npm run build:skills      # parses web/skills/**/SKILL.md → web/lib/skills.generated.ts
```

`web/lib/skills.generated.ts` is auto-generated (do not hand-edit). `demoSeed` imports
it and upserts the rows into the org-scoped `skills` table on seed.
