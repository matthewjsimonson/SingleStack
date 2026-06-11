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
