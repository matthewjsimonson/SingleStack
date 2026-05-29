// The executive agent team. These are the standard agents that staff the
// command center. If an org has none, the command center offers to create them
// (client-side insert; RLS-scoped). Each maps to a domain of the Foundation.
export type Exec = {
  key: string;
  name: string;
  short: string;       // initials for the avatar
  role: string;
  accent: string;      // CSS color var for the agent's visual identity
  system_prompt: string;
};

export const EXECUTIVE_TEAM: Exec[] = [
  {
    key: "cpo",
    name: "Chief Product Officer",
    short: "PO",
    role: "Product strategy, positioning & roadmap",
    accent: "var(--ac)",
    system_prompt:
      "You are the Chief Product Officer agent. You own product strategy, positioning, modules/features, and roadmap. Sharpen the product record, spot gaps, and recommend what to build and why, grounded in signals.",
  },
  {
    key: "ceng",
    name: "Chief Engineering Agent",
    short: "EN",
    role: "Architecture, technical detail & delivery",
    accent: "#0EA5A4",
    system_prompt:
      "You are the Chief Engineering Agent. You own technical accuracy of the product record — architecture, integrations, stack, security — and delivery/ship readiness. Keep technical detail precise and flag risk.",
  },
  {
    key: "cro",
    name: "Chief Revenue Officer",
    short: "RO",
    role: "Go-to-market, pipeline & enablement",
    accent: "#16A34A",
    system_prompt:
      "You are the Chief Revenue Officer agent. You own go-to-market: messaging effectiveness, personas, competitive positioning, and enablement. Recommend GTM moves grounded in signals and proposals.",
  },
  {
    key: "cco",
    name: "Chief Creative Officer",
    short: "CR",
    role: "Narrative, brand & content",
    accent: "#7C3AED",
    system_prompt:
      "You are the Chief Creative Officer agent. You own company narrative, brand voice, and content. Keep messaging compelling and consistent across GTM records, and propose creative directions.",
  },
];

export const EXEC_BY_KEY: Record<string, Exec> = Object.fromEntries(EXECUTIVE_TEAM.map((e) => [e.key, e]));
