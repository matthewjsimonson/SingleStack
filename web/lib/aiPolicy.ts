// ============================================================================
// aiPolicy (web) — the cost dial's client-side catalog + implication math.
//
// MIRRORS the governing logic in supabase/functions/_shared/ai_policy.ts (tiers,
// floors, preset matrix) and PRICING in supabase/functions/_shared/ai_usage.ts.
// Keep the data blocks below IN SYNC with those files — they are the single
// source of truth at runtime; this module is the presentation/preview layer the
// UI reads so the dial can compute implications instantly (no round-trip).
//
// The runtime ALWAYS clamps to the tier floor (resolveModelPolicy), so anything
// shown here as "below floor" can't actually execute below it — we surface the
// floor in the UI rather than hide the clamp.
// ============================================================================

export type Tier = "authoring" | "reasoning" | "conversational" | "extraction";
export type Preset = "quality" | "balanced" | "economy" | "custom";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type Lever = { model: string; effort: Effort };

export const MODELS = {
  opus: "claude-opus-4-8",
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5",
} as const;

export const MODEL_LABEL: Record<string, string> = {
  "claude-opus-4-8": "Opus 4.8",
  "claude-opus-4-7": "Opus 4.7",
  "claude-sonnet-4-6": "Sonnet 4.6",
  "claude-haiku-4-5": "Haiku 4.5",
};

// Per-1M-token USD prices — mirror of _shared/ai_usage.ts PRICING.
export const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};
const CACHE_READ_MULT = 0.1;
const CACHE_WRITE_MULT = 1.25;

// --- Task → tier (mirror of _shared/ai_policy.ts TASK_TIER) -----------------
export const TASK_TIER: Record<string, Tier> = {
  draft_agent: "authoring", draft_skill: "authoring", tailor_skill: "authoring",
  draft_cornerstone: "authoring", agent_propose: "authoring", battlecard_analyst: "authoring",
  battlecard_messaging: "authoring", synthesize_profile: "authoring", profile_to_strategy: "authoring",
  import_record: "authoring", setup_records_draft: "authoring",
  synthesize_signals: "reasoning", score_capabilities: "reasoning", evolve_skills: "reasoning",
  evolve_draft: "reasoning", orchestrate_roster: "reasoning", outcome_watch: "reasoning",
  distill_lessons: "reasoning", propose_dimensions: "reasoning", agent_run: "reasoning",
  run_workflow: "reasoning", draft_decision: "reasoning", draft_how: "reasoning",
  connector_pull: "reasoning", setup_competitive_capabilities: "reasoning",
  agent_chat: "conversational", refine_record: "conversational", source_recipe: "conversational",
  setup_records_interview: "conversational", setup_competitive_interview: "conversational",
  connector_distill: "extraction", setup_competitive_picture: "extraction",
  setup_competitive_landscape: "extraction", setup_competitive_competitors: "extraction",
  setup_records_extract: "extraction",
};
const DEFAULT_TIER: Tier = "authoring";

// Friendly labels (presentation only — web's concern).
export const TASK_LABEL: Record<string, string> = {
  draft_agent: "Create agent", draft_skill: "Create skill", tailor_skill: "Tailor skill",
  draft_cornerstone: "Draft cornerstone", agent_propose: "Agent proposal",
  battlecard_analyst: "Battlecard analysis", battlecard_messaging: "Battlecard messaging",
  synthesize_profile: "Signal profile", profile_to_strategy: "Profile → strategy",
  import_record: "Import record", setup_records_draft: "Record setup — draft",
  synthesize_signals: "Synthesize signals", score_capabilities: "Score capabilities",
  evolve_skills: "Evolve skills", evolve_draft: "Evolve — draft skill",
  orchestrate_roster: "Roster orchestration", outcome_watch: "Outcome watch",
  distill_lessons: "Distill lessons", propose_dimensions: "Propose dimensions",
  agent_run: "Agent run", run_workflow: "Run workflow", draft_decision: "Draft decision",
  draft_how: "Draft how", connector_pull: "Connector pull", agent_chat: "Agent chat",
  refine_record: "Refine record", source_recipe: "Source recipe",
  setup_records_interview: "Record setup — interview", setup_records_extract: "Record setup — extract",
  setup_competitive_interview: "Competitive — interview", setup_competitive_picture: "Competitive — picture",
  setup_competitive_landscape: "Competitive — landscape", setup_competitive_competitors: "Competitive — competitors",
  setup_competitive_capabilities: "Competitive — capabilities", connector_distill: "Connector distill",
};

export const TIER_LABEL: Record<Tier, { label: string; blurb: string }> = {
  authoring: { label: "Authoring", blurb: "Customer/record-facing creation — highest stakes." },
  reasoning: { label: "Reasoning", blurb: "Synthesis, scoring, evolution — correctness-sensitive." },
  conversational: { label: "Conversational", blurb: "Multi-turn, latency-sensitive." },
  extraction: { label: "Extraction", blurb: "Light, mechanical — cheap by default." },
};

// --- Floors + preset matrix (mirror of _shared/ai_policy.ts) ----------------
export const FLOORS: Record<Tier, Lever> = {
  authoring: { model: MODELS.sonnet, effort: "medium" },
  reasoning: { model: MODELS.sonnet, effort: "low" },
  conversational: { model: MODELS.haiku, effort: "low" },
  extraction: { model: MODELS.haiku, effort: "low" },
};

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

export const PRESETS: { key: Exclude<Preset, "custom">; label: string; blurb: string }[] = [
  { key: "quality", label: "Quality", blurb: "Spend up — top model + effort where it counts." },
  { key: "balanced", label: "Balanced", blurb: "Recommended — holds high-stakes work at today's quality, economizes the rest." },
  { key: "economy", label: "Economy", blurb: "Spend down — never below each tier's quality floor." },
];

const MODEL_RANK: Record<string, number> = {
  "claude-haiku-4-5": 0, "claude-sonnet-4-6": 1, "claude-opus-4-8": 2, "claude-opus-4-7": 2,
};
const EFFORT_ORDER: Effort[] = ["low", "medium", "high", "xhigh", "max"];
const modelRank = (m: string) => (m in MODEL_RANK ? MODEL_RANK[m] : 2);
const effortRank = (e: Effort) => { const i = EFFORT_ORDER.indexOf(e); return i < 0 ? 2 : i; };

export const tierOf = (task: string): Tier => TASK_TIER[task] ?? DEFAULT_TIER;

export function clampToFloor(lever: Lever, tier: Tier): Lever {
  const f = FLOORS[tier];
  return {
    model: modelRank(lever.model) >= modelRank(f.model) ? lever.model : f.model,
    effort: effortRank(lever.effort) >= effortRank(f.effort) ? lever.effort : f.effort,
  };
}

// The lever a (preset, tier) resolves to at runtime (floored).
export function resolvedLever(preset: Exclude<Preset, "custom">, tier: Tier): Lever {
  return clampToFloor(PRESET_MATRIX[preset][tier], tier);
}

export function isAtFloor(lever: Lever, tier: Tier): boolean {
  const f = FLOORS[tier];
  return modelRank(lever.model) === modelRank(f.model) && effortRank(lever.effort) === effortRank(f.effort);
}

// --- Implication math (model-swap exact; effort directional) -----------------
export type UsageRow = {
  task: string; model: string | null;
  input_tokens: number | null; output_tokens: number | null;
  cache_read_tokens?: number | null; cache_write_tokens?: number | null;
  cost_usd: number | null;
};

// Re-price a usage row's token counts under a candidate model (the exact part).
export function repriceRow(row: UsageRow, model: string): number | null {
  const p = PRICING[model];
  if (!p) return row.cost_usd ?? null;
  const inT = row.input_tokens ?? 0, outT = row.output_tokens ?? 0;
  const cr = row.cache_read_tokens ?? 0, cw = row.cache_write_tokens ?? 0;
  return (inT * p.input + outT * p.output + cr * p.input * CACHE_READ_MULT + cw * p.input * CACHE_WRITE_MULT) / 1_000_000;
}

// Project total spend over a set of task-tagged usage rows under a preset.
// Returns { current, projected }. Model swap is exact; effort is NOT modeled
// here (shown separately as a directional note).
export function projectPreset(rows: UsageRow[], preset: Exclude<Preset, "custom">): { current: number; projected: number } {
  let current = 0, projected = 0;
  for (const r of rows) {
    current += r.cost_usd ?? 0;
    const lever = resolvedLever(preset, tierOf(r.task));
    projected += repriceRow(r, lever.model) ?? (r.cost_usd ?? 0);
  }
  return { current, projected };
}
