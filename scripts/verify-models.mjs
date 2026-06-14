// Model-coherence guard — run: node --experimental-strip-types scripts/verify-models.mjs
//
// The cost dial mirrors the authoritative edge policy model into the web for
// instant previews, and the lifecycle model must stay in lock-step with the same
// task universe. This script fails loudly if any of those invariants drift:
//   • web/lib/aiPolicy.ts  ===  supabase/functions/_shared/ai_policy.ts (+ PRICING)
//   • web/lib/lifecycle.ts task universe  ===  the tier map's task universe
//   • every preset×tier is at or above its floor; projection re-prices exactly
//
// Pure modules only (no Deno/Next runtime needed). Wire into CI / pre-push.
import * as edge from "../supabase/functions/_shared/ai_policy.ts";
import * as usage from "../supabase/functions/_shared/ai_usage.ts";
import * as web from "../web/lib/aiPolicy.ts";
import * as lc from "../web/lib/lifecycle.ts";

let fail = 0;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ok = (c, m) => { if (!c) { fail++; console.error("✗ " + m); } else console.log("✓ " + m); };

// Web mirror === authoritative edge source.
ok(eq(edge.TASK_TIER, web.TASK_TIER), "TASK_TIER: web === edge");
ok(eq(edge.FLOORS, web.FLOORS), "FLOORS: web === edge");
ok(eq(edge.PRESET_MATRIX, web.PRESET_MATRIX), "PRESET_MATRIX: web === edge");
ok(eq(edge.MODELS, web.MODELS), "MODELS: web === edge");
ok(eq(usage.PRICING, web.PRICING), "PRICING: web === ai_usage.ts");

// Lifecycle + tier maps classify exactly the same task universe; labels complete.
const tier = new Set(Object.keys(edge.TASK_TIER));
const stage = new Set(Object.keys(lc.TASK_STAGE));
ok([...tier].every((t) => stage.has(t)) && [...stage].every((t) => tier.has(t)), "TASK_STAGE ⇔ TASK_TIER: same task universe");
ok(Object.keys(edge.TASK_TIER).every((t) => web.TASK_LABEL[t]), "TASK_LABEL covers every task");

// Floor invariant + projection exactness.
for (const p of ["quality", "balanced", "economy"]) for (const t of ["authoring", "reasoning", "conversational", "extraction"]) {
  const lv = web.PRESET_MATRIX[p][t], fl = web.clampToFloor(lv, t);
  ok(lv.model === fl.model && lv.effort === fl.effort, `${p}/${t} >= floor`);
}
ok(Math.abs(web.projectPreset([{ task: "connector_distill", model: "claude-opus-4-8", input_tokens: 1e6, output_tokens: 1e6, cost_usd: 30 }], "economy").projected - 6) < 1e-9, "economy/extraction re-price = $6");

console.log(fail ? `\n${fail} CHECK(S) FAILED` : "\nall model-coherence checks passed");
process.exit(fail ? 1 : 0);
