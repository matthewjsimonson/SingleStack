#!/usr/bin/env node
// ============================================================================
// build-skills — the built-in skills' SOURCE OF TRUTH is web/skills/<key>/SKILL.md
// (real Agent-Skill format: YAML-ish frontmatter + a markdown body). This script
// parses them and generates web/lib/skills.generated.ts, which the seeder imports
// and upserts into the org-scoped `skills` table. Per-org edits still live in the
// DB; the files are the canonical, version-controlled definitions.
//
//   Run: node scripts/build-skills.mjs   (re-run after editing any SKILL.md)
//
// Frontmatter keys: key, name, description, category, agents (comma-separated).
// Everything after the closing --- is the skill's instructions (markdown body).
// ============================================================================
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillsDir = join(root, "web", "skills");
const outFile = join(root, "web", "lib", "skills.generated.ts");

function parse(md) {
  const m = md.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) throw new Error("missing frontmatter");
  const fm = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { fm, body: m[2].trim() };
}

const defs = [];
for (const name of readdirSync(skillsDir).sort()) {
  const dir = join(skillsDir, name);
  if (!statSync(dir).isDirectory()) continue;
  const { fm, body } = parse(readFileSync(join(dir, "SKILL.md"), "utf8"));
  if (!fm.key) throw new Error(`${name}/SKILL.md: missing 'key'`);
  defs.push({
    key: fm.key,
    name: fm.name ?? fm.key,
    description: fm.description ?? "",
    category: fm.category ?? "general",
    instructions: body,
    agents: (fm.agents ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  });
}

const banner = "// AUTO-GENERATED from web/skills/**/SKILL.md by scripts/build-skills.mjs — do not edit by hand.\n";
const ts = banner +
  "export type SkillDef = { key: string; name: string; description: string; category: string; instructions: string; agents: string[] };\n" +
  "export const SKILL_DEFS: SkillDef[] = " + JSON.stringify(defs, null, 2) + ";\n";
writeFileSync(outFile, ts);
console.log(`Wrote ${defs.length} skills → web/lib/skills.generated.ts`);
