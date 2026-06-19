// Messaging workbench helpers — officer-key resolution + grounding assembly,
// kept out of the component so MessagingView stays about the surface, not the
// plumbing. Messaging is a PRODUCTION surface: it takes a NEW input (a release or
// a signal-theme) and molds a messaging brief for it, GROUNDED in the framework
// (the GTM record + product record). The framework is read-only context here.
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAgentKey } from "@/lib/strategy";

// The GTM officer that drafts messaging updates: prefer a narrative/revenue
// officer (cco = Chief Creative Officer, cro = Chief Revenue Officer), else fall
// back to any active agent. Returns the agent KEY (what agent-propose wants).
export async function fetchOfficerKey(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase.from("agents").select("key").eq("is_active", true);
  const rows = (data ?? []) as { key: string }[];
  const preferred = rows.find((a) => a.key === "cco") ?? rows.find((a) => a.key === "cro");
  if (preferred) return preferred.key;
  return fetchAgentKey(supabase); // cpo, else first active
}

// A signal-theme — a NEW input that needs messaging molded around it.
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

// A product release — the other NEW input that needs messaging.
export type ReleaseRow = {
  id: string;
  name: string;
  version: string | null;
  summary: string | null;
  stage: string | null;
  target_date: string | null;
  product_id: string | null;
  org_id: string;
};

// A framework field (from a GTM record OR a product record). These are read-only
// CONTEXT the AI drafts FROM — never edited on the messaging surface.
export type GroundingField = { field_key: string; label: string; value: string | null; section: string | null };

// A dynamic, customer-defined AUDIENCE the messaging is framed for. Selected at
// draft time; reusable across inputs/products. Feeds the grounding so drafts
// speak to this persona's goals, pains, and language.
export type Persona = {
  id: string;
  name: string;
  role?: string | null;
  industry?: string | null;
  description?: string | null;
};

// A compact audience block for the AI: who to frame the messaging for. Empty when
// no persona is chosen (generic), so the draft context stays unchanged.
export function buildAudience(persona: Persona | null): string {
  if (!persona) return "";
  const { name, role, industry, description } = persona;
  return (
    `Audience to frame for: ${name}${role ? `, ${role}` : ""}${industry ? ` (${industry})` : ""}.${description ? ` ${description}` : ""}\n` +
    `Write the messaging specifically for this persona — their goals, pains, and language.`
  );
}

// The most relevant framework fields to ground a messaging brief in. We pull a
// compact subset so the officer drafts from the org's actual positioning, value
// prop, buyer, and product facts rather than inventing them.
const GTM_GROUNDING_KEYS = [
  "category_pov", "positioning", "differentiation",   // Positioning
  "value_prop", "pillars",                            // Messaging
  "icp", "primary_persona",                           // Buyer
  "win_themes",                                       // Motion
];
const PRODUCT_GROUNDING_KEYS = [
  "what_it_is", "who_its_for", "problem",                       // Overview
  "core_capabilities", "differentiated_capabilities",          // Capabilities
];

const fieldLine = (f: GroundingField): string | null => {
  const v = (f.value ?? "").trim();
  if (!v) return null;
  return `- ${f.label || f.field_key}: ${v}`;
};

// Assemble a compact GROUNDING string from the GTM record + product record fields.
// Fed to the officer (Draft with AI) and the context-sidebar agents as the
// framework to mold the release/signal's messaging brief against.
export function buildGrounding(gtmFields: GroundingField[], productFields: GroundingField[]): string {
  const pick = (rows: GroundingField[], keys: string[]) =>
    keys.map((k) => rows.find((f) => f.field_key === k)).filter((f): f is GroundingField => !!f)
      .map(fieldLine).filter((l): l is string => !!l);
  const gtmLines = pick(gtmFields, GTM_GROUNDING_KEYS);
  const prodLines = pick(productFields, PRODUCT_GROUNDING_KEYS);
  const blocks: string[] = [];
  if (gtmLines.length) blocks.push(`GTM FRAMEWORK (positioning · messaging · buyer · motion):\n${gtmLines.join("\n")}`);
  if (prodLines.length) blocks.push(`PRODUCT RECORD (what it is · capabilities):\n${prodLines.join("\n")}`);
  return blocks.length ? blocks.join("\n\n") : "No framework fields captured yet — draft from the input alone.";
}

// Describe the INPUT being messaged (a release or a signal-theme) for the AI.
// This is the WHAT; buildGrounding() supplies the framework it's molded against.
export function inputBrief(input: { kind: "release"; row: ReleaseRow } | { kind: "theme"; row: ThemeRow }): string {
  if (input.kind === "release") {
    const r = input.row;
    return [
      `RELEASE: ${r.version ? `${r.version} ` : ""}${r.name}${r.stage ? ` (${r.stage})` : ""}`,
      r.summary ? `Summary: ${r.summary}` : "",
    ].filter(Boolean).join("\n");
  }
  const t = input.row;
  return [
    `SIGNAL-THEME: ${t.title}`,
    t.summary ? `Summary: ${t.summary}` : "",
    t.recommendation ? `Recommendation: ${t.recommendation}` : "",
  ].filter(Boolean).join("\n");
}

// The full context string handed to Draft-with-AI / the sidebar: WHAT we're
// messaging (the input) + the framework it's GROUNDED in.
export function buildDraftContext(
  input: { kind: "release"; row: ReleaseRow } | { kind: "theme"; row: ThemeRow },
  grounding: string,
  persona: Persona | null = null,
): string {
  const audience = buildAudience(persona);
  return [
    `MESSAGE THIS INPUT:`,
    inputBrief(input),
    ``,
    `GROUNDED IN THE FRAMEWORK (context — do not edit, draft FROM it):`,
    grounding,
    ...(audience ? [``, audience] : []),
  ].join("\n");
}

// Fmt a timestamp for a monospace Source chip ("Jun 12" / "Jun 12 '25").
export function fmtWhen(ts: string | null | undefined): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const base = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return sameYear ? base : `${base} '${String(d.getFullYear()).slice(2)}`;
}
