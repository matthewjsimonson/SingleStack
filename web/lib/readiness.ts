// Living search readiness — DERIVED from the actual state of the workspace,
// not from a chat session. Deterministic and fully explainable: each dimension
// shows what it found and the exact fix, so the grade is auditable by
// construction. As records fill, the matrix earns evidence, and signals keep
// flowing, the score moves on its own — the profile evolves with the company
// and the market. (The interview's in-chat score remains a session aid; THIS
// is the durable gauge.)

export type ReadinessDim = { key: string; label: string; got: number; max: number; fix: string; expected: boolean };
export type Readiness = { score: number; dims: ReadinessDim[]; stage: Stage };

// The maturity model: readiness is PHASED. An exploring-stage company can't
// answer deal-loss or win-theme questions yet — so those dimensions aren't on
// its bar. The gauge grades against the stage-appropriate expectations and
// names what comes later, instead of failing everyone against a scaled
// company's bar.
export type Stage = "exploring" | "early" | "scaling" | "established";
export const STAGES: { key: Stage; label: string; blurb: string }[] = [
  { key: "exploring", label: "Exploring", blurb: "Pre-launch / finding the problem — identity and a first read on the buyer." },
  { key: "early", label: "Early", blurb: "First users or deals — rivals named, a matrix forming, first signals." },
  { key: "scaling", label: "Scaling", blurb: "Repeatable motion — evidence-scored matrix and live monitoring expected." },
  { key: "established", label: "Established", blurb: "Mature — the full bar, kept current automatically." },
];
// Per-stage expected max for each dimension (0 = not expected yet).
const STAGE_BAR: Record<Stage, Record<string, number>> = {
  exploring:   { identity: 3, buyer: 2, positioning: 1, features: 1, competitive: 0, freshness: 0 },
  early:       { identity: 3, buyer: 3, positioning: 2, features: 1, competitive: 2, freshness: 1 },
  scaling:     { identity: 3, buyer: 3, positioning: 2, features: 1, competitive: 3, freshness: 2 },
  established: { identity: 3, buyer: 3, positioning: 2, features: 1, competitive: 3, freshness: 2 },
};

export type ReadinessInputs = {
  productFields: Record<string, string | null>;   // field_key -> value (product record)
  gtmFields: Record<string, string | null>;       // field_key -> value (gtm record)
  moduleCount: number;
  competitorCount: number;
  capabilityCount: number;
  evidencedCells: number;                          // capability_scores with scored_by
  signals14d: number;                              // signals observed in the last 14 days
  liveSources: number;                             // non-manual-cadence connected sources
};

const has = (v: string | null | undefined) => !!v?.trim();

export function computeReadiness(i: ReadinessInputs, stage: Stage = "early"): Readiness {
  const bar = STAGE_BAR[stage];
  const dims: ReadinessDim[] = [];
  const add = (key: string, label: string, got: number, max: number, fix: string) => {
    // Cap each dimension at the STAGE'S bar; a dimension the stage doesn't
    // expect contributes nothing (and the UI shows it as "later").
    const stageMax = Math.min(max, bar[key] ?? max);
    dims.push({ key, label, got: Math.min(got, stageMax), max: stageMax, fix, expected: stageMax > 0 });
  };

  // Identity — what the product IS (product record).
  const idGot = [i.productFields.what_it_is, i.productFields.problem, i.productFields.category].filter(has).length;
  add("identity", "Product identity", idGot, 3, "Fill what-it-is, problem, and category on the product record.");

  // Buyer — who decides (gtm record).
  const buyGot = [i.gtmFields.personas ?? i.gtmFields.primary_persona, i.gtmFields.icp, i.gtmFields.industries].filter(has).length;
  add("buyer", "Buyer & industries", buyGot, 3, "Add personas, ICP, and industries/verticals to the GTM record.");

  // Positioning — against what (gtm record).
  const posGot = [i.gtmFields.positioning ?? i.gtmFields.category_pov, i.gtmFields.differentiation].filter(has).length;
  add("positioning", "Positioning", posGot, 2, "Add positioning and differentiation to the GTM record.");

  // Features — what it actually does (modules or capability fields).
  add("features", "Features / modules", (i.moduleCount >= 3 || has(i.productFields.core_capabilities)) ? 1 : 0, 1,
    "Add modules (or core capabilities) to the product record — they drive capability-overlap matching.");

  // Competitive board — rivals + matrix + evidence.
  const compGot = (i.competitorCount > 0 ? 1 : 0) + (i.capabilityCount > 0 ? 1 : 0) + (i.evidencedCells > 0 ? 1 : 0);
  add("competitive", "Competitive board", compGot, 3, "Confirm rivals, design the matrix, and ratify evidence-derived scores.");

  // Freshness — is intelligence still flowing? This is what makes the gauge
  // LIVING: it decays when monitoring stops and recovers when signals land.
  const freshGot = (i.signals14d > 0 ? 1 : 0) + (i.liveSources > 0 ? 1 : 0);
  add("freshness", "Signal freshness", freshGot, 2, "Stand up scheduled monitors — signals in the last 14 days keep this green.");

  const max = dims.reduce((a, d) => a + d.max, 0);
  const got = dims.reduce((a, d) => a + d.got, 0);
  return { score: max ? Math.round((got / max) * 100) : 0, dims, stage };
}
