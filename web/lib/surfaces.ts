// Surface registry — the product surfaces a play can be placed onto. Product-
// defined (not user-editable), so it lives in code. Each surface declares the
// CONTEXT it provides; a play's required context (from its target_type) is
// matched against it to drive suggestions and guardrails (Phase 3).
//
// Start with three (per the build order): competitor pages, campaign records,
// content briefs. Add more here (product spec, prototype, …) as they're wired.

export type SurfaceContext = "competitor" | "campaign" | "content";

export type Surface = {
  key: string;
  label: string;
  context: SurfaceContext;
  description: string;
};

export const SURFACES: Surface[] = [
  { key: "competitor_home", label: "Competitor home page", context: "competitor", description: "Each competitor's page in Competitive — runs against that competitor." },
  { key: "campaign_record", label: "Campaign record", context: "campaign", description: "A campaign's record in Campaigns — runs against that campaign." },
  { key: "content_brief", label: "Content brief", context: "content", description: "Content ideation & review — runs against the brief." },
];

// What context a play REQUIRES, derived from its target_type. A play with no hard
// requirement (custom / none) can be placed anywhere; a competitor/initiative play
// needs a surface that provides that context.
export function playContextNeed(targetType: string | null | undefined): SurfaceContext | "initiative" | null {
  if (targetType === "competitor") return "competitor";
  if (targetType === "initiative") return "initiative";
  return null;
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
