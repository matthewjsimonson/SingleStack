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
      { key: "category", label: "Category", placeholder: "The market category it competes in." },
      { key: "strategic_intent", label: "Strategic intent", placeholder: "The bet — where this product takes the company." },
      { key: "vision", label: "Vision", placeholder: "The 2–3 year north star for the product." },
    ],
  },
  // Note: market-facing fields (positioning, differentiation, ICP, pricing) live
  // on the GTM record — single home per field, no cross-record drift. The product
  // record stays the truth of what the product IS; GTM owns how it's sold.
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
      { key: "tech_debt", label: "Known constraints & debt", placeholder: "Where the implementation is aging or constrained — the honest debt list." },
      { key: "evolution_watch", label: "Evolution watchlist", placeholder: "Technologies & capabilities that could upgrade or obsolete parts of the stack — what to watch and re-evaluate." },
    ],
  },
  // Note: market-facing PROOF (metrics, reference customers, outcomes) lives on
  // the GTM record — it's how the product is proven TO THE MARKET, not what it is.
  // Per-ship product validation lives on Build items' "Proof" section.
];

// ---- GTM RECORD: how the product goes to market ----------------------------
// The GTM record is GO-TO-MARKET STRATEGY & OPERATIONS — how we go to market:
// who we serve, the motion, the tools & frontier-model leverage, the processes
// and handoffs, the execution strategy, and pricing. It is NOT the messaging.
//
// Positioning, strategic narrative, value prop, pillars, persona messaging, tone,
// proof, and the elevator pitch live in the MESSAGING FRAMEWORK (the Messaging
// tab — gtm_tabs / lib/messagingFramework.ts), the upstream source of truth that
// content & campaigns derive from. The two are split by UPDATE TRIGGER: you SWEEP
// the GTM record as new tools/strategies/functionality land; you BUILD the
// messaging framework as signals (win/loss, market, competitive) and product
// updates come in. The audience (ICP, industries, personas) is defined ONCE here
// and the framework REFERENCES it — not duplicated.
export const GTM_TEMPLATE: TemplateSection[] = [
  {
    section: "Audience",
    blurb: "Who we serve — the foundation the messaging framework references (defined once, here). Add a field per persona with '+ Field'.",
    fields: [
      { key: "icp", label: "Ideal customer profile", placeholder: "The accounts this is built for — and how to qualify them." },
      { key: "industries", label: "Industries / verticals", placeholder: "The verticals you serve — key to who you actually compete with." },
      { key: "primary_persona", label: "Primary persona", placeholder: "The main person you serve: role, goals, pains. Add more personas with '+ Field' (economic buyer, end user, …)." },
    ],
  },
  {
    section: "Motion",
    blurb: "How you go to market and how you price.",
    fields: [
      { key: "gtm_motion", label: "GTM motion", placeholder: "How you go to market — the motion (self-serve, product-led, sales-assisted, partner-led), the channels you reach buyers through, and where this sits in the loop." },
      { key: "pricing_model", label: "Pricing & packaging", placeholder: "How it's packaged and priced — and how that shapes the motion." },
    ],
  },
  {
    section: "Operating model",
    blurb: "The tools, processes, and execution that run go-to-market — updated as new functionality, strategies, and tools become available.",
    fields: [
      { key: "gtm_tools", label: "Tools & frontier-model leverage", placeholder: "The tools and frontier models you use to run GTM — what each does and where it fits in the work." },
      { key: "gtm_workflows", label: "Processes & handoffs", placeholder: "The operating cadence and handoffs — how work moves between people, agents, and tools from idea to launch to measurement." },
      { key: "execution_strategy", label: "Execution strategy", placeholder: "How you actually run GTM — the plays, the channel/campaign strategy, and how execution is prioritized and sequenced." },
    ],
  },
];

// ---- BUILD ITEM: the Product Scope of an initiative ------------------------
// Why / What / How / Proof — the spec a Build Item is built from. Lives in
// initiative_fields (parallel to record_fields). Sections are data, so AI can
// draft fields as proposals and humans ratify them field-by-field, exactly like
// records. One template serves all Build Item types (Fix/Enhancement/Feature/
// Module) today; type-specific defaults can layer on later.
export const BUILD_TEMPLATE: TemplateSection[] = [
  {
    section: "Why",
    blurb: "The case for building this — the problem, the evidence, who it's for.",
    fields: [
      { key: "problem", label: "Problem / opportunity", placeholder: "The core problem or opportunity, and why it matters now." },
      { key: "who_for", label: "Who it's for", placeholder: "The users or segment this serves." },
      { key: "evidence", label: "Evidence", placeholder: "Signals, data, or requests that back this — what makes it real, not a hunch." },
    ],
  },
  {
    section: "What",
    blurb: "The scope — what ships, what doesn't, and how we'll know it's done.",
    fields: [
      { key: "summary", label: "Summary", placeholder: "What we're building, in a sentence or two." },
      { key: "in_scope", label: "In scope", placeholder: "What this explicitly includes." },
      { key: "out_of_scope", label: "Out of scope", placeholder: "What this explicitly does not cover — the line that keeps it shippable." },
      { key: "acceptance_criteria", label: "Acceptance criteria", placeholder: "The conditions that must be true to call this done. Write them prompt-ready — an agent or engineer should act on them directly." },
    ],
  },
  {
    section: "How",
    blurb: "The approach — how we'll build it, what it leans on, what could go wrong.",
    fields: [
      { key: "approach", label: "Approach", placeholder: "The intended technical approach, at a high level." },
      { key: "dependencies", label: "Dependencies", placeholder: "What this relies on — other work, systems, or teams." },
      { key: "risks", label: "Risks", placeholder: "What could derail this, and how we'd mitigate it." },
    ],
  },
  {
    section: "Proof",
    blurb: "Validation — how we'll know it worked once it's live.",
    fields: [
      { key: "success_metric", label: "Success metric", placeholder: "The measurable outcome that proves this worked." },
      { key: "validation", label: "Validation plan", placeholder: "How we'll confirm the outcome after launch." },
    ],
  },
];

// ---- MODULE: how one module actually works ---------------------------------
// The product Technical section describes the whole product; this is the same
// lens at the MODULE grain — how this specific module is built and where it's
// aging. Lives in record_fields under module_id (the third parent). Pairs with
// the module's open signals (technical shifts that affect it) to flag drift.
export const MODULE_TEMPLATE: TemplateSection[] = [
  {
    section: "Technical",
    blurb: "How this module works and what it's built on — kept honest against its signals and build.",
    fields: [
      { key: "how_it_works", label: "How it works", placeholder: "What this module does under the hood — the mechanism, not the marketing." },
      { key: "built_on", label: "Built on", placeholder: "Core technologies, models, services, and libraries this module depends on." },
      { key: "dependencies", label: "Key dependencies", placeholder: "Internal modules and external systems this leans on." },
      { key: "debt_notes", label: "Debt & refactor notes", placeholder: "Where this module is aging or fragile, and what a refactor would address." },
      { key: "evolution_watch", label: "Evolution watchlist", placeholder: "New tech/capabilities that could replace or upgrade how this module works." },
    ],
  },
];

export function templateFor(kind: "product" | "gtm" | "build" | "module") {
  if (kind === "build") return BUILD_TEMPLATE;
  if (kind === "module") return MODULE_TEMPLATE;
  return kind === "product" ? PRODUCT_TEMPLATE : GTM_TEMPLATE;
}
