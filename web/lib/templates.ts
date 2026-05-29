// Record templates: the structured starting point for each record type.
// A record isn't a flat list — it's organized into sections, each with fields.
// These templates scaffold that structure so a new record opens ready to fill,
// and the UI renders each section as its own visual panel. Section/field names
// are data (stored on record_fields.section / .label), keeping the model
// agnostic — templates are just a convenient default, fully editable after.

export type TemplateField = { key: string; label: string; placeholder?: string };
export type TemplateSection = { section: string; blurb: string; fields: TemplateField[] };

export const PRODUCT_TEMPLATE: TemplateSection[] = [
  {
    section: "Overview",
    blurb: "The high-level truth of the product — what it is and why it exists.",
    fields: [
      { key: "what_it_is", label: "What it is", placeholder: "A one-paragraph description of the product." },
      { key: "who_its_for", label: "Who it's for", placeholder: "Primary users / buyers and their context." },
      { key: "strategic_intent", label: "Strategic intent", placeholder: "The bet — where this product is taking the company." },
      { key: "category", label: "Category", placeholder: "The market category it competes in." },
      { key: "positioning", label: "Positioning", placeholder: "How it's positioned vs. alternatives." },
      { key: "stage", label: "Stage", placeholder: "e.g. GA, Beta, Early access." },
    ],
  },
  {
    section: "Technical",
    blurb: "How it's built and what it connects to.",
    fields: [
      { key: "architecture", label: "Architecture", placeholder: "High-level architecture and key components." },
      { key: "integrations", label: "Integrations", placeholder: "Systems and tools it integrates with." },
      { key: "tech_stack", label: "Tech stack", placeholder: "Core technologies." },
      { key: "security", label: "Security & compliance", placeholder: "Security posture, certifications, data handling." },
    ],
  },
];

export const GTM_TEMPLATE: TemplateSection[] = [
  {
    section: "Company narrative",
    blurb: "The story the company tells around this offering.",
    fields: [
      { key: "narrative", label: "Narrative", placeholder: "The overarching story and worldview." },
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
    ],
  },
  {
    section: "Personas",
    blurb: "Who you're speaking to.",
    fields: [
      { key: "primary_persona", label: "Primary persona", placeholder: "Role, goals, pains, what they care about." },
      { key: "buying_committee", label: "Buying committee", placeholder: "Other roles involved in the decision." },
    ],
  },
];

export function templateFor(kind: "product" | "gtm") {
  return kind === "product" ? PRODUCT_TEMPLATE : GTM_TEMPLATE;
}
