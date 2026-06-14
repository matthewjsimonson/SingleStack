// ============================================================================
// ai_policy — the cost dial's resolution layer (F2).
//
// Companion to ai_usage.ts (which prices + logs spend). This module decides,
// for a given AI call, WHICH model and WHAT effort to use — aligning cost to the
// value of the work without letting quality silently drop.
//
// Three composable concepts (see migration 20260614040000_ai_policies.sql):
//   • Tiers  — every task is classified by stakes (TASK_TIER). The tier carries
//              the quality FLOOR: the minimum (model, effort) below which output
//              degrades. Unknown tasks default to the safest (highest) tier.
//   • Presets— quality | balanced | economy map each tier → (model, effort) via
//              PRESET_MATRIX. 'custom' pins raw model/effort on the policy row.
//   • Scopes — most-specific-wins: task-pin > agent > area > org. No row ⇒ the
//              caller's own current default (the non-regression guarantee).
//
// The FLOOR is clamped HERE at resolve time, so execution can never run below a
// tier's floor regardless of how a policy row was written. This is the
// "quality can't silently drop" guarantee, enforced at the single chokepoint.
//
// These exports (TASK_TIER, FLOORS, PRESET_MATRIX, MODELS) are the source of
// truth the Settings cost-dial UI (F2.2) reuses to compute implication previews.
// ============================================================================

export type Tier = "authoring" | "reasoning" | "conversational" | "extraction";
export type Preset = "quality" | "balanced" | "economy" | "custom";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type Lever = { model: string; effort: Effort };

// Canonical model ids (provider-agnostic strings; priced in ai_usage.ts PRICING).
export const MODELS = {
  opus: "claude-opus-4-8",
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5",
} as const;

// --- Task → tier classification --------------------------------------------
// One entry per ai_usage `task` id. Tiers are a reviewable judgment call: they
// encode what each kind of work needs. Add a task here when wiring a generator.
export const TASK_TIER: Record<string, Tier> = {
  // authoring — customer/record-facing creation; highest stakes.
  draft_agent: "authoring",
  draft_skill: "authoring",
  tailor_skill: "authoring",
  draft_cornerstone: "authoring",
  agent_propose: "authoring",
  battlecard_analyst: "authoring",
  battlecard_messaging: "authoring",
  synthesize_profile: "authoring",
  profile_to_strategy: "authoring",
  import_record: "authoring",
  setup_records_draft: "authoring",

  // reasoning — synthesis, scoring, evolution; correctness-sensitive.
  synthesize_signals: "reasoning",
  score_capabilities: "reasoning",
  evolve_skills: "reasoning",
  evolve_draft: "reasoning",
  orchestrate_roster: "reasoning",
  outcome_watch: "reasoning",
  distill_lessons: "reasoning",
  propose_dimensions: "reasoning",
  agent_run: "reasoning",
  run_workflow: "reasoning",
  draft_decision: "reasoning",
  draft_how: "reasoning",
  connector_pull: "reasoning", // tool-use retrieval (web/MCP) — needs capability, not the extraction floor
  setup_competitive_capabilities: "reasoning",

  // conversational — multi-turn, latency-sensitive.
  refine_record: "conversational",
  source_recipe: "conversational",
  setup_records_interview: "conversational",
  setup_competitive_interview: "conversational",

  // extraction — light/mechanical; cheap by default.
  connector_distill: "extraction",
  setup_competitive_picture: "extraction",
  setup_competitive_landscape: "extraction",
  setup_competitive_competitors: "extraction",
  setup_records_extract: "extraction",
};

// Unknown tasks resolve to the safest (highest-floor) tier — never economize
// work we haven't classified.
const DEFAULT_TIER: Tier = "authoring";

// --- Quality floors (per tier) ---------------------------------------------
// The minimum lever a tier may run at. Resolution clamps UP to this.
export const FLOORS: Record<Tier, Lever> = {
  authoring: { model: MODELS.sonnet, effort: "medium" },
  reasoning: { model: MODELS.sonnet, effort: "low" },
  conversational: { model: MODELS.haiku, effort: "low" },
  extraction: { model: MODELS.haiku, effort: "low" },
};

// --- Preset matrix: preset × tier → lever ----------------------------------
// 'balanced' is the recommended default: it holds high-stakes tiers at today's
// quality (opus/high) while economizing the cheap tiers. 'quality' spends up;
// 'economy' spends down (but never below FLOORS).
export const PRESET_MATRIX: Record<Exclude<Preset, "custom">, Record<Tier, Lever>> = {
  quality: {
    authoring: { model: MODELS.opus, effort: "xhigh" },
    reasoning: { model: MODELS.opus, effort: "xhigh" },
    conversational: { model: MODELS.opus, effort: "high" },
    extraction: { model: MODELS.sonnet, effort: "high" },
  },
  balanced: {
    authoring: { model: MODELS.opus, effort: "high" },
    reasoning: { model: MODELS.opus, effort: "medium" },
    conversational: { model: MODELS.sonnet, effort: "medium" },
    extraction: { model: MODELS.haiku, effort: "medium" },
  },
  economy: {
    authoring: { model: MODELS.sonnet, effort: "high" },
    reasoning: { model: MODELS.sonnet, effort: "medium" },
    conversational: { model: MODELS.haiku, effort: "medium" },
    extraction: { model: MODELS.haiku, effort: "low" },
  },
};

// --- Ranking + floor clamp --------------------------------------------------
const MODEL_RANK: Record<string, number> = {
  [MODELS.haiku]: 0,
  "claude-haiku-4-5": 0,
  [MODELS.sonnet]: 1,
  "claude-sonnet-4-6": 1,
  [MODELS.opus]: 2,
  "claude-opus-4-8": 2,
  "claude-opus-4-7": 2,
};
const EFFORT_ORDER: Effort[] = ["low", "medium", "high", "xhigh", "max"];

function modelRank(m: string): number {
  // Unknown models are treated as top-tier so we never clamp a deliberate
  // high-end choice downward.
  return m in MODEL_RANK ? MODEL_RANK[m] : 2;
}
function effortRank(e: Effort): number {
  const i = EFFORT_ORDER.indexOf(e);
  return i < 0 ? 2 : i; // unknown → 'high'
}

export function tierOf(task: string): Tier {
  return TASK_TIER[task] ?? DEFAULT_TIER;
}

// Clamp a lever UP to the tier floor on both axes independently.
export function clampToFloor(lever: Lever, tier: Tier): Lever {
  const floor = FLOORS[tier];
  const model = modelRank(lever.model) >= modelRank(floor.model) ? lever.model : floor.model;
  const effort = effortRank(lever.effort) >= effortRank(floor.effort) ? lever.effort : floor.effort;
  return { model, effort };
}

// Resolve a row's intent (preset or custom) into a floored lever for a tier.
export function leverFor(row: { preset: Preset; model?: string | null; effort?: Effort | null }, tier: Tier): Lever {
  const raw: Lever =
    row.preset === "custom"
      ? { model: row.model || FLOORS[tier].model, effort: (row.effort as Effort) || FLOORS[tier].effort }
      : PRESET_MATRIX[row.preset][tier];
  return clampToFloor(raw, tier);
}

export type PolicyRow = {
  scope: "org" | "area" | "agent" | "task";
  area: string | null;
  agent_id: string | null;
  task: string | null;
  preset: Preset;
  model: string | null;
  effort: Effort | null;
};

export type Resolution = Lever & {
  tier: Tier;
  // Where the decision came from, for UI/debugging.
  source: "task" | "agent" | "area" | "org" | "default";
};

// Pick the most-specific applicable row from a fetched set (pure; reusable/testable).
export function pickPolicy(
  rows: PolicyRow[],
  ctx: { task: string; agentId?: string | null; area?: string | null },
): PolicyRow | null {
  const byScope = (s: PolicyRow["scope"]) => rows.find((r) => {
    if (r.scope !== s) return false;
    if (s === "task") return r.task === ctx.task;
    if (s === "agent") return !!ctx.agentId && r.agent_id === ctx.agentId;
    if (s === "area") return !!ctx.area && r.area === ctx.area;
    return true; // org
  });
  return byScope("task") ?? byScope("agent") ?? byScope("area") ?? byScope("org") ?? null;
}

// ----------------------------------------------------------------------------
// resolveModelPolicy — the single entry point generators call.
//
//   const { model, effort } = await resolveModelPolicy(supabase, {
//     task: "draft_skill", agentId, area,
//     fallback: { model: "claude-opus-4-8", effort: "high" },  // today's values
//   });
//
// No applicable policy row ⇒ returns `fallback` unchanged (the generator's
// current behavior). Best-effort: any error ⇒ fallback. Never throws.
// ----------------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
export async function resolveModelPolicy(
  supabase: any,
  opts: { task: string; agentId?: string | null; area?: string | null; fallback: Lever },
): Promise<Resolution> {
  const tier = tierOf(opts.task);
  try {
    const { data: org } = await supabase.rpc("current_org_id");
    if (!org) return { ...opts.fallback, tier, source: "default" };
    const { data: rows } = await supabase
      .from("ai_policies")
      .select("scope, area, agent_id, task, preset, model, effort")
      .eq("org_id", org);
    const row = pickPolicy((rows ?? []) as PolicyRow[], opts);
    if (!row) return { ...opts.fallback, tier, source: "default" };
    return { ...leverFor(row, tier), tier, source: row.scope };
  } catch (_) {
    return { ...opts.fallback, tier, source: "default" };
  }
}
