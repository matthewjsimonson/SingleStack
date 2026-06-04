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
export const SURFACES: Surface[] = [
  // Product / Strategy
  { key: "strategy_theme", label: "Strategy · Theme", module: "Product", context: "theme", description: "A theme's detail in Strategy — runs against that theme." },
  { key: "build_item", label: "Ship · Build Item", module: "Product", context: "initiative", description: "A Build Item in Ship — runs against that initiative." },
  { key: "product_record", label: "Product record", module: "Product", context: "product", description: "A product record — runs against that product." },
  // Go-to-market
  { key: "gtm_record", label: "GTM record", module: "Go-to-market", context: "gtm_record", description: "A GTM/messaging record — runs against that record." },
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
