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
// 12 CORNERSTONE fields — the strategic INPUTS an AI needs to reason about GTM
// and drive the loop (signals → strategy → battlecards/content/enablement).
// Deliberately excludes:
//   • AI-generated OUTPUTS (tagline, elevator pitch, battlecard summary) — derived
//     from these inputs, not entered.
//   • Things that are their own ENTITIES with dedicated screens (competitors →
//     /competitive, campaigns → /campaigns) — not duplicated as record text.
//   • DUPLICATES (narrative ≈ category POV; vision lives on the product record).
//   • PROOF/metrics — now live, sourced metric fields, not static prose.
//   • loss_themes — better captured as win-loss SIGNALS in the living loop.
export const GTM_TEMPLATE: TemplateSection[] = [
  {
    section: "Positioning",
    blurb: "Where you sit and why you win — the strategic frame.",
    fields: [
      { key: "category_pov", label: "Category POV", placeholder: "Your point of view on where the category is going and why now." },
      { key: "positioning", label: "Positioning", placeholder: "How it's positioned vs. the alternatives a buyer is weighing." },
      { key: "differentiation", label: "Differentiation", placeholder: "The defensible wedge — why you win when you win." },
    ],
  },
  {
    section: "Messaging",
    blurb: "The core promise and the themes everything ladders to.",
    fields: [
      { key: "value_prop", label: "Value proposition", placeholder: "The core promise in one or two sentences." },
      { key: "pillars", label: "Message pillars", placeholder: "The 2–4 themes all messaging ladders up to." },
    ],
  },
  {
    section: "Buyer",
    blurb: "Who it's for and the people who decide. Add a field per persona — champion, economic buyer, user, etc.",
    fields: [
      { key: "icp", label: "Ideal customer profile", placeholder: "The accounts this is built for — and how to qualify them." },
      { key: "industries", label: "Industries / verticals", placeholder: "The verticals you serve — key to who you actually compete with." },
      { key: "primary_persona", label: "Primary persona", placeholder: "The main person you speak to: role, goals, pains. Add more personas with '+ Field' (economic buyer, end user, …)." },
    ],
  },
  {
    section: "Motion",
    blurb: "How you win and how you reach and price the buyer.",
    fields: [
      { key: "win_themes", label: "Win themes", placeholder: "The recurring reasons you win — the engine for battlecards & content." },
      { key: "gtm_motion", label: "GTM motion", placeholder: "How you message and convince — the core narrative, the claims and proof you lead with, how you talk about yourself to win the buyer (and the channel/motion behind it)." },
      { key: "pricing_model", label: "Pricing model", placeholder: "How it's packaged and priced — and how that shapes the motion." },
    ],
  },
  {
    // Seller-facing copy DERIVED from ratified battlecard items (Competitive
    // module). The messaging agent drafts these; the items are the facts, this
    // is what we SAY. Human-editable like any field.
    section: "Battlecard",
    blurb: "What sellers say against competitors — built on the ratified battlecard facts.",
    fields: [
      { key: "battlecard_summary", label: "Battlecard summary", placeholder: "The one-paragraph competitive story a rep leads with." },
      { key: "talk_track", label: "Talk track", placeholder: "The flow of a competitive conversation — openers, proof, close." },
      { key: "objection_responses", label: "Objection responses", placeholder: "Verbatim-usable responses to the objections we hear." },
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
