// profileBrief — compile signals-network nodes into the search steer the brain
// actually uses. This is the CLIENT MIRROR of connector-runner's profileSteer:
// the same shape the pull gets at run time, so the UI can show a user exactly
// what a node/vector tells the brain to look for — and editing the node
// visibly changes it.

export type BriefField = {
  field_key: string; label: string; value: string;
  vector?: string; weight?: number; parent_key?: string | null;
};

const W = (w?: number) => (w ?? 2) >= 3 ? "direct" : (w ?? 2) <= 1 ? "indirect" : "adjacent";

// One node's steer: its branch path, its statement, its sub-nodes, and the ask.
export function compileNodeBrief(fields: BriefField[], nodeKey: string): string {
  const vecOf = (f: BriefField) => f.vector ?? "core";
  const n = fields.find((f) => f.field_key === nodeKey);
  if (!n) return "";
  const siblings = fields.filter((f) => vecOf(f) === vecOf(n));
  const path: BriefField[] = [];
  const seen = new Set([n.field_key]);
  let cur: BriefField | undefined = n;
  while (cur?.parent_key) {
    const p = siblings.find((f) => f.field_key === cur!.parent_key);
    if (!p || seen.has(p.field_key)) break;
    path.unshift(p); seen.add(p.field_key); cur = p;
  }
  const kids = siblings.filter((f) => f.parent_key === n.field_key);
  return [
    `This pull feeds ONE node of the signals network (${vecOf(n)} focus).`,
    path.length ? `Branch: ${path.map((p) => p.label).join(" › ")} › ${n.label}` : "",
    `Node "${n.label}" (${W(n.weight)}): ${n.value}`,
    kids.length ? `Its sub-nodes: ${kids.map((k) => `${k.label} — ${k.value}`).join(" | ")}` : "",
    "Find signals that bear on this statement — evidence that confirms it, contradicts it, or moves it.",
  ].filter(Boolean).join("\n").slice(0, 1200);
}

// A whole vector's steer: every filled node, closest-to-core first.
export function compileVectorBrief(fields: BriefField[], vector: string): string {
  const nodes = fields
    .filter((f) => (f.vector ?? "core") === vector && f.value.trim())
    .sort((a, b) => (b.weight ?? 2) - (a.weight ?? 2));
  if (!nodes.length) return "";
  return [
    `This pull feeds the ${vector.toUpperCase()} focus of the signals network. Its current nodes, most direct first:`,
    ...nodes.slice(0, 14).map((f) => `- [${W(f.weight)}] ${f.label}: ${f.value}`),
    "Prioritize signals about the direct nodes; catch adjacent and indirect ones but don't chase them.",
  ].join("\n").slice(0, 1600);
}
