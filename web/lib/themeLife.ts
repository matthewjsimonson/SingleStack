// Living-theme visual vocabulary. Minimal by design: momentum is ONE glyph,
// lifecycle is one quiet chip — data that earns its pixels, nothing more.

export type Momentum = "accelerating" | "steady" | "fading";
export type ThemeState = "emerging" | "active" | "escalating" | "steady" | "fading" | "dormant";

// A single glyph, not a chart.
export function momentumGlyph(m: string | null | undefined): { glyph: string; label: string; color: string } {
  switch (m) {
    case "accelerating": return { glyph: "▲", label: "Accelerating", color: "var(--gn-text)" };
    case "fading": return { glyph: "▼", label: "Fading", color: "var(--tm)" };
    default: return { glyph: "—", label: "Steady", color: "var(--ts)" };
  }
}

// Lifecycle → chip tone (reuses existing chip tones; no new colors).
export function stateTone(s: string | null | undefined): "default" | "accent" | "violet" | "green" | "amber" {
  switch (s) {
    case "escalating": return "amber";
    case "emerging": return "accent";
    case "active": return "green";
    case "fading":
    case "dormant": return "default";
    default: return "default";
  }
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

// Human label for a theme_events kind.
export function eventLabel(kind: string, detail: Record<string, unknown> | null): string {
  switch (kind) {
    case "created": return "Theme created";
    case "evidence_added": return `${(detail?.added as number) ?? ""} signal${(detail?.added as number) === 1 ? "" : "s"} added`.trim();
    case "state_changed": return `State: ${detail?.from ?? "?"} → ${detail?.to ?? "?"}`;
    case "escalated": return "Escalated";
    case "summary_updated": return "Summary refreshed";
    case "recommendation_changed": return "Recommendation updated";
    case "merged_in": return `Merged in "${detail?.from_title ?? "another theme"}"`;
    case "decayed": return "Decayed — no recent evidence";
    default: return kind;
  }
}
