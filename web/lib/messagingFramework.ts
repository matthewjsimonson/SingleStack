// ============================================================================
// messagingFramework — the canonical PMA-style messaging & narrative framework
// for a GTM record. This is the UPSTREAM source of truth that downstream content
// and campaigns (gtmPlaybooks) derive from: a complete "messaging house" plus the
// strategic narrative.
//
// Each section is stored as a gtm_tabs row keyed by `key` (tab_key). The framework
// renders these sections in order with real guidance + an example; the
// messaging-framework edge function drafts/completes them, grounded in the org's
// product + GTM records, competitive, and themes. Product/persona/industry-agnostic
// — the customer's records define the specifics; this only defines the SHAPE.
// ============================================================================

export type FrameworkSection = {
  key: string;       // gtm_tabs.tab_key
  label: string;     // display label
  guidance: string;  // what this section is + how to write it (shown inline)
  example: string;   // a short, generic illustration of the shape (not the content)
};

export const MESSAGING_FRAMEWORK: FrameworkSection[] = [
  {
    key: "positioning_statement",
    label: "Positioning statement",
    guidance: "The foundation the whole framework stands on. One or two sentences that locate the product in the market: for [audience] who [need], [product] is the [category] that [key benefit] — and what sets it apart from the alternatives. Keep it sharp and true; everything below builds on it.",
    example: "For [who] who [need], [Product] is the [category] that [core benefit]. Unlike [the alternative they'd otherwise use], it [the differentiator that matters].",
  },
  {
    key: "strategic_narrative",
    label: "Strategic narrative",
    guidance: "The story that makes the category make sense and creates urgency. Frame the shift happening in the world, the stakes of that shift, the better future a buyer wants (the 'promised land'), the obstacles in the way, and how the product is the bridge to that future. This is the narrative every asset ladders up to.",
    example: "The world is shifting from [old way] to [new way]. Teams that don't adapt face [stakes]. The winners get to [promised land] — but [obstacle] stands in the way. [Product] is how you cross it.",
  },
  {
    key: "value_proposition",
    label: "Value proposition",
    guidance: "The single clearest promise — the core value a customer gets, in plain language a buyer would repeat. The apex of the messaging house; it should be consistent with the value proposition on the GTM record and sharpened here.",
    example: "[Product] lets [audience] [achieve the outcome] without [the pain of the old way].",
  },
  {
    key: "pillar_1",
    label: "Messaging pillar 1",
    guidance: "A core theme the messaging stands on. Write it as: the CLAIM (one line), the SUPPORTING POINTS that make it credible, and the PROOF behind it (capabilities, evidence, outcomes). Aim for three pillars that together cover your differentiation — this is the first.",
    example: "Claim: [the one-line promise]. Why it's true: [2–3 supporting points]. Proof: [the features / evidence / outcomes that back it].",
  },
  {
    key: "pillar_2",
    label: "Messaging pillar 2",
    guidance: "The second core theme. Same shape: claim, supporting points, proof. Pillars should be distinct from one another and each tied to something the product genuinely does better.",
    example: "Claim: […]. Why it's true: […]. Proof: […].",
  },
  {
    key: "pillar_3",
    label: "Messaging pillar 3",
    guidance: "The third core theme. Same shape: claim, supporting points, proof. Together the three pillars should hold up the value proposition above.",
    example: "Claim: […]. Why it's true: […]. Proof: […].",
  },
  {
    key: "persona_messaging",
    label: "Persona messaging",
    guidance: "For each persona you serve, the tailored message. Per persona: their core pain, what they value most, the ONE message that lands for them, and the objection to preempt. Pull the personas from your GTM record — don't invent audiences you don't serve.",
    example: "[Persona]: Pain — [what hurts]. Values — [what they care about]. Key message — [the line that lands]. Objection to preempt — [the doubt + the answer].",
  },
  {
    key: "tone_of_voice",
    label: "Tone of voice",
    guidance: "How the brand sounds, so every asset reads like one company. Name the voice attributes (e.g. clear, confident, human) and give a do / don't for each. Keep it usable by a writer who's never seen the brand.",
    example: "[Attribute]: do [this] — not [that]. (e.g. Clear: say it plainly — don't hide behind jargon.)",
  },
  {
    key: "proof_points",
    label: "Proof points",
    guidance: "The evidence library the messaging draws on — metrics, customer outcomes, third-party validation, named capabilities — each one usable to back a claim above. Keep them concrete and, where possible, sourced.",
    example: "• [Metric or outcome] — [the claim it supports]. • [Customer result] — […]. • [Validation / capability] — […].",
  },
  {
    key: "elevator_pitch",
    label: "Elevator pitch & boilerplate",
    guidance: "The derived short-form that content and campaigns reuse verbatim, all consistent with everything above: a one-sentence pitch, a ~30-second pitch, and a reusable boilerplate paragraph.",
    example: "One-liner: […]. 30-second: […]. Boilerplate: [the paragraph you'd drop into a press release or about page].",
  },
];

export const FRAMEWORK_KEYS = new Set(MESSAGING_FRAMEWORK.map((s) => s.key));
export const isFrameworkKey = (k: string) => FRAMEWORK_KEYS.has(k);
