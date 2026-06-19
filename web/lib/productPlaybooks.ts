// The PRODUCT playbook catalog — the heart of the product Tailor step. Each
// playbook is a downstream BUILD artifact TYPE (its `key` becomes
// initiative_workstreams.content_type, which is free text) plus an ordered
// `setup` (the step-by-step a human follows to produce it). Areas group playbooks
// into the four product/build disciplines. Mirrors gtmPlaybooks.ts in shape (no
// isVideo here — build work carries no Descript flow). Sourced from
// lib/playbooks.ts STANDARD_PLAYBOOKS (build_ship / technical / strategy /
// capabilities), read through a technical-PM-who-ships lens.
export type ProductPlaybookArea = "spec" | "prototype" | "technical" | "validation";
export type ProductPlaybook = { key: string; area: ProductPlaybookArea; name: string; purpose: string; setup: string[] };

export const PRODUCT_AREAS: { id: ProductPlaybookArea; label: string }[] = [
  { id: "spec", label: "Spec" }, { id: "prototype", label: "Prototype" },
  { id: "technical", label: "Technical" }, { id: "validation", label: "Validation" },
];

export const PRODUCT_PLAYBOOKS: ProductPlaybook[] = [
  // SPEC
  { key: "spec_driven", area: "spec", name: "Spec-driven build", purpose: "Constitution → specify → plan → tasks; the spec is the durable artifact.", setup: ["State the problem + success metric", "Specify the behavior + acceptance criteria", "Plan the approach + non-goals", "Decompose into tasks", "Note HITL review points"] },
  { key: "prd", area: "spec", name: "PRD", purpose: "A crisp product requirements doc a team can build from.", setup: ["Problem + who it's for", "Goals + non-goals", "Requirements + acceptance criteria", "Risks + open questions"] },
  // PROTOTYPE
  { key: "ai_prototype", area: "prototype", name: "AI prototype", purpose: "Idea → working artifact fast, to validate before heavy build.", setup: ["Frame the hypothesis", "Prompt-to-app the core flow", "Get feedback", "Decide build / iterate / kill"] },
  // TECHNICAL
  { key: "adr", area: "technical", name: "Architecture decision record", purpose: "Make an architecture decision explicit + supersedable.", setup: ["Context + forces", "Options considered", "Decision + consequences", "Supersede link if it replaces one"] },
  { key: "tech_debt", area: "technical", name: "Tech-debt triage", purpose: "Register + score debt so it's managed deliberately.", setup: ["Name the debt + where", "Score impact × probability", "Decide pay-now / schedule / accept", "Link the follow-up"] },
  { key: "constraints", area: "technical", name: "Stack & constraints", purpose: "Map the buildable truth + constraints agents must respect.", setup: ["Map the stack", "Author the constraints", "Note the non-negotiables"] },
  // VALIDATION
  { key: "post_launch", area: "validation", name: "Post-launch validation", purpose: "Experiment + eval against the success metric → new signals.", setup: ["Define the metric + guardrails", "Design the experiment/eval", "Read the result", "Decide + emit new signals"] },
];

// Maps a content_type value back to its playbook (and thus its area / setup).
export const PLAYBOOK_BY_KEY: Record<string, ProductPlaybook> = Object.fromEntries(PRODUCT_PLAYBOOKS.map((p) => [p.key, p]));

// Resolves an item's area from its content_type; unknown types fall back to "spec".
export function areaForContentType(contentType: string | null | undefined): ProductPlaybookArea {
  return (contentType && PLAYBOOK_BY_KEY[contentType]?.area) || "spec";
}
