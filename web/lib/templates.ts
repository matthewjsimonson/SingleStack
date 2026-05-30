// Record templates: the structured, prescriptive starting point for each record
// type. Sections + fields are data (stored on record_fields.section/.label), so
// the model stays agnostic — templates are a rich default, fully editable, and
// any record can adopt sections it's missing (see SectionedFields).

export type TemplateField = { key: string; label: string; placeholder?: string };
export type TemplateSection = { section: string; blurb: string; fields: TemplateField[] };

// ---- PRODUCT RECORD: the canonical truth of the product --------------------
export const PRODUCT_TEMPLATE: TemplateSection[] = [
  {
    section: "Overview",
    blurb: "The high-level truth — what it is, who it's for, and the bet behind it.",
    fields: [
      { key: "what_it_is", label: "What it is", placeholder: "A clear one-paragraph description of the product." },
      { key: "who_its_for", label: "Who it's for", placeholder: "Primary users and buyers, and the context they're in." },
      { key: "problem", label: "Problem it solves", placeholder: "The core problem and why it matters now." },
      { key: "strategic_intent", label: "Strategic intent", placeholder: "The bet — where this product takes the company." },
      { key: "vision", label: "Vision", placeholder: "The 2–3 year north star for the product." },
    ],
  },
  {
    section: "Market & positioning",
    blurb: "Where it sits in the market and how it wins.",
    fields: [
      { key: "category", label: "Category", placeholder: "The market category it competes in." },
      { key: "positioning", label: "Positioning", placeholder: "How it's positioned vs. alternatives." },
      { key: "differentiation", label: "Differentiation", placeholder: "The defensible wedge — why it wins." },
      { key: "icp", label: "Ideal customer profile", placeholder: "The accounts this is built for." },
      { key: "pricing_model", label: "Pricing model", placeholder: "How it's packaged and priced." },
    ],
  },
  {
    section: "Capabilities",
    blurb: "What the product does — its modules and headline capabilities.",
    fields: [
      { key: "core_capabilities", label: "Core capabilities", placeholder: "The handful of things the product does best." },
      { key: "differentiated_capabilities", label: "Differentiated capabilities", placeholder: "Capabilities competitors can't easily match." },
      { key: "roadmap_themes", label: "Roadmap themes", placeholder: "Where capabilities are heading next." },
    ],
  },
  {
    section: "Technical",
    blurb: "How it's built and what it connects to.",
    fields: [
      { key: "architecture", label: "Architecture", placeholder: "High-level architecture and key components." },
      { key: "tech_stack", label: "Tech stack", placeholder: "Core technologies and infrastructure." },
      { key: "integrations", label: "Integrations", placeholder: "Systems and tools it integrates with." },
      { key: "data_model", label: "Data & AI", placeholder: "Key data, models, and how AI is used." },
      { key: "security", label: "Security & compliance", placeholder: "Security posture, certifications, data handling." },
      { key: "performance", label: "Performance & scale", placeholder: "Latency, throughput, reliability targets." },
    ],
  },
  {
    section: "Proof",
    blurb: "Evidence the product delivers.",
    fields: [
      { key: "key_metrics", label: "Key metrics", placeholder: "The numbers that prove value (adoption, outcomes)." },
      { key: "customers", label: "Reference customers", placeholder: "Named accounts and use cases." },
      { key: "outcomes", label: "Customer outcomes", placeholder: "Concrete results customers achieve." },
    ],
  },
];

// ---- GTM RECORD: how the product goes to market ----------------------------
export const GTM_TEMPLATE: TemplateSection[] = [
  {
    section: "Company narrative",
    blurb: "The story and worldview the offering sits inside.",
    fields: [
      { key: "narrative", label: "Narrative", placeholder: "The overarching story and worldview." },
      { key: "category_pov", label: "Category POV", placeholder: "Your point of view on where the category is going." },
      { key: "vision", label: "Vision", placeholder: "Where this is going and why it matters now." },
      { key: "differentiation", label: "Differentiation", placeholder: "What makes this defensibly different." },
    ],
  },
  {
    section: "Product messaging",
    blurb: "How the value is expressed to the market.",
    fields: [
      { key: "value_prop", label: "Value proposition", placeholder: "The core promise in one or two sentences." },
      { key: "pillars", label: "Message pillars", placeholder: "The 2–4 themes everything ladders up to." },
      { key: "proof_points", label: "Proof points", placeholder: "Evidence that backs the claims." },
      { key: "elevator_pitch", label: "Elevator pitch", placeholder: "The 30-second version." },
      { key: "tagline", label: "Tagline", placeholder: "The one-liner." },
    ],
  },
  {
    section: "Personas",
    blurb: "Who you're speaking to and what moves them.",
    fields: [
      { key: "primary_persona", label: "Primary persona", placeholder: "Role, goals, pains, what they care about." },
      { key: "economic_buyer", label: "Economic buyer", placeholder: "Who owns the budget and their priorities." },
      { key: "buying_committee", label: "Buying committee", placeholder: "Other roles involved in the decision." },
      { key: "objections", label: "Objections & answers", placeholder: "Common objections and how to handle them." },
    ],
  },
  {
    section: "Competitive",
    blurb: "How you stack up and where you win.",
    fields: [
      { key: "main_competitors", label: "Main competitors", placeholder: "Who you're most often up against." },
      { key: "win_themes", label: "Win themes", placeholder: "Why you win when you win." },
      { key: "loss_themes", label: "Loss themes", placeholder: "Why you lose when you lose — and the counter." },
      { key: "battlecard", label: "Battlecard summary", placeholder: "The head-to-head talk track." },
    ],
  },
  {
    section: "Channels & motion",
    blurb: "How it reaches and converts buyers.",
    fields: [
      { key: "gtm_motion", label: "GTM motion", placeholder: "PLG, sales-led, partner — the motion that fits." },
      { key: "channels", label: "Channels", placeholder: "Where you reach buyers." },
      { key: "campaigns", label: "Active campaigns", placeholder: "What's running now." },
    ],
  },
];

export function templateFor(kind: "product" | "gtm") {
  return kind === "product" ? PRODUCT_TEMPLATE : GTM_TEMPLATE;
}

// ---- BUILD ITEM (Ship initiative): Why / What / How / Proof ----------------
// A build item is not a title + description. It carries the reasoning to build
// from and the evidence that justifies it. Sections are data (stored on
// initiative_fields.section), so this is a rich default, fully editable, and
// AI-draftable field by field.
export const BUILD_ITEM_TEMPLATE: TemplateSection[] = [
  {
    section: "Why",
    blurb: "The reason this exists — the bet and the evidence behind it.",
    fields: [
      { key: "hypothesis", label: "Hypothesis", placeholder: "If we build this, then ___ — the bet in one sentence." },
      { key: "problem", label: "Problem / opportunity", placeholder: "The user/market problem, and why it matters now." },
      { key: "thesis", label: "Thesis it advances", placeholder: "The longer-horizon bet about where the product/market is going that this serves." },
      { key: "evidence", label: "Evidence", placeholder: "The signals/decision that justify this (cited as links, summarized here)." },
    ],
  },
  {
    section: "What",
    blurb: "The shape of the work — scoped and testable.",
    fields: [
      { key: "jtbd", label: "Jobs-to-be-done", placeholder: "What the user is trying to accomplish." },
      { key: "scope_in", label: "In scope", placeholder: "What this explicitly includes." },
      { key: "scope_out", label: "Out of scope", placeholder: "What this explicitly does NOT include (so it can ship)." },
      { key: "acceptance", label: "Acceptance criteria", placeholder: "Testable conditions that mean 'done'. One per line." },
      { key: "surfaces", label: "Modules / features touched", placeholder: "Where in the product this lands." },
    ],
  },
  {
    section: "How",
    blurb: "The plan to build it and what could go wrong.",
    fields: [
      { key: "approach", label: "Technical approach", placeholder: "High-level approach and key decisions." },
      { key: "dependencies", label: "Dependencies", placeholder: "Other items, teams, or systems this needs." },
      { key: "risks", label: "Risks & unknowns", placeholder: "What could derail this and what we're unsure about." },
      { key: "effort", label: "Effort / confidence", placeholder: "Rough size and how confident we are in it." },
    ],
  },
  {
    section: "Proof",
    blurb: "How we'll know it worked — the prediction to validate.",
    fields: [
      { key: "success_metric", label: "Success metric", placeholder: "The number this should move — the prediction we validate after shipping." },
      { key: "test_plan", label: "Test plan", placeholder: "How it's verified before ship (QA, eval, beta)." },
      { key: "rollout", label: "Rollout", placeholder: "Flag, phased %, or full — how it reaches users." },
      { key: "validation", label: "Validation result", placeholder: "After ship: did the metric move? Becomes a new signal." },
    ],
  },
];

// Pipeline gates: a build_stage can't be advanced past until these field_keys
// are filled. This is the "configurable workflow" — gates are data, enforced in
// the workspace UI. Keyed by the stage you are LEAVING.
export const BUILD_STAGE_GATES: Record<string, string[]> = {
  spec: ["hypothesis", "acceptance", "success_metric"],
  prototype: ["approach"],
  build: ["test_plan"],
  test: ["rollout"],
  shipped: ["validation"],
};
