// Intelligence lenses: which executive agents interpret signals for which part
// of the Foundation. The dashboard slices intel this way so the right agents
// turn signals into record updates — humans + AI in the loop.
//   • Product lens  → CPO + Chief Engineering interpret signals into the
//                     Product Record & product strategy.
//   • GTM lens      → CRO + CCO interpret signals into the GTM Record & how you
//                     go to market.
export type Lens = {
  key: "product" | "gtm";
  title: string;
  blurb: string;
  agentKeys: string[];      // agents that interpret this lens
  recordType: "product" | "gtm";
  accent: string;
};

export const LENSES: Lens[] = [
  {
    key: "product",
    title: "Product intelligence",
    blurb: "Signals the CPO & Chief Engineering agents read into the product record and strategy — usage problems, tech trends, roadmap pressure.",
    agentKeys: ["cpo", "ceng"],
    recordType: "product",
    accent: "var(--ac)",
  },
  {
    key: "gtm",
    title: "Go-to-market intelligence",
    blurb: "Signals the CRO & CCO agents read into GTM records and messaging — buyer behavior, competitive moves, narrative shifts.",
    agentKeys: ["cro", "cco"],
    recordType: "gtm",
    accent: "var(--vl)",
  },
];
