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
