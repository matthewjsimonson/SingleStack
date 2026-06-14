// Ecosystem model checks (Phase G.0 balance + G.1 classification).
// Run: node --experimental-strip-types scripts/verify-lifecycle.mjs
import * as lc from "../web/lib/lifecycle.ts";

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.error("✗ " + m); } else console.log("✓ " + m); };
const now = Date.parse("2026-06-14T00:00:00Z");
const recent = "2026-06-13T00:00:00Z";
const old = "2026-04-01T00:00:00Z"; // >14d stale

// --- G.0: taxonomy + feeder graph + balance -------------------------------
ok(lc.stageOf("draft_how") === "build" && lc.stageOf("outcome_watch") === "validate", "stageOf maps tasks");
ok(lc.feedersOf("synthesize").includes("sense") && lc.feedersOf("sense").includes("validate"), "feeder graph closes the loop (validate→sense)");

const b = lc.computeBalance({
  agents: [{ id: "A", name: "X" }],
  connections: [{ agent_id: "A", area: "product" }, { agent_id: "A", area: "gtm" }],
  usage: [
    { task: "synthesize_signals", cost_usd: 5, created_at: recent },
    { task: "draft_how", cost_usd: 10, created_at: recent },
    { task: "agent_propose", agent_id: "A", cost_usd: 8, created_at: recent },
  ],
  runs: [{ agent_id: "A", cost_usd: 4, created_at: recent }],
  nowMs: now,
});
ok(b.stages.build.spend === 10 && b.stages.synthesize.spend === 5, "stage rollup sums by task→stage");
ok(Math.abs(b.areas.product.spend - 6) < 1e-9 && Math.abs(b.areas.gtm.spend - 6) < 1e-9, "area spend splits evenly across an agent's areas ((8+4)/2)");
ok(b.loopRisks.some((r) => r.feeder === "sense" && r.downstream === "synthesize"), "loop-risk: sense quiet → synthesize busy");

// --- G.1: classification --------------------------------------------------
// Build busy, Decide+Validate dark → high risk + at-risk harmony.
const a = lc.classifyBalance(lc.computeBalance({
  agents: [{ id: "A", name: "X" }], connections: [{ agent_id: "A", area: "product" }],
  usage: [
    { task: "connector_pull", cost_usd: 15, created_at: recent },
    { task: "synthesize_signals", cost_usd: 20, created_at: recent },
    { task: "draft_how", cost_usd: 50, created_at: recent },
  ],
  nowMs: now,
}));
ok(a.stageHealth.validate.status === "empty" && a.stageHealth.build.status === "active", "stage status: empty vs active");
ok(a.risks[0] && a.risks[0].level === "high" && a.harmony.status === "at-risk", "top risk high → harmony at-risk");
ok(a.harmony.headline === a.risks[0].message, "headline surfaces the top risk in plain English");

// Quiet (stale) vs empty.
const stale = lc.classifyBalance(lc.computeBalance({ agents: [], connections: [], usage: [{ task: "draft_how", cost_usd: 1, created_at: old }], nowMs: now }));
ok(stale.stageHealth.build.status === "quiet", "stale-but-nonzero stage = quiet (not empty)");

// Over-committed area at 2 areas (the case 2×fair can't catch).
const oc = lc.classifyBalance(lc.computeBalance({
  agents: [{ id: "A", name: "X" }, { id: "B", name: "Y" }],
  connections: [{ agent_id: "A", area: "product" }, { agent_id: "B", area: "gtm" }],
  usage: [
    { task: "agent_propose", agent_id: "A", cost_usd: 90, created_at: recent },
    { task: "agent_propose", agent_id: "B", cost_usd: 1, created_at: recent },
    { task: "connector_pull", cost_usd: 5, created_at: recent }, { task: "synthesize_signals", cost_usd: 5, created_at: recent },
    { task: "draft_decision", cost_usd: 5, created_at: recent }, { task: "draft_how", cost_usd: 5, created_at: recent },
    { task: "outcome_watch", cost_usd: 5, created_at: recent },
  ],
  nowMs: now,
}));
ok(oc.areaHealth.find((x) => x.area === "product").status === "over-committed", "2-area hoarding flagged over-committed");
ok(oc.harmony.status === "watch", "imbalance with a live loop → watch (not at-risk, not healthy)");

// Balanced + full loop → healthy.
const hh = lc.classifyBalance(lc.computeBalance({
  agents: [{ id: "A", name: "X" }, { id: "B", name: "Y" }],
  connections: [{ agent_id: "A", area: "product" }, { agent_id: "B", area: "gtm" }],
  usage: ["connector_pull", "synthesize_signals", "draft_decision", "draft_how", "outcome_watch"].map((t) => ({ task: t, cost_usd: 10, created_at: recent }))
    .concat([{ task: "agent_propose", agent_id: "A", cost_usd: 10, created_at: recent }, { task: "agent_chat", agent_id: "B", cost_usd: 10, created_at: recent }]),
  nowMs: now,
}));
ok(hh.harmony.status === "healthy", "balanced + full loop → healthy");

console.log(fail ? `\n${fail} CHECK(S) FAILED` : "\nall ecosystem checks passed");
process.exit(fail ? 1 : 0);
