// The source catalog: where signals come from. Today every source is added in
// "manual" mode (you register it and log signals against it). The `kind` marks
// what a live connector would pull from once the MCP/connector runtime exists —
// `live: false` means "register + manual now, automatic pulling later".
export type SourceDef = {
  kind: string;
  label: string;
  origin: "internal" | "external";
  icon: string;
  blurb: string;
  live: boolean; // true once a real connector exists; false = manual-only for now
};

export const SOURCE_CATALOG: SourceDef[] = [
  // Internal — your own systems
  { kind: "analytics", label: "Product analytics", origin: "internal", icon: "📊", blurb: "Usage data — Amplitude, Mixpanel, PostHog. Surfaces adoption gaps and friction.", live: false },
  { kind: "crm", label: "CRM / pipeline", origin: "internal", icon: "💼", blurb: "Salesforce, HubSpot — deal signals, win/loss, objections.", live: false },
  { kind: "calls", label: "Sales calls", origin: "internal", icon: "🎙", blurb: "Gong, recordings — what buyers actually say.", live: false },
  { kind: "support", label: "Support", origin: "internal", icon: "🛟", blurb: "Zendesk, Intercom — recurring problems and requests.", live: false },
  { kind: "issues", label: "Issues & roadmap", origin: "internal", icon: "🧩", blurb: "Linear, Jira, GitHub issues — what's being built and broken.", live: false },
  { kind: "manual", label: "Manual entry", origin: "internal", icon: "✍️", blurb: "Log a signal by hand — an observation, a decision, a note.", live: true },

  // External — market & web
  { kind: "github", label: "GitHub trends", origin: "external", icon: "🐙", blurb: "Repos, releases, skills — product/tech trends to track.", live: false },
  { kind: "web_search", label: "Web search", origin: "external", icon: "🔎", blurb: "Ongoing web monitoring — news, launches, mentions.", live: false },
  { kind: "reviews", label: "Review sites", origin: "external", icon: "⭐", blurb: "G2, TrustRadius — sentiment and competitive comparisons.", live: false },
  { kind: "analyst", label: "Analyst & research", origin: "external", icon: "📚", blurb: "Gartner, Forrester — category and positioning shifts.", live: false },
  { kind: "social", label: "Social", origin: "external", icon: "💬", blurb: "LinkedIn, X, Reddit — narrative, advocacy, complaints.", live: false },
];

export const CATALOG_BY_KIND: Record<string, SourceDef> = Object.fromEntries(SOURCE_CATALOG.map((s) => [s.kind, s]));
