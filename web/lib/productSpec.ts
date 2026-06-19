// Product-spec workbench helpers — the product-side mirror of lib/messaging.ts,
// read through a technical-PM-who-ships lens. The product Review surface takes a
// product SIGNAL-THEME (the input a PM triages) and molds it into a SPEC/PRD,
// GROUNDED in the product record (what the product is + its technical
// constraints). The product record is read-only CONTEXT the AI drafts FROM; it is
// never edited here. The spec lives in product_specs (one spec per theme).
import { fmtWhen, buildAudience, type Persona, type GroundingField } from "@/lib/messaging";

// Re-export the shared types so the product surface can import them from one place.
export type { Persona, GroundingField } from "@/lib/messaging";
export { fmtWhen, buildAudience } from "@/lib/messaging";

// A product signal-theme — the NEW input a PM molds a spec around.
export type ThemeRow = {
  id: string;
  title: string;
  summary: string | null;
  recommendation: string | null;
  conf_level: number | null;
  category: string | null;
  state: string | null;
  org_id: string;
};

// The most relevant PRODUCT record fields to ground a spec in. We pull a compact
// subset so the spec is written from what the product actually IS and its
// technical constraints, not invented — the technical-PM lens (Overview ·
// Strategy · Capabilities · Technical), all present in PRODUCT_TEMPLATE.
export const PRODUCT_GROUNDING_KEYS = [
  "what_it_is", "who_its_for", "problem",                       // Overview
  "strategic_intent",                                          // Strategy
  "core_capabilities", "differentiated_capabilities", "roadmap_themes", // Capabilities
  "architecture", "tech_stack", "tech_debt", "evolution_watch", // Technical
];

const fieldLine = (f: GroundingField): string | null => {
  const v = (f.value ?? "").trim();
  if (!v) return null;
  return `- ${f.label || f.field_key}: ${v}`;
};

// Assemble a compact GROUNDING string from the PRODUCT record fields. Fed to the
// officer (the conversation) and the context-sidebar agents as the durable truth
// — what the product is and its technical constraints — to mold the theme's spec
// against.
export function buildProductGrounding(productFields: GroundingField[]): string {
  const pick = (rows: GroundingField[], keys: string[]) =>
    keys.map((k) => rows.find((f) => f.field_key === k)).filter((f): f is GroundingField => !!f)
      .map(fieldLine).filter((l): l is string => !!l);
  const lines = pick(productFields, PRODUCT_GROUNDING_KEYS);
  return lines.length
    ? `PRODUCT RECORD (what it is · strategy · capabilities · technical):\n${lines.join("\n")}`
    : "No product-record fields captured yet — write the spec from the theme alone.";
}

// Describe the INPUT being specced (a product signal-theme) for the AI. This is
// the WHAT; buildProductGrounding() supplies the product truth it's molded against.
export function inputBrief(theme: ThemeRow): string {
  return [
    `PRODUCT SIGNAL-THEME: ${theme.title}`,
    theme.summary ? `Summary: ${theme.summary}` : "",
    theme.recommendation ? `Recommendation: ${theme.recommendation}` : "",
  ].filter(Boolean).join("\n");
}

// The full context string handed to the conversation: WHAT we're speccing (the
// theme) + the product truth it's GROUNDED in. Frames the conversation as "write
// the spec/PRD for this product theme, grounded in what the product is and its
// technical constraints." Mirrors buildDraftContext.
export function buildSpecContext(
  theme: ThemeRow,
  grounding: string,
  persona: Persona | null = null,
): string {
  const audience = buildAudience(persona);
  return [
    `WRITE THE SPEC / PRD FOR THIS PRODUCT THEME:`,
    inputBrief(theme),
    ``,
    `GROUNDED IN WHAT THE PRODUCT IS AND ITS TECHNICAL CONSTRAINTS (context — do not edit, write FROM it):`,
    grounding,
    ...(audience ? [``, audience] : []),
  ].join("\n");
}
