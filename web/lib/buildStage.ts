// The ONE definition of a Build Item's stage — derived from real work, so the
// Ship board column, the cockpit status, and the cockpit's current step can
// never disagree. Stage is indicative of work done + work remaining:
//   scoped          → being specified (Product + Technical Scope)
//   ready_for_agent → readiness gate passes; ready to hand to a coding agent
//   in_build        → build work has started (a task is active/done)
//   shipped         → all build work done (or explicitly shipped)
// build_state (the stored column) acts as a manual floor (the readiness gate and
// "mark shipped" set it); real work can advance the derived stage past it. We
// take whichever is further along, so the stage only ever reflects reality.

export type BuildStage = "scoped" | "ready_for_agent" | "in_build" | "shipped";

export const BUILD_STAGES: { key: BuildStage; label: string; blurb: string }[] = [
  { key: "scoped", label: "Scoped", blurb: "Define what we're building and why — the Product Scope." },
  { key: "ready_for_agent", label: "Ready for agent", blurb: "Assemble the Technical Scope so a coding agent can build it." },
  { key: "in_build", label: "In build", blurb: "Execute — the build tasks and the agent handoff." },
  { key: "shipped", label: "Shipped", blurb: "Built and released — link the release and confirm the outcome." },
];

const RANK: Record<BuildStage, number> = { scoped: 0, ready_for_agent: 1, in_build: 2, shipped: 3 };

export function buildReadiness(fields: Map<string, string>, links: { kind: string }[]) {
  const checks = [
    { ok: links.length > 0, label: "Context bundle has a link" },
    { ok: links.some((l) => l.kind === "skill_ref"), label: "A skill is referenced" },
    { ok: !!fields.get("acceptance_criteria"), label: "Acceptance criteria captured" },
    { ok: !!fields.get("test_approach"), label: "Test approach defined" },
  ];
  return { checks, ready: checks.every((c) => c.ok) };
}

export function deriveBuildStage(input: { buildState: string | null; ready: boolean; buildTasks: { stage: string }[] }): BuildStage {
  const { buildState, ready, buildTasks } = input;
  const anyStarted = buildTasks.some((t) => t.stage === "active" || t.stage === "done");
  const allDone = buildTasks.length > 0 && buildTasks.every((t) => t.stage === "done");

  let derived: BuildStage = "scoped";
  if (allDone) derived = "shipped";
  else if (anyStarted) derived = "in_build";
  else if (ready) derived = "ready_for_agent";

  // Honor a manual floor (readiness gate / mark-shipped), but never below reality.
  const floor = (["scoped", "ready_for_agent", "in_build", "shipped"] as BuildStage[]).includes(buildState as BuildStage) ? (buildState as BuildStage) : "scoped";
  return RANK[derived] >= RANK[floor] ? derived : floor;
}

export const STAGE_LABEL: Record<BuildStage, string> = Object.fromEntries(BUILD_STAGES.map((s) => [s.key, s.label])) as Record<BuildStage, string>;

// ---------------------------------------------------------------------------
// PLG workflow — the Initiatives board axis. Starts at Plan (Signal lives in
// Product Strategy). An item's PLG stage is DERIVED from where its real build
// AND GTM work are — never asserted. Spans build-only, gtm-only, and both.
//   Plan   → being scoped / not yet building
//   Build  → the product is actively being built (build stage = in_build)
//   Launch → the build is done; GTM work is in flight (or pending)
//   Live   → built and launched — shipped and measuring
// ---------------------------------------------------------------------------
export type PlgStage = "plan" | "build" | "launch" | "live";

export const PLG_STAGES: { key: PlgStage; label: string; hint: string; tone: string }[] = [
  { key: "plan", label: "Plan", hint: "Scoping the bet", tone: "var(--ac)" },
  { key: "build", label: "Build", hint: "Building the product", tone: "var(--ac)" },
  { key: "launch", label: "Launch", hint: "Taking it to market", tone: "var(--vl)" },
  { key: "live", label: "Live", hint: "Shipped & measuring", tone: "var(--gn)" },
];

export function derivePlgStage(input: { scope: string; buildStage: BuildStage; gtmTasks: { stage: string }[] }): PlgStage {
  const { scope, buildStage, gtmTasks } = input;
  const hasBuild = scope === "product" || scope === "both";
  const hasGtm = scope === "gtm" || scope === "both";
  const gtmStarted = gtmTasks.some((t) => t.stage === "active" || t.stage === "done");
  const gtmAllDone = gtmTasks.length > 0 && gtmTasks.every((t) => t.stage === "done");
  const buildDone = !hasBuild || buildStage === "shipped";
  const buildActive = hasBuild && buildStage === "in_build";
  const gtmDone = !hasGtm || gtmAllDone;

  // Live — every side that exists is complete (ignore empty shells with no work).
  if (buildDone && gtmDone) {
    const anyWork = hasBuild || gtmTasks.length > 0;
    return anyWork ? "live" : "plan";
  }
  // Launch — product is built (or there is none); GTM work remains.
  if (buildDone && hasGtm && !gtmDone) return gtmStarted || hasBuild ? "launch" : "plan";
  // Build — actively building the product.
  if (buildActive) return "build";
  // Otherwise still planning.
  return "plan";
}

// ---------------------------------------------------------------------------
// GTM workflow — the Go-to-market area axis, parallel to the build workflow.
// Derived from the item's GTM tasks (content/campaign workstreams):
//   brief         → message/audience/channels being defined; no production yet
//   in_production → assets being produced (a task is active/done, not all done)
//   launched      → all GTM work done — published and in market
// ---------------------------------------------------------------------------
export type GtmStage = "brief" | "in_production" | "launched";

export const GTM_STAGES: { key: GtmStage; label: string; blurb: string; tone: string }[] = [
  { key: "brief", label: "Brief", blurb: "Define the message, audience, and channels.", tone: "var(--vl)" },
  { key: "in_production", label: "In production", blurb: "Produce the content and campaign assets.", tone: "var(--vl)" },
  { key: "launched", label: "Launched", blurb: "Published and in market.", tone: "var(--vl)" },
];

export function deriveGtmStage(gtmTasks: { stage: string }[]): GtmStage {
  const started = gtmTasks.some((t) => t.stage === "active" || t.stage === "done");
  const allDone = gtmTasks.length > 0 && gtmTasks.every((t) => t.stage === "done");
  if (allDone) return "launched";
  if (started) return "in_production";
  return "brief";
}

export const GTM_STAGE_LABEL: Record<GtmStage, string> = Object.fromEntries(GTM_STAGES.map((s) => [s.key, s.label])) as Record<GtmStage, string>;
