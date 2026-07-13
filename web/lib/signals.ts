// ============================================================================
// Canonical signal taxonomy — the single source of truth for how signals are
// filtered. A signal has three axes; filter through THESE helpers, never by
// re-deriving the rule inline (that divergence is what caused the lens/routing
// bugs):
//   • LENS    — category: product | gtm | both   → isProductSignal / isGtmSignal
//   • DOMAIN  — signals | competitive | market | capability | usage  → signalDomain
//   • ORIGIN  — internal | external               → s.origin
// ============================================================================

export const SIGNAL_DOMAIN = {
  signals: "signals",
  competitive: "competitive",
  market: "market",
  capability: "capability",
  usage: "usage",
} as const;
export type SignalDomain = typeof SIGNAL_DOMAIN[keyof typeof SIGNAL_DOMAIN];

// Reads the first-class `domain` column when present, else legacy
// metadata.domain (the DB trigger keeps them aligned). Use this everywhere
// instead of reaching into metadata.domain directly.
export function signalDomain(s: { domain?: string | null; metadata?: { domain?: string } | null }): string | null {
  return s.domain ?? s.metadata?.domain ?? null;
}

// Lens helpers live in strategy.ts (long-standing, widely imported); re-export
// so this module is the one canonical taxonomy surface.
export { isProductSignal, isGtmSignal } from "./strategy";

// ---- Node attribution ------------------------------------------------------
// A pulled signal carries metadata.node_key: the signals-profile node whose
// aimed source produced it. The consumer pages (Competitive/Market/Technology)
// group their feed by that node so what lands mirrors the profile you built.
export type NodeMeta = { field_key: string; label: string; weight?: number | null; parent_key?: string | null };
export const nodeKeyOf = (s: { metadata?: { node_key?: string } | null }): string | null => s.metadata?.node_key ?? null;
export const sourceUrlOf = (s: { metadata?: { url?: string } | null }): string | null => s.metadata?.url ?? null;
export const sourceNameOf = (s: { metadata?: { source?: string; channel?: string } | null }): string | null => s.metadata?.source ?? s.metadata?.channel ?? null;

// Group signals under the node that pulled them, ordered by the node hierarchy
// (direct → indirect); anything without a live node falls into one trailing
// "Other signals" bucket rather than vanishing.
export function groupByNode<T extends { metadata?: { node_key?: string } | null }>(
  signals: T[], nodes: NodeMeta[], otherLabel = "Other signals",
): { key: string; label: string; weight: number; signals: T[] }[] {
  const byKey = new Map(nodes.map((n) => [n.field_key, n]));
  const buckets = new Map<string, T[]>();
  for (const s of signals) {
    const k = nodeKeyOf(s);
    const key = k && byKey.has(k) ? k : "__other";
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(s);
  }
  const out = [...buckets.entries()].map(([key, list]) => {
    const n = byKey.get(key);
    return { key, label: n?.label ?? otherLabel, weight: n?.weight ?? 0, signals: list };
  });
  // Direct (weight 3) first … indirect (1) … then the Other bucket (weight 0).
  return out.sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label));
}
