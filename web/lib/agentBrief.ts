// The agent brief — the executable handoff for a Build Item, assembled from its
// Product Scope + acceptance criteria + build prompt + test approach + the
// context bundle. One definition, used by Ship and the cockpit.
import { BUILD_TEMPLATE } from "./templates";

const KIND_LABEL: Record<string, string> = { bugfix: "Fix", enhancement: "Enhancement", feature: "New Feature", module: "New Module", product: "Product" };
const ENTITY_LABEL: Record<string, string> = { product_records: "Product", gtm_records: "GTM record", modules: "Module", features: "Feature", sources: "Source", signals: "Signal", capabilities: "Capability" };

export type BriefLink = { kind: string; ref_table: string | null; path: string | null; label: string | null; note: string | null };

export function buildAgentBrief(opts: { title: string; kind: string | null; releaseLabel?: string | null; fields: Map<string, string>; links: BriefLink[] }): string {
  const { title, kind, releaseLabel, fields: fv, links: lk } = opts;
  const L: string[] = [];
  L.push(`# [${KIND_LABEL[kind ?? ""] ?? "Build Item"}] ${title}`);
  if (releaseLabel) L.push(`_Release: ${releaseLabel}_`);

  L.push(`\n## Product Scope`);
  for (const s of BUILD_TEMPLATE) {
    const present = s.fields.filter((f) => fv.get(f.key));
    if (!present.length) continue;
    L.push(`\n### ${s.section}`);
    for (const f of present) L.push(`**${f.label}**\n${fv.get(f.key)}\n`);
  }

  L.push(`\n## Technical Scope`);
  if (fv.get("build_prompt")) L.push(`**Build prompt**\n${fv.get("build_prompt")}\n`);
  if (fv.get("acceptance_criteria")) L.push(`**Acceptance criteria**\n${fv.get("acceptance_criteria")}\n`);
  if (fv.get("test_approach")) L.push(`**Test approach**\n${fv.get("test_approach")}\n`);

  const g = (k: string) => lk.filter((l) => l.kind === k);
  const files = g("file_path"), ents = g("entity_ref"), skills = g("skill_ref"), deltas = g("schema_delta");
  if (lk.length) {
    L.push(`\n## Context bundle`);
    if (files.length) { L.push(`\n### Files`); for (const f of files) L.push(`- \`${f.path}\`${f.note ? ` — ${f.note}` : ""}`); }
    if (ents.length) { L.push(`\n### Entities`); for (const e of ents) L.push(`- [${ENTITY_LABEL[e.ref_table ?? ""] ?? e.ref_table}] ${e.label ?? ""}${e.note ? ` — ${e.note}` : ""}`); }
    if (skills.length) { L.push(`\n### Skills`); for (const s of skills) L.push(`- ${s.path ?? s.label}${s.note ? ` — ${s.note}` : ""}`); }
    if (deltas.length) { L.push(`\n### Schema deltas`); for (const d of deltas) L.push(`- ${d.label ?? d.path ?? ""}${d.note ? ` — ${d.note}` : ""}`); }
  }
  return L.join("\n");
}

export { KIND_LABEL as BUILD_KIND_LABEL };
