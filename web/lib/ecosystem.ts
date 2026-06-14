// ============================================================================
// ecosystem (web) — the PLG coverage model. Re-frames Phase G from a spend lens
// to a COVERAGE lens (docs/architecture/plg-ecosystem.md).
//
// SingleStack converges product management + product marketing. The product-led-
// growth process splits into two record-centered circles:
//   • Build / Product circle — the PM areas. Execution WITH frontier models
//     (build & ship: new products · modules · features · enhancements · fixes)
//     is the heart, and the differentiator. No growth without execution.
//   • GTM circle — the PMM areas, across the flywheel (Acquire→…→Advocate).
//
// Each area decomposes into TASKS, and every area answers — per task — the one
// question this surface exists for:
//   is there an AGENT, with the right CORNERSTONE + CHILD-SKILLS, running the
//   right WORKFLOW, to actually do this?
// A task with no agent / no skill / no workflow is a GAP — and a gap in a feeder
// (above all the Build engine) stalls the flywheel. Graded per area AND per task.
//
// Pure + tested (scripts/verify-ecosystem.mjs); no UI. The spend lens lives in
// the F2 cost dial (Settings → AI & cost) and is untouched.
// ============================================================================

export type Circle = "product" | "gtm";
export type Check = "agent" | "cornerstone" | "skills" | "workflow";
export type AreaStatus = "covered" | "partial" | "gap";
export type Harmony = "healthy" | "watch" | "at-risk";

export const CHECKS: Check[] = ["agent", "cornerstone", "skills", "workflow"];
export const CHECK_LABEL: Record<Check, string> = {
  agent: "Agent", cornerstone: "Cornerstone", skills: "Child skills", workflow: "Workflow",
};

export type Task = { key: string; label: string };
export type Area = {
  key: string;
  label: string;
  circle: Circle;
  blurb: string;
  connAreas: string[];   // connections.area values that map to this area
  record?: string;       // the record section it maintains
  flywheel?: string;     // the PLG flywheel stage it drives (GTM)
  engine?: boolean;      // the Build engine — execution, the heart of the product circle
  href: string;          // where a human goes to act
  tasks: Task[];         // the unit a workflow covers
};

// --- Build / Product circle (PM areas of PLG) -------------------------------
// First four GROUND the build; Build & Ship is the engine — and the weakest today.
export const PRODUCT_AREAS: Area[] = [
  {
    key: "product_truth", label: "Product Truth", circle: "product",
    blurb: "A current, accurate product identity — what it is, who it's for, the bet.",
    connAreas: ["products"], record: "Overview", href: "/products",
    tasks: [
      { key: "refresh_overview", label: "Refresh Overview from signals" },
      { key: "reconcile_drift", label: "Reconcile drift in the record" },
      { key: "keep_vision", label: "Keep vision & strategic intent live" },
    ],
  },
  {
    key: "capabilities", label: "Capabilities & Differentiation", circle: "product",
    blurb: "Know what it does and where it wins or lags — incl. frontier-model capability.",
    connAreas: ["products", "capabilities", "competitive"], record: "Capabilities", href: "/competitive",
    tasks: [
      { key: "maintain_capabilities", label: "Maintain core / differentiated capabilities" },
      { key: "score_vs_rivals", label: "Score capabilities vs rivals" },
      { key: "track_frontier", label: "Track frontier-model capability" },
    ],
  },
  {
    key: "technical", label: "Technical Foundation", circle: "product",
    blurb: "The buildable truth that grounds every “How” — architecture, stack, debt.",
    connAreas: ["products"], record: "Technical", href: "/products",
    tasks: [
      { key: "maintain_architecture", label: "Maintain architecture / stack / security" },
      { key: "flag_debt", label: "Flag tech debt & evolution-watch" },
    ],
  },
  {
    key: "strategy", label: "Strategy & Decisions", circle: "product",
    blurb: "A prioritized, evidence-grounded direction — themes → decisions → build candidates.",
    connAreas: ["signals", "products"], record: "Strategy", href: "/strategy",
    tasks: [
      { key: "synthesize_themes", label: "Synthesize product themes" },
      { key: "draft_decisions", label: "Draft decisions (options + tradeoffs)" },
      { key: "propose_dimensions", label: "Propose strategic dimensions" },
      { key: "bundle_candidates", label: "Bundle verified signals into build candidates" },
    ],
  },
  {
    key: "build_ship", label: "Build & Ship", circle: "product", engine: true,
    blurb: "Execution with frontier models — turn decisions into shipped product. No growth without execution.",
    connAreas: ["products"], record: "Roadmap / Ship", href: "/ship",
    tasks: [
      { key: "scope_build", label: "Scope the build (Why / What)" },
      { key: "plan_approach", label: "Plan the approach (How: frontier-aware)" },
      { key: "build_with_frontier", label: "Build with frontier models (the make)" },
      { key: "ship_release", label: "Ship / release" },
      { key: "validate_outcomes", label: "Validate outcomes → new signals" },
    ],
  },
];

// --- GTM circle (PMM areas of PLG, across the flywheel) ----------------------
export const GTM_AREAS: Area[] = [
  {
    key: "positioning", label: "Positioning", circle: "gtm",
    blurb: "A sharp, defensible market frame that the rest of GTM hangs on.",
    connAreas: ["gtm"], record: "Positioning", flywheel: "frames all", href: "/gtm",
    tasks: [
      { key: "maintain_positioning", label: "Maintain category POV / positioning / differentiation" },
      { key: "sharpen_vs_rivals", label: "Sharpen positioning vs rivals" },
    ],
  },
  {
    key: "messaging", label: "Messaging & Value", circle: "gtm",
    blurb: "A clear promise + value narratives that drive activation.",
    connAreas: ["gtm"], record: "Messaging", flywheel: "Acquire / Activate", href: "/gtm",
    tasks: [
      { key: "maintain_value_prop", label: "Maintain value prop + message pillars" },
      { key: "persona_tune", label: "Persona-tune; write activation narratives" },
    ],
  },
  {
    key: "audience", label: "Audience & ICP", circle: "gtm",
    blurb: "Know exactly who you grow — refreshed by PQL + market.",
    connAreas: ["gtm"], record: "Buyer", flywheel: "targeting", href: "/gtm",
    tasks: [
      { key: "maintain_icp", label: "Maintain ICP, industries, personas" },
      { key: "refresh_from_pql", label: "Refresh from PQL + market signals" },
    ],
  },
  {
    key: "motion", label: "Motion & Packaging", circle: "gtm",
    blurb: "The right motion + pricing — PLG / sales-assist fit.",
    connAreas: ["gtm"], record: "Motion", flywheel: "Convert", href: "/gtm",
    tasks: [
      { key: "maintain_motion", label: "Maintain win themes, GTM motion, pricing" },
    ],
  },
  {
    key: "competitive", label: "Competitive", circle: "gtm",
    blurb: "Win competitive deals — evidence-cited battlecards + seller copy.",
    connAreas: ["gtm", "competitive"], record: "Battlecard", flywheel: "Convert", href: "/competitive",
    tasks: [
      { key: "analyze_rivals", label: "Analyze rivals (evidence-cited battlecard items)" },
      { key: "draft_seller_copy", label: "Draft seller copy (talk track, objections)" },
    ],
  },
  {
    key: "demand", label: "Demand & Content", circle: "gtm",
    blurb: "Acquisition + adoption assets grounded in the record.",
    connAreas: ["gtm"], record: "Content / Campaigns", flywheel: "Acquire / Adopt", href: "/content",
    tasks: [
      { key: "draft_content", label: "Draft content grounded in the record" },
      { key: "run_campaigns", label: "Run campaigns" },
    ],
  },
  {
    key: "enablement", label: "Enablement", circle: "gtm",
    blurb: "Reps & champions ready to sell, from ratified facts.",
    connAreas: ["gtm"], record: "Enablement", flywheel: "Convert (assisted)", href: "/enablement",
    tasks: [
      { key: "build_enablement", label: "Build enablement from ratified facts" },
    ],
  },
  {
    key: "lifecycle_pql", label: "Lifecycle & PQL", circle: "gtm",
    blurb: "Read the product-led signal; surface PQLs; feed positioning + the sell desk.",
    connAreas: ["gtm", "signals"], record: "Accounts / PQL", flywheel: "Activate → Expand → Advocate", href: "/pql",
    tasks: [
      { key: "ingest_usage", label: "Ingest product usage" },
      { key: "score_accounts", label: "Score accounts (activation / expansion / churn)" },
      { key: "qualify_pql", label: "Qualify PQLs; emit GTM signals on state change" },
    ],
  },
];

export const AREAS: Area[] = [...PRODUCT_AREAS, ...GTM_AREAS];

// --- coverage computation ----------------------------------------------------
export type CoverageInput = {
  agents: { id: string; name: string }[];
  connections: { agent_id: string | null; area: string | null }[];
  agentSkills: { agent_id: string; skill_id: string }[];
  skills: { id: string; kind: string | null; areas: string[] | null }[];
  workflows: { agent_id: string | null; target_type: string | null; is_active: boolean | null }[];
};

export type AreaCoverage = {
  area: Area;
  checks: Record<Check, boolean>;
  status: AreaStatus;
  agentIds: string[];
  missing: Check[];
};

const add = (m: Map<string, Set<string>>, k: string, v: string) => {
  let s = m.get(k); if (!s) { s = new Set(); m.set(k, s); } s.add(v);
};

export function computeCoverage(input: CoverageInput): { areas: AreaCoverage[] } {
  const connByAgent = new Map<string, Set<string>>();
  for (const c of input.connections) if (c.agent_id && c.area) add(connByAgent, c.agent_id, c.area);

  const skillsByAgent = new Map<string, Set<string>>();
  for (const as of input.agentSkills) if (as.agent_id && as.skill_id) add(skillsByAgent, as.agent_id, as.skill_id);

  const skillById = new Map(input.skills.map((s) => [s.id, s] as const));

  const areas = AREAS.map((area): AreaCoverage => {
    const want = new Set(area.connAreas);

    // Agents connected to this area (capacity).
    const agentIds = input.agents
      .filter((a) => { const conns = connByAgent.get(a.id); return !!conns && [...conns].some((x) => want.has(x)); })
      .map((a) => a.id);
    const agentIdSet = new Set(agentIds);
    const agent = agentIds.length > 0;

    // Cornerstone: a connected agent has an identity (a cornerstone skill).
    const cornerstone = agentIds.some((id) =>
      [...(skillsByAgent.get(id) ?? [])].some((sid) => skillById.get(sid)?.kind === "cornerstone"));

    // Child skills: a connected agent holds a child skill tagged to this area.
    const skills = agentIds.some((id) =>
      [...(skillsByAgent.get(id) ?? [])].some((sid) => {
        const s = skillById.get(sid);
        if (!s || s.kind === "cornerstone") return false;
        return (s.areas ?? []).some((x) => want.has(x));
      }));

    // Workflow: an active workflow on a connected agent, matched to the circle.
    const workflow = input.workflows.some((w) => {
      if (w.is_active === false) return false;
      if (!w.agent_id || !agentIdSet.has(w.agent_id)) return false;
      const tt = w.target_type;
      return tt == null || tt === "none" || tt === area.circle;
    });

    const checks: Record<Check, boolean> = { agent, cornerstone, skills, workflow };
    const missing = CHECKS.filter((k) => !checks[k]);
    const status: AreaStatus = !agent ? "gap" : missing.length === 0 ? "covered" : "partial";
    return { area, checks, status, agentIds, missing };
  });

  return { areas };
}

// --- classification: gap-first, build-forward --------------------------------
export type Coverage = ReturnType<typeof computeCoverage>;

// Feeder weight: the Build engine matters most, then the rest of the product
// circle (no product, nothing to grow), then GTM.
const weight = (a: AreaCoverage) => (a.area.engine ? 3 : a.area.circle === "product" ? 2 : 1);

export function classifyCoverage(cov: Coverage) {
  const areas = cov.areas;
  const gaps = areas.filter((a) => a.status === "gap");
  const partials = areas.filter((a) => a.status === "partial");
  const covered = areas.filter((a) => a.status === "covered");

  // Ranked work to do: gaps first (engine-weighted), then partials.
  const rankedGaps = [...gaps].sort((x, y) => weight(y) - weight(x));
  const rankedPartials = [...partials].sort((x, y) => (weight(y) - weight(x)) || (y.missing.length - x.missing.length));

  const engineGap = gaps.find((a) => a.area.engine);
  let status: Harmony = "healthy";
  if (engineGap || gaps.length >= 3) status = "at-risk";
  else if (gaps.length > 0 || partials.length > 0) status = "watch";

  const headline =
    engineGap
      ? "Build & Ship is unstaffed — there's no execution, so the flywheel can't turn. Put an agent on it."
    : status === "healthy"
      ? "Every area is covered — agents, cornerstones, skills, and workflows are in place across both circles."
    : rankedGaps[0]
      ? `${rankedGaps[0].area.label} has no agent — ${rankedGaps[0].area.circle === "product" ? "the product engine" : "the growth motion"} has a hole.`
    : rankedPartials[0]
      ? `${rankedPartials[0].area.label} has an agent but is missing ${rankedPartials[0].missing.map((m) => CHECK_LABEL[m].toLowerCase()).join(" + ")} — it can be asked but isn't equipped.`
      : "Coverage is forming.";

  const counts = { covered: covered.length, partial: partials.length, gap: gaps.length, total: areas.length };
  return { rankedGaps, rankedPartials, partials, covered, counts, harmony: { status, headline } };
}
