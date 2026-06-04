// Surface registry — the product surfaces a play can be placed onto. Product-
// defined (not user-editable), so it lives in code. Each surface declares the
// CONTEXT it provides; a play's required context (from its target_type) is
// matched against it to drive SUGGESTIONS and guardrails. Users map plays onto
// any allowed surface; suggested ones are where it most makes sense.

export type SurfaceContext = "competitor" | "campaign" | "content" | "initiative" | "theme" | "gtm_record" | "product" | "market_story";

export type Surface = {
  key: string;
  label: string;
  module: string;        // where it lives, for grouping the map
  context: SurfaceContext;
  description: string;
};

// Across the product, by module. Add more here as surfaces are wired to render
// PlacedPlays.
// NOTE: surfaces that already have NATIVE record advisors (GTM record, Product
// record, Home) are intentionally NOT here — plays would duplicate the advisors
// there. Plays live where there's no native advisor.
export const SURFACES: Surface[] = [
  // Product / Strategy
  { key: "strategy_theme", label: "Strategy · Theme", module: "Product", context: "theme", description: "A theme's detail in Strategy — runs against that theme." },
  { key: "build_item", label: "Ship · Build Item", module: "Product", context: "initiative", description: "A Build Item in Ship — runs against that initiative." },
  // Go-to-market
  { key: "campaign_record", label: "Campaign record", module: "Go-to-market", context: "campaign", description: "A campaign's record in Campaigns — runs against that campaign." },
  { key: "content_brief", label: "Content brief", module: "Go-to-market", context: "content", description: "Content ideation & review — runs against the brief." },
  // Intelligence
  { key: "competitor_home", label: "Competitor page", module: "Intelligence", context: "competitor", description: "Each competitor's page in Competitive — runs against that competitor." },
  { key: "market_story", label: "Market story", module: "Intelligence", context: "market_story", description: "A market-intel story — runs against that signal/story." },
];

// What context a play REQUIRES, derived from its target_type. A play with no hard
// requirement (custom / none) can be placed anywhere; a typed play is SUGGESTED
// on surfaces that provide its context.
export function playContextNeed(targetType: string | null | undefined): SurfaceContext | null {
  switch (targetType) {
    case "competitor": return "competitor";
    case "initiative": return "initiative";
    case "theme": return "theme";
    case "gtm_record": return "gtm_record";
    case "product": return "product";
    case "campaign": return "campaign";
    case "content": return "content";
    case "market_story": return "market_story";
    default: return null;
  }
}

export type PlacementState = "suggested" | "allowed" | "blocked";

// What a play RUNS ON — set when authoring. Drives the CONTEXT the officer
// receives (run-play branches on this) and which surfaces are suggested. Only
// "competitor" and "initiative" have a deep, dedicated context today; the rest
// run on the target's name + recent signals (still typed, so suggestions and
// guardrails line up). "custom" = no specific context, place anywhere.
export const PLAY_TARGET_TYPES: { value: string; label: string; hint: string }[] = [
  { value: "custom", label: "Anywhere (no specific context)", hint: "Runs on the item's name + recent signals. Can be placed on any surface." },
  { value: "competitor", label: "Competitor", hint: "Deep context: the capability matrix, battlecard items, and signals for the competitor." },
  { value: "initiative", label: "Build item / initiative", hint: "Deep context: the initiative's scope, stage, workstreams, and signals." },
  { value: "theme", label: "Strategy theme", hint: "Runs against a theme (name + recent signals)." },
  { value: "campaign", label: "Campaign", hint: "Runs against a campaign (name + recent signals)." },
  { value: "content", label: "Content brief", hint: "Runs against a content brief (name + recent signals)." },
  { value: "product", label: "Product record", hint: "Runs against a product (name + recent signals)." },
  { value: "gtm_record", label: "GTM record", hint: "Runs against a GTM record (name + recent signals)." },
  { value: "market_story", label: "Market story", hint: "Runs against a market story (name + recent signals)." },
];
export const targetTypeMeta = (value: string | null | undefined) =>
  PLAY_TARGET_TYPES.find((t) => t.value === (value ?? "custom")) ?? PLAY_TARGET_TYPES[0];

// Suggestion + guardrail for placing a play (by target_type) onto a surface.
//  • suggested — the surface provides exactly the context the play needs.
//  • allowed   — the play has no hard requirement; user may place it (override).
//  • blocked   — the play needs a context this surface doesn't provide (nonsense).
export function placementStatus(targetType: string | null | undefined, surface: Surface): { state: PlacementState; reason?: string } {
  const need = playContextNeed(targetType);
  if (need === null) return { state: "allowed" };
  if (need === surface.context) return { state: "suggested" };
  return { state: "blocked", reason: `Needs ${need} context — this surface has none.` };
}
