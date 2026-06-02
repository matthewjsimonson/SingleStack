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
      { key: "primary_persona", label: "Primary persona", placeholder: "The main person you speak to: role, goals, pains. Add more personas with '+ Field' (economic buyer, end user, …)." },
    ],
  },
  {
    section: "Motion",
    blurb: "How you win and how you reach and price the buyer.",
    fields: [
      { key: "win_themes", label: "Win themes", placeholder: "The recurring reasons you win — the engine for battlecards & content." },
      { key: "gtm_motion", label: "GTM motion", placeholder: "PLG, sales-led, partner — the motion that fits, and why." },
      { key: "pricing_model", label: "Pricing model", placeholder: "How it's packaged and priced — and how that shapes the motion." },
    ],
  },
];

export function templateFor(kind: "product" | "gtm") {
  return kind === "product" ? PRODUCT_TEMPLATE : GTM_TEMPLATE;
}
