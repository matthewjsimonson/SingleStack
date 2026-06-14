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

// ============================================================================
// G.1 — health & harmony classification. Turns the raw balance into explainable,
// ranked signals: which stages are dark, where the workforce is over-committed
// vs neglected, and which loop-risks actually threaten the recursion. Plain
// English on purpose — this copy feeds the G.2 surface and the G.3 rebalance
// agent. Thresholds are guard-railed and stated, not magic.
// ============================================================================
export type StageStatus = "active" | "quiet" | "empty";
export type AreaStatus = "over-committed" | "balanced" | "under-invested" | "neglected" | "uncovered";
export type Harmony = "healthy" | "watch" | "at-risk";
export type RiskLevel = "high" | "medium" | "low";

const ACTIVE_WINDOW = 14 * 864e5; // activity within 14d = "active"

export type Balance = ReturnType<typeof computeBalance>;

export function classifyBalance(b: Balance) {
  const now = b.nowMs;
  const isLoop = (s: Stage) => STAGE_META[s].kind === "loop";
  const stageStatus = (s: Stage): StageStatus => {
    const c = b.stages[s];
    if (c.spend <= 0) return "empty";
    return c.lastAtMs != null && now - c.lastAtMs <= ACTIVE_WINDOW ? "active" : "quiet";
  };
  const stageHealth = {} as Record<Stage, { status: StageStatus; spend: number; lastAtMs: number | null; loopCritical: boolean }>;
  for (const s of STAGES) stageHealth[s] = { status: stageStatus(s), spend: b.stages[s].spend, lastAtMs: b.stages[s].lastAtMs, loopCritical: isLoop(s) };

  // --- area focus: over-committed vs neglected, vs a fair share -------------
  const areaEntries = Object.entries(b.areas).filter(([a]) => a !== "(unscoped)");
  const totalAreaSpend = areaEntries.reduce((s, [, c]) => s + c.spend, 0);
  const live = areaEntries.filter(([, c]) => c.agents > 0 || c.spend > 0);
  const fair = live.length > 0 ? 1 / live.length : 0;
  const TINY = 0.005;
  const areaHealth = areaEntries.map(([area, c]) => {
    const share = totalAreaSpend > 0 ? c.spend / totalAreaSpend : 0;
    let status: AreaStatus;
    if (c.agents === 0) status = "uncovered";
    else if (c.spend <= TINY) status = "neglected";
    // Over-committed: a clear majority of the workforce's focus in one area, OR
    // (with ≥3 live areas) a share well above its fair slice. The absolute rule
    // is what catches the 2-area "one hoards" case the fair-multiple can't.
    else if (share > 0.5 || (live.length >= 3 && share - fair > 0.2)) status = "over-committed";
    else if (live.length >= 3 && fair > 0 && share < 0.5 * fair) status = "under-invested";
    else status = "balanced";
    return { area, status, share, spend: c.spend, agents: c.agents };
  }).sort((x, y) => y.spend - x.spend);

  // --- loop-risk ranking ----------------------------------------------------
  // severity = feeder weight (loop-spine matters more) × what it feeds (downstream
  // share of total spend) × empty-is-worse-than-stale.
  const risks = b.loopRisks.map((r) => {
    const feederEmpty = b.stages[r.feeder].spend <= 0;
    const dShare = b.totalSpend > 0 ? r.downstreamSpend / b.totalSpend : 0;
    const severity = (isLoop(r.feeder) ? 2 : 1) * dShare * (feederEmpty ? 1.5 : 1);
    const level: RiskLevel = severity >= 0.5 ? "high" : severity >= 0.2 ? "medium" : "low";
    const fL = STAGE_META[r.feeder].label, dL = STAGE_META[r.downstream].label;
    const message = `${fL} is ${feederEmpty ? "dark" : "going quiet"} while ${dL} is one of your busiest stages — ${r.feeder === "validate" ? "outcomes aren't feeding back, so the loop can't learn" : `${dL} is running on ${feederEmpty ? "no" : "stale"} input from ${fL}`}.`;
    return { feeder: r.feeder, downstream: r.downstream, severity, level, message };
  }).sort((a, c) => c.severity - a.severity);

  // --- overall harmony ------------------------------------------------------
  const emptyLoopStages = STAGES.filter((s) => isLoop(s) && stageHealth[s].status === "empty");
  const overCommitted = areaHealth.filter((a) => a.status === "over-committed");
  const uncoveredLive = areaHealth.filter((a) => a.status === "uncovered" && a.spend > 0);
  let status: Harmony = "healthy";
  if (risks.some((r) => r.level === "high") || emptyLoopStages.length > 0) status = "at-risk";
  else if (risks.some((r) => r.level === "medium") || overCommitted.length > 0 || uncoveredLive.length > 0) status = "watch";

  const headline =
    status === "healthy" ? "Balanced — attention is spread across the loop and your areas."
    : status === "at-risk" ? (risks[0]?.message ?? `${emptyLoopStages.map((s) => STAGE_META[s].label).join(" & ")} ${emptyLoopStages.length === 1 ? "is" : "are"} dark — the loop can't close.`)
    : (risks[0]?.message ?? (overCommitted.length ? `${overCommitted[0].area} is taking an outsized share of the workforce — other areas may be starving.` : "Some areas are uncovered — worth a look."));

  return { stageHealth, areaHealth, risks, harmony: { status, headline } };
}
