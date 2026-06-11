// The source catalog: where signals come from. Source-type-agnostic — the same
// model serves G2, LinkedIn, websites, YouTube, and whatever's next. Each entry
// declares how we'd reach it (authMode), what it can see (accessScope, shown to
// the user so the blast radius is always visible), and a sane default budget so
// a source yields a focused trickle, not a firehose.
//
// `live: false` means "register + log manually now; automatic pulling lands when
// the connector runtime ships". The metadata is forward-compatible so flipping a
// connector to live requires no schema change.
export type SourceDef = {
  kind: string;
  label: string;
  origin: "internal" | "external";
  icon: string;
  blurb: string;
  live: boolean;
  authMode: "none" | "oauth" | "api_key" | "mcp"; // how we authenticate
  accessScope: string;            // human-readable "what this can access" (read-only)
  needsUrl?: boolean;             // does adding it require a URL/handle?
  urlHint?: string;
  defaultMaxPerPull: number;      // anti-overload budget default
  defaultFocus?: "product" | "gtm" | "both";
};

export const SOURCE_CATALOG: SourceDef[] = [
  // ---- Internal — your own systems -----------------------------------------
  { kind: "manual", label: "Manual entry", origin: "internal", icon: "✍️", blurb: "Log a signal by hand — an observation, a decision, a note.", live: true, authMode: "none", accessScope: "Only what you type", defaultMaxPerPull: 1 },
  { kind: "analytics", label: "Product analytics", origin: "internal", icon: "📊", blurb: "Usage data — Amplitude, Mixpanel, PostHog. Adoption gaps and friction.", live: false, authMode: "api_key", accessScope: "Read-only: aggregated usage events", defaultMaxPerPull: 10, defaultFocus: "product" },
  { kind: "crm", label: "CRM / pipeline", origin: "internal", icon: "💼", blurb: "Salesforce, HubSpot — deal signals, win/loss, objections.", live: false, authMode: "oauth", accessScope: "Read-only: deals, notes, win/loss", defaultMaxPerPull: 10, defaultFocus: "gtm" },
  { kind: "calls", label: "Sales calls", origin: "internal", icon: "🎙", blurb: "Gong, recordings — what buyers actually say.", live: false, authMode: "oauth", accessScope: "Read-only: call transcripts & summaries", defaultMaxPerPull: 8, defaultFocus: "gtm" },
  { kind: "support", label: "Support", origin: "internal", icon: "🛟", blurb: "Zendesk, Intercom — recurring problems and requests.", live: false, authMode: "oauth", accessScope: "Read-only: tickets & conversations", defaultMaxPerPull: 10, defaultFocus: "product" },
  { kind: "issues", label: "Issues & roadmap", origin: "internal", icon: "🧩", blurb: "Linear, Jira, GitHub issues — what's being built and broken.", live: false, authMode: "oauth", accessScope: "Read-only: issues & status", defaultMaxPerPull: 10, defaultFocus: "product" },

  // ---- External — market & web ---------------------------------------------
  { kind: "website", label: "Website", origin: "external", icon: "🌐", blurb: "Any web page — a competitor's site, a pricing page, a blog. Tracks changes.", live: true, authMode: "none", accessScope: "Read-only: public web pages", needsUrl: true, urlHint: "https://competitor.com/pricing", defaultMaxPerPull: 5, defaultFocus: "gtm" },
  { kind: "linkedin_posts", label: "LinkedIn posts", origin: "external", icon: "📣", blurb: "A competitor's LinkedIn narrative — launches, positioning, hiring pushes. Monitored live via web search.", live: true, authMode: "none", accessScope: "Read-only: public LinkedIn activity (via web search)", urlHint: "linkedin.com/company/competitor (optional — sharpens it)", defaultMaxPerPull: 8, defaultFocus: "gtm" },
  { kind: "linkedin_jobs", label: "LinkedIn jobs", origin: "external", icon: "🧑‍💼", blurb: "A competitor's open roles — where they're investing (eng, GTM, new bets). Monitored live via web search.", live: true, authMode: "none", accessScope: "Read-only: public job postings (via web search)", urlHint: "linkedin.com/company/competitor/jobs (optional)", defaultMaxPerPull: 8, defaultFocus: "both" },
  { kind: "press", label: "Press & news", origin: "external", icon: "📰", blurb: "Press releases, funding, partnerships, exec moves — their newsroom, PR wires, tech press. Monitored live via web search.", live: true, authMode: "none", accessScope: "Read-only: public press & news (via web search)", urlHint: "competitor.com/newsroom (optional)", defaultMaxPerPull: 8, defaultFocus: "both" },
  { kind: "youtube", label: "YouTube", origin: "external", icon: "▶️", blurb: "Video transcripts — demos, talks, webinars. Pulls the transcript, not the video.", live: true, authMode: "none", accessScope: "Read-only: public video transcripts", needsUrl: true, urlHint: "youtube.com/@competitor or a video URL", defaultMaxPerPull: 5, defaultFocus: "both" },
  { kind: "reviews", label: "Review sites", origin: "external", icon: "⭐", blurb: "G2, TrustRadius, Capterra — what users praise and complain about, head-to-head. Monitored live via web search.", live: true, authMode: "none", accessScope: "Read-only: public reviews & ratings (via web search)", defaultMaxPerPull: 10, defaultFocus: "gtm" },
  { kind: "mcp", label: "MCP server", origin: "external", icon: "🔌", blurb: "Any MCP server — a CRM, reviews, support, an internal data tool. Connect the server URL + token, point it at specific records, and it pulls live.", live: true, authMode: "mcp", accessScope: "Read-only via the MCP server you connect (scope depends on its tools)", defaultMaxPerPull: 10, defaultFocus: "both" },
  { kind: "web_search", label: "Web search", origin: "external", icon: "🔎", blurb: "Ongoing web monitoring — news, launches, mentions. Aim it with guidance/terms; pulls live via web search.", live: true, authMode: "none", accessScope: "Read-only: public web & news", defaultMaxPerPull: 8, defaultFocus: "both" },
  { kind: "github", label: "GitHub", origin: "external", icon: "🐙", blurb: "Releases and shipping cadence — a competitor's public repos and how fast they ship. Monitored live via web search.", live: true, authMode: "none", accessScope: "Read-only: public repos, releases, commits (via web search)", urlHint: "github.com/org (optional)", defaultMaxPerPull: 8, defaultFocus: "product" },
  { kind: "analyst", label: "Analyst & research", origin: "external", icon: "📚", blurb: "Gartner, Forrester — category and positioning shifts. Full reports need a subscription connector (coming); not live yet.", live: false, authMode: "api_key", accessScope: "Read-only: subscribed research", defaultMaxPerPull: 5, defaultFocus: "gtm" },
  { kind: "social", label: "Social (X / Reddit)", origin: "external", icon: "💬", blurb: "X and Reddit — narrative, advocacy, complaints. Monitored live via web search.", live: true, authMode: "none", accessScope: "Read-only: public posts (via web search)", defaultMaxPerPull: 8, defaultFocus: "gtm" },
];

export const CATALOG_BY_KIND: Record<string, SourceDef> = Object.fromEntries(SOURCE_CATALOG.map((s) => [s.kind, s]));
