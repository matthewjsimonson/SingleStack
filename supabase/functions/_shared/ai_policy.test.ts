// Deno tests for the pure cost-dial resolution logic — `deno test`.
import {
  pickPolicy, clampToFloor, leverFor, tierOf, FLOORS, PRESET_MATRIX, MODELS,
  type PolicyRow,
} from "./ai_policy.ts";

function assert(c: boolean, m: string) { if (!c) throw new Error(m); }

const row = (p: Partial<PolicyRow>): PolicyRow => ({
  scope: "org", area: null, agent_id: null, task: null, preset: "balanced", model: null, effort: null, ...p,
});

Deno.test("tierOf: known + unknown (unknown → authoring floor)", () => {
  assert(tierOf("draft_skill") === "authoring", "draft_skill is authoring");
  assert(tierOf("connector_distill") === "extraction", "connector_distill is extraction");
  assert(tierOf("totally_unknown_task") === "authoring", "unknown → safest tier");
});

Deno.test("pickPolicy: precedence task > agent > area > org", () => {
  const rows = [
    row({ scope: "org", preset: "economy" }),
    row({ scope: "area", area: "billing", preset: "balanced" }),
    row({ scope: "agent", agent_id: "ag1", preset: "quality" }),
    row({ scope: "task", task: "draft_skill", preset: "custom", model: MODELS.haiku, effort: "low" }),
  ];
  const ctx = { task: "draft_skill", agentId: "ag1", area: "billing" };
  assert(pickPolicy(rows, ctx)!.scope === "task", "task-pin wins");
  assert(pickPolicy(rows.filter(r => r.scope !== "task"), ctx)!.scope === "agent", "agent next");
  assert(pickPolicy(rows.filter(r => !["task", "agent"].includes(r.scope)), ctx)!.scope === "area", "area next");
  assert(pickPolicy([row({ scope: "org", preset: "economy" })], ctx)!.scope === "org", "org last");
});

Deno.test("pickPolicy: non-matching targets are skipped", () => {
  const rows = [row({ scope: "agent", agent_id: "other", preset: "quality" })];
  assert(pickPolicy(rows, { task: "draft_skill", agentId: "ag1" }) === null, "wrong agent ⇒ no match");
});

Deno.test("clampToFloor: raises both axes up to the floor, never below", () => {
  // authoring floor = sonnet/medium
  const r = clampToFloor({ model: MODELS.haiku, effort: "low" }, "authoring");
  assert(r.model === MODELS.sonnet && r.effort === "medium", JSON.stringify(r));
  // already above floor → unchanged
  const hi = clampToFloor({ model: MODELS.opus, effort: "xhigh" }, "authoring");
  assert(hi.model === MODELS.opus && hi.effort === "xhigh", JSON.stringify(hi));
});

Deno.test("leverFor: economy authoring is floored, never degrades below floor", () => {
  // economy authoring = sonnet/high (already ≥ floor sonnet/medium)
  const eco = leverFor(row({ preset: "economy" }), "authoring");
  assert(eco.model === MODELS.sonnet && eco.effort === "high", JSON.stringify(eco));
});

Deno.test("leverFor: custom below floor is clamped up", () => {
  const c = leverFor(row({ preset: "custom", model: MODELS.haiku, effort: "low" }), "authoring");
  assert(c.model === MODELS.sonnet && c.effort === "medium", "custom clamped to authoring floor");
});

Deno.test("leverFor: balanced holds authoring at today's opus/high", () => {
  const b = leverFor(row({ preset: "balanced" }), "authoring");
  assert(b.model === MODELS.opus && b.effort === "high", JSON.stringify(b));
});

Deno.test("matrix + floors: every preset×tier is at or above the tier floor", () => {
  for (const preset of ["quality", "balanced", "economy"] as const) {
    for (const tier of ["authoring", "reasoning", "conversational", "extraction"] as const) {
      const lever = PRESET_MATRIX[preset][tier];
      const floored = clampToFloor(lever, tier);
      assert(
        floored.model === lever.model && floored.effort === lever.effort,
        `${preset}/${tier} (${lever.model}/${lever.effort}) sits below floor ${FLOORS[tier].model}/${FLOORS[tier].effort}`,
      );
    }
  }
});
