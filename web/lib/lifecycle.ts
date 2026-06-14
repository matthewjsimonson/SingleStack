// ============================================================================
// lifecycle (web) — Phase G.0: the PLG lifecycle model + balance computation.
//
// The Ecosystem (Phase G) makes the whole system's balance legible: where the
// agent workforce's attention and spend sit across the recursive PLG loop, and
// where imbalance threatens it. This module is the pure, tested substrate — no
// UI. G.1 layers health classification (covered/thin/starved, loop-risk
// thresholds) on top; G.2 renders it.
//
// The lifecycle is NOT invented here — it surfaces the loop already modelled in
// docs/architecture/intelligence-and-ship.md:
//   Sense → Synthesize → Decide → Build → Validate → (Sense)
// with Position (the product/GTM record truth) as the hub feeding the loop, Sell
// (competitive/battlecards/GTM) as the market arm, and Steward (the agent/skill
// workforce maintaining itself). The STAGE_FEEDS edges encode the recursion: if
// a feeder stage starves while what it feeds stays busy, the loop degrades — the
// failure the cost dial alone can't catch.
//
// Task→stage is a reviewable judgment call (like TASK_TIER in ai_policy.ts).
// ============================================================================

export type Stage = "sense" | "synthesize" | "decide" | "build" | "validate" | "position" | "sell" | "steward";
export type StageKind = "loop" | "foundation" | "gtm" | "steward";

export const STAGES: Stage[] = ["sense", "synthesize", "decide", "build", "validate", "position", "sell", "steward"];

export const STAGE_META: Record<Stage, { label: string; blurb: string; kind: StageKind }> = {
  sense: { label: "Sense", blurb: "Sources → signals. Gather what's happening.", kind: "loop" },
  synthesize: { label: "Synthesize", blurb: "Signals → themes. Make sense of the noise.", kind: "loop" },
  decide: { label: "Decide", blurb: "Themes → decisions. The call to act.", kind: "loop" },
  build: { label: "Build", blurb: "Decisions → ship. Turn the call into work.", kind: "loop" },
  validate: { label: "Validate", blurb: "Outcomes → signals. Did it work? Feeds Sense.", kind: "loop" },
  position: { label: "Position", blurb: "The product & GTM record — the truth that feeds every stage.", kind: "foundation" },
  sell: { label: "Sell", blurb: "Competitive, battlecards, GTM execution — the market arm.", kind: "gtm" },
  steward: { label: "Steward", blurb: "The agent & skill workforce maintaining itself.", kind: "steward" },
};

// "X feeds Y" — if X starves while Y is busy, the loop is at risk.
export const STAGE_FEEDS: [Stage, Stage][] = [
  ["sense", "synthesize"], ["synthesize", "decide"], ["decide", "build"],
  ["build", "validate"], ["build", "sell"], ["validate", "sense"], // the loop closes
  ["validate", "steward"],                                          // lessons evolve the workforce
  ["sense", "position"],                                            // signals refresh records
  ["position", "decide"], ["position", "build"], ["position", "sell"], // truth feeds action
];

export const feedersOf = (s: Stage): Stage[] => STAGE_FEEDS.filter(([, y]) => y === s).map(([x]) => x);
export const feedsInto = (s: Stage): Stage[] => STAGE_FEEDS.filter(([x]) => x === s).map(([, y]) => y);

// --- Task → stage (every ai_usage task; reviewable, like TASK_TIER) ----------
export const TASK_STAGE: Record<string, Stage> = {
  // Sense — gather signals / competitive landscape.
  connector_pull: "sense", connector_distill: "sense", source_recipe: "sense",
  setup_competitive_landscape: "sense", setup_competitive_picture: "sense",
  setup_competitive_competitors: "sense", setup_competitive_interview: "sense",
  // Synthesize — signals → themes / profiles / scoring.
  synthesize_signals: "synthesize", synthesize_profile: "synthesize", profile_to_strategy: "synthesize",
  distill_lessons: "synthesize", score_capabilities: "synthesize", setup_competitive_capabilities: "synthesize",
  // Decide — themes → decisions.
  draft_decision: "decide", propose_dimensions: "decide",
  // Build — decisions → ship.
  draft_how: "build", run_workflow: "build",
  // Validate — outcomes → signals (closes the loop).
  outcome_watch: "validate",
  // Position — the product/GTM record truth.
  setup_records_extract: "position", setup_records_interview: "position", setup_records_draft: "position",
  import_record: "position", refine_record: "position", agent_propose: "position",
  // Sell — competitive arming / GTM copy.
  battlecard_analyst: "sell", battlecard_messaging: "sell",
  // Steward — the workforce itself.
  draft_agent: "steward", draft_skill: "steward", tailor_skill: "steward", draft_cornerstone: "steward",
  evolve_skills: "steward", evolve_draft: "steward", orchestrate_roster: "steward",
  agent_chat: "steward", agent_run: "steward",
};
const DEFAULT_STAGE: Stage = "steward";
export const stageOf = (task: string): Stage => TASK_STAGE[task] ?? DEFAULT_STAGE;

// --- Balance computation -----------------------------------------------------
export type UsageInput = { task: string; agent_id?: string | null; cost_usd?: number | null; created_at?: string | null };
export type RunInput = { agent_id?: string | null; cost_usd?: number | null; created_at?: string | null };
export type BalanceInput = {
  agents: { id: string; name: string }[];
  connections: { agent_id: string | null; area: string | null }[];
  usage: UsageInput[];
  runs?: RunInput[];
  nowMs?: number; // injectable for deterministic tests
};

export type StageCell = { spend: number; calls: number; lastAtMs: number | null; agentIds: string[] };
export type AreaCell = { spend: number; calls: number; agents: number; lastAtMs: number | null };
export type LoopRisk = { feeder: Stage; downstream: Stage; feederSpend: number; downstreamSpend: number; feederLastAtMs: number | null };

const ms = (s?: string | null) => (s ? Date.parse(s) : NaN);

export function computeBalance(input: BalanceInput) {
  const now = input.nowMs ?? Date.now();
  const STALE = 14 * 864e5; // 14 days with no activity ⇒ "quiet"

  // agent → connected areas
  const areasByAgent = new Map<string, Set<string>>();
  for (const c of input.connections) {
    if (!c.agent_id || !c.area) continue;
    if (!areasByAgent.has(c.agent_id)) areasByAgent.set(c.agent_id, new Set());
    areasByAgent.get(c.agent_id)!.add(c.area);
  }

  // --- per stage (the recursion view) — all usage, by task→stage ------------
  const stages = {} as Record<Stage, StageCell>;
  for (const s of STAGES) stages[s] = { spend: 0, calls: 0, lastAtMs: null, agentIds: [] };
  const stageAgents = {} as Record<Stage, Set<string>>;
  for (const s of STAGES) stageAgents[s] = new Set();
  for (const u of input.usage) {
    const s = stageOf(u.task);
    const cell = stages[s];
    cell.spend += u.cost_usd ?? 0; cell.calls += 1;
    const t = ms(u.created_at);
    if (!Number.isNaN(t)) cell.lastAtMs = Math.max(cell.lastAtMs ?? 0, t);
    if (u.agent_id) stageAgents[s].add(u.agent_id);
  }
  for (const s of STAGES) stages[s].agentIds = [...stageAgents[s]];

  // --- per area (the workforce-focus view) — agent-attributed spend ----------
  // An agent's spend is split evenly across the areas it connects to, so area
  // totals stay additive. Agent runs (no task) count toward area focus too.
  const areas = new Map<string, AreaCell>();
  const areaAgents = new Map<string, Set<string>>();
  const bump = (area: string, spend: number, at: number, agentId?: string | null) => {
    if (!areas.has(area)) { areas.set(area, { spend: 0, calls: 0, agents: 0, lastAtMs: null }); areaAgents.set(area, new Set()); }
    const c = areas.get(area)!;
    c.spend += spend; c.calls += 1;
    if (!Number.isNaN(at)) c.lastAtMs = Math.max(c.lastAtMs ?? 0, at);
    if (agentId) areaAgents.get(area)!.add(agentId);
  };
  const attribute = (agentId: string | null | undefined, spend: number, at: number) => {
    const set = agentId ? areasByAgent.get(agentId) : undefined;
    const list = set && set.size ? [...set] : ["(unscoped)"];
    const share = spend / list.length;
    for (const a of list) bump(a, share, at, agentId);
  };
  for (const u of input.usage) if (u.agent_id) attribute(u.agent_id, u.cost_usd ?? 0, ms(u.created_at));
  for (const r of input.runs ?? []) attribute(r.agent_id, r.cost_usd ?? 0, ms(r.created_at));
  // Coverage: how many agents are CONNECTED to each area (capacity), even at $0.
  for (const [agentId, set] of areasByAgent) for (const a of set) {
    if (!areas.has(a)) { areas.set(a, { spend: 0, calls: 0, agents: 0, lastAtMs: null }); areaAgents.set(a, new Set()); }
    areaAgents.get(a)!.add(agentId);
  }
  for (const [a, set] of areaAgents) areas.get(a)!.agents = set.size;

  // --- loop risks: a feeder is quiet/empty while what it feeds is busy -------
  const isQuiet = (c: StageCell) => c.spend <= 0 || c.lastAtMs == null || now - c.lastAtMs > STALE;
  const loopRisks: LoopRisk[] = [];
  for (const [feeder, downstream] of STAGE_FEEDS) {
    if (isQuiet(stages[feeder]) && stages[downstream].spend > 0 && !isQuiet(stages[downstream])) {
      loopRisks.push({ feeder, downstream, feederSpend: stages[feeder].spend, downstreamSpend: stages[downstream].spend, feederLastAtMs: stages[feeder].lastAtMs });
    }
  }

  const totalSpend = input.usage.reduce((s, u) => s + (u.cost_usd ?? 0), 0) + (input.runs ?? []).reduce((s, r) => s + (r.cost_usd ?? 0), 0);
  return { stages, areas: Object.fromEntries(areas), loopRisks, totalSpend, nowMs: now };
}
